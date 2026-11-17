import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../contexts/types';
import type { Donation } from '../../contexts/types';
import { db } from '../storage/db';
import { isDirtySinceBackup, monthWrite, rowWrite, transact } from '../storage/storageService';
import { backupLines, snapshotBackupLines } from './backupService';
import { runPeriodicBackup } from './autoBackupService';
import { parseAndValidateBackup, sha256Hex } from './validation';

const d = (id: string, date: string): Donation =>
  ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: `c${id}`, updatedAt: 'x' }) as Donation;

function fakeDesktop(opts: { failAt?: number } = {}) {
  const sent: string[] = [];
  const calls: string[] = [];
  const api = {
    getDefaultBackupDir: async () => 'C:/x',
    autoBackupBegin: async (_dir: string, kind?: string) => (calls.push(`begin:${kind ?? ''}`), 7),
    autoBackupWrite: async (id: number, line: string) => {
      if (id !== 7) throw new Error('다른 세션');
      if (opts.failAt !== undefined && sent.length === opts.failAt) throw new Error('디스크 쓰기 실패');
      sent.push(line);
      return true;
    },
    autoBackupEnd: async (id: number) => (calls.push(`end:${id}`), 'C:/x/autosave_20260101_000000.json.gz'),
  };
  vi.stubGlobal('window', { desktop: api });
  return { sent, calls };
}

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
  await transact(async () => ({ writes: [monthWrite('2026-01', [d('a', '2026-01-04')]), monthWrite('2026-02', [d('b', '2026-02-01')])], result: 0 }));
});
afterEach(() => vi.unstubAllGlobals());

describe('snapshotBackupLines', () => {
  it('produces the same lines as backupLines (except the timestamp) and a valid file', async () => {
    const strip = (l: string) => l.replace(/"exportedAt":"[^"]*"/, '');
    const a: string[] = [];
    const b: string[] = [];
    for await (const l of backupLines()) a.push(strip(l));
    for await (const l of snapshotBackupLines()) b.push(strip(l));
    expect(b).toEqual(a);
    const body = [...b].join('');
    expect(body).toContain('"t":"donations","ym":"2026-02"');
    const { body: full } = await collectText();
    const text = full + JSON.stringify({ t: 'end', sha256: await sha256Hex(full) }) + String.fromCharCode(10);
    expect((await parseAndValidateBackup(text)).ok).toBe(true);
  });
});

async function collectText() {
  let body = '';
  for await (const l of snapshotBackupLines()) body += l;
  return { body };
}

describe('runPeriodicBackup', () => {
  it('does nothing when nothing changed since the last backup', async () => {
    const { calls } = fakeDesktop();
    await db.kv.put(false, 'meta_dirty_since_backup');
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('backs up the changed data, tags the file as periodic, and clears the changed flag', async () => {
    const { sent, calls } = fakeDesktop();
    expect(await isDirtySinceBackup()).toBe(true);
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toMatch(/autosave_/);
    expect(calls).toEqual(['begin:periodic', 'end:7']);
    expect(sent.some((l) => l.includes('"t":"donations"'))).toBe(true);
    expect(await isDirtySinceBackup()).toBe(false);
  });

  it('puts the changed flag back when the backup fails, and keeps changes made meanwhile', async () => {
    fakeDesktop({ failAt: 2 });
    await expect(runPeriodicBackup(DEFAULT_SETTINGS)).rejects.toThrow('디스크 쓰기 실패');
    expect(await isDirtySinceBackup()).toBe(true);
    // 백업이 끝난 뒤 생긴 변경은 다음 백업 대상으로 남습니다.
    fakeDesktop();
    await runPeriodicBackup(DEFAULT_SETTINGS);
    await transact(async () => ({ writes: [rowWrite('2026-03', { puts: [d('c', '2026-03-01')], deletes: [] })], result: 0 }));
    expect(await isDirtySinceBackup()).toBe(true);
  });

  it('skips when automatic backup is turned off', async () => {
    const { calls } = fakeDesktop();
    expect(await runPeriodicBackup({ ...DEFAULT_SETTINGS, autoBackupEnabled: false })).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('collectPayloadChunked (주기 백업 읽기)', () => {
  const ids = (p: { donationsByYear: Record<string, Donation[]> }) => Object.values(p.donationsByYear).flat().map((x) => x.id).sort();

  it('does not block saves while it reads (a save finishes between two months)', async () => {
    const { collectPayloadChunked } = await import('./backupService');
    let savedWhileReading = false;
    const p = await collectPayloadChunked({
      onMonthRead: async (ym) => {
        if (ym !== '2026-01') return;
        // 단일 읽기 트랜잭션이었다면 이 저장이 백업이 끝날 때까지 기다려 여기서 멈춥니다.
        await transact(async () => ({ writes: [rowWrite('2026-02', { puts: [d('late', '2026-02-02')], deletes: [] })], result: 0 }));
        savedWhileReading = true;
      },
    });
    expect(savedWhileReading).toBe(true);
    expect(ids(p)).toContain('a');
  });

  it('reads again when a donation moved to another month during the read, so it appears exactly once', async () => {
    const { collectPayloadChunked } = await import('./backupService');
    let reads = 0;
    let moved = false;
    const p = await collectPayloadChunked({
      onMonthRead: async (ym) => {
        reads++;
        if (ym !== '2026-01' || moved) return;
        moved = true; // 1월 내역 a를 읽은 직후 2월로 옮깁니다(옮긴 뒤에 읽는 2월에도 a가 있어 그대로면 두 번 담김).
        await transact(async () => ({
          writes: [rowWrite('2026-01', { puts: [], deletes: [['2026-01-04', 'a']] }), rowWrite('2026-02', { puts: [d('a', '2026-02-09')], deletes: [] })],
          result: 0,
        }));
      },
    });
    expect(ids(p).filter((x) => x === 'a')).toHaveLength(1);
    expect(reads).toBeGreaterThan(2); // 다시 읽음
  });

  it('does not count same-month edits as a reason to read again', async () => {
    const { collectPayloadChunked } = await import('./backupService');
    let reads = 0;
    await collectPayloadChunked({
      onMonthRead: async (ym) => {
        reads++;
        if (ym === '2026-01') await transact(async () => ({ writes: [rowWrite('2026-01', { puts: [d('n', '2026-01-18')], deletes: [] })], result: 0 }));
      },
    });
    expect(reads).toBe(2); // 1월, 2월 한 번씩
  });

  it('gives up with a clear error when moves keep happening', async () => {
    const { collectPayloadChunked } = await import('./backupService');
    await transact(async () => ({ writes: [rowWrite('2026-01', { puts: [d('k', '2026-01-11')], deletes: [] })], result: 0 })); // 1월이 비지 않게
    let flip = false;
    await expect(
      collectPayloadChunked({
        maxAttempts: 2,
        onMonthRead: async (ym) => {
          if (ym !== '2026-01') return;
          flip = !flip;
          const [from, to] = flip ? ['2026-01-04', '2026-02-09'] : ['2026-02-09', '2026-01-04'];
          const [fm, tm] = flip ? ['2026-01', '2026-02'] : ['2026-02', '2026-01'];
          await transact(async () => ({ writes: [rowWrite(fm, { puts: [], deletes: [[from, 'a']] }), rowWrite(tm, { puts: [d('a', to)], deletes: [] })], result: 0 }));
        },
      }),
    ).rejects.toThrow('옮겨지는 변경');
  });
});
