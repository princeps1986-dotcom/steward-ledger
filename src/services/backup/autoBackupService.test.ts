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
