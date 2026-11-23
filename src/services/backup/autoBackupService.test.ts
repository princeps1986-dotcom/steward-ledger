import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../contexts/types';
import type { Donation } from '../../contexts/types';
import type { DesktopApi } from '../desktopBridge';
import { db } from '../storage/db';
import { dirtyYearsSinceFullBackup, isDirtySinceBackup, KEYS, monthWrite, rowWrite, transact } from '../storage/storageService';
import { backupLines, desktopSink, saveBackupFile, streamBackup, type BackupSink } from './backupService';
import { buildAutoBackup, runPeriodicBackup } from './autoBackupService';
import { withBackupBusy } from './backupBusy';
import { sha256Hex } from './validation';
import { parseNdjsonBackup } from './testPayload';

const d = (id: string, date: string): Donation =>
  ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: `c${id}`, updatedAt: 'x' }) as Donation;
const NL = String.fromCharCode(10);

/** main 대신 줄을 모으는 가짜 sink. 세션마다 줄이 따로 쌓이고, restart하면 새 세션이 비어서 시작합니다. */
function fakeSink(opts: { failAtLine?: number; cancel?: boolean; failMessage?: string } = {}) {
  const log: string[] = [];
  let sessions: string[][] = [];
  const sink: BackupSink = {
    begin: async () => (opts.cancel ? null : (log.push('begin'), sessions.push([]), sessions.length)),
    write: async (id, line) => {
      if (opts.failAtLine !== undefined && sessions[id - 1].length === opts.failAtLine) throw new Error(opts.failMessage ?? '디스크 쓰기 실패');
      sessions[id - 1].push(line);
    },
    restart: async () => (log.push('restart'), sessions.push([]), sessions.length),
    abort: async () => void log.push('abort'),
    end: async (id) => (log.push(`end:${id}`), 'C:/x/backup.json.gz'),
  };
  return { sink, log, final: () => sessions[sessions.length - 1], sessions: () => sessions, reset: () => (sessions = []) };
}

function fakeDesktop(sink: BackupSink) {
  const specs: unknown[] = [];
  const api = {
    backupBegin: async (spec: unknown) => (specs.push(spec), sink.begin()),
    backupWrite: sink.write,
    backupRestart: sink.restart,
    backupAbort: sink.abort,
    backupEnd: sink.end,
  } as unknown as DesktopApi;
  vi.stubGlobal('window', { desktop: api });
  return specs;
}

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
  await transact(async () => ({ writes: [monthWrite('2026-01', [d('a', '2026-01-04')]), monthWrite('2026-02', [d('b', '2026-02-01')])], result: 0 }));
});
afterEach(() => vi.unstubAllGlobals());

describe('backupLines', () => {
  it('produces a valid backup file with every month of the store', async () => {
    let body = '';
    for await (const l of backupLines()) body += l;
    const text = body + JSON.stringify({ t: 'end', sha256: await sha256Hex(body) }) + NL;
    const res = await parseNdjsonBackup(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(Object.fromEntries(Object.entries(res.envelope.payload.donationsByYear).map(([y, l]) => [y, l.map((x) => x.id)]))).toEqual({ '2026': ['a', 'b'] });
  });

  it('keeps only the chosen years (members and types always)', async () => {
    const out: string[] = [];
    for await (const l of backupLines({ years: ['2026'] })) out.push(l);
    expect(out.filter((l) => l.includes('"t":"donations"'))).toHaveLength(2);
    const out2: string[] = [];
    for await (const l of backupLines({ years: ['1999'] })) out2.push(l);
    expect(out2.filter((l) => l.includes('"t":"donations"'))).toHaveLength(0);
    expect(out2.some((l) => l.includes('"t":"members"'))).toBe(true);
  });
});

describe('streamBackup', () => {
  const idsOf = (lines: string[]) => lines.filter((l) => l.includes('"t":"donations"')).flatMap((l) => (JSON.parse(l).data as Donation[]).map((x) => x.id)).sort();

  it('sends one line per month, ends once, and returns the saved path', async () => {
    const f = fakeSink();
    expect(await streamBackup(f.sink)).toBe('C:/x/backup.json.gz');
    expect(f.log).toEqual(['begin', 'end:1']);
    expect(idsOf(f.final())).toEqual(['a', 'b']);
  });

  it('returns null without writing when the user cancels the save dialog', async () => {
    const f = fakeSink({ cancel: true });
    expect(await streamBackup(f.sink)).toBeNull();
    expect(f.log).toEqual([]);
  });

  it('does not block saves while it reads (a save finishes between two months)', async () => {
    const f = fakeSink();
    let saved = false;
    await streamBackup(f.sink, {
      onMonthRead: async (ym) => {
        if (ym !== '2026-01') return;
        // 한 트랜잭션으로 오래 읽었다면 이 저장이 백업이 끝날 때까지 기다려 여기서 멈춥니다.
        await transact(async () => ({ writes: [rowWrite('2026-02', { puts: [d('late', '2026-02-02')], deletes: [] })], result: 0 }));
        saved = true;
      },
    });
    expect(saved).toBe(true);
  });

  it('restarts from the beginning when a donation moved to another month during the read, so it appears exactly once', async () => {
    const f = fakeSink();
    let moved = false;
    await streamBackup(f.sink, {
      onMonthRead: async (ym) => {
        if (ym !== '2026-01' || moved) return;
        moved = true; // 1월 a를 읽은 직후 2월로 옮김(그대로 이어 쓰면 2월에도 a가 있어 두 번 담김)
        await transact(async () => ({
          writes: [rowWrite('2026-01', { puts: [], deletes: [['2026-01-04', 'a']] }), rowWrite('2026-02', { puts: [d('a', '2026-02-09')], deletes: [] })],
          result: 0,
        }));
      },
    });
    expect(f.log).toEqual(['begin', 'restart', 'end:2']);
    expect(idsOf(f.final()).filter((x) => x === 'a')).toHaveLength(1);
  });

  it('does not restart for same-month edits', async () => {
    const f = fakeSink();
    await streamBackup(f.sink, {
      onMonthRead: async (ym) => {
        if (ym === '2026-01') await transact(async () => ({ writes: [rowWrite('2026-01', { puts: [d('n', '2026-01-18')], deletes: [] })], result: 0 }));
      },
    });
    expect(f.log).toEqual(['begin', 'end:1']);
  });

  it('aborts and throws a clear error when moves keep happening', async () => {
    const f = fakeSink();
    await transact(async () => ({ writes: [rowWrite('2026-01', { puts: [d('k', '2026-01-11')], deletes: [] })], result: 0 })); // 1월이 비지 않게
    let flip = false;
    await expect(
      streamBackup(f.sink, {
        maxAttempts: 2,
        onMonthRead: async (ym) => {
          if (ym !== '2026-01') return;
          flip = !flip;
          const [from, to, fm, tm] = flip ? ['2026-01-04', '2026-02-09', '2026-01', '2026-02'] : ['2026-02-09', '2026-01-04', '2026-02', '2026-01'];
          await transact(async () => ({ writes: [rowWrite(fm, { puts: [], deletes: [[from, 'a']] }), rowWrite(tm, { puts: [d('a', to)], deletes: [] })], result: 0 }));
        },
      }),
    ).rejects.toThrow('옮겨지는 변경');
    expect(f.log.at(-1)).toBe('abort');
  });

  it('aborts the session when writing fails', async () => {
    const f = fakeSink({ failAtLine: 2 });
    await expect(streamBackup(f.sink)).rejects.toThrow('디스크 쓰기 실패');
    expect(f.log).toEqual(['begin', 'abort']);
  });
});

describe('desktop save functions use the streaming sessions', () => {
  it('manual backup carries the years and the password, and the user may cancel', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    expect(await saveBackupFile('backup', ['2026'], undefined, '교회암호123')).toBe('C:/x/backup.json.gz');
    expect(specs[0]).toMatchObject({ kind: 'manual', password: '교회암호123' });
    expect((specs[0] as { name: string }).name).toMatch(/^backup_2026_\d{8}_\d{6}\.slbk$/);
    expect(f.sessions().at(-1)!.filter((l) => l.includes('"t":"donations"'))).toHaveLength(2);

    const cancelled = fakeSink({ cancel: true });
    fakeDesktop(cancelled.sink);
    await expect(saveBackupFile('backup')).rejects.toThrow('저장을 취소');
  });

  it('a full manual backup clears the changed flag before reading, so changes made while it writes stay flagged', async () => {
    const quiet = fakeSink();
    fakeDesktop(quiet.sink);
    expect(await isDirtySinceBackup()).toBe(true);
    await saveBackupFile('backup');
    expect(await isDirtySinceBackup()).toBe(false);

    await transact(async () => ({ writes: [rowWrite('2026-03', { puts: [d('x', '2026-03-01')], deletes: [] })], result: 0 }));
    const busy = fakeSink();
    const write = busy.sink.write;
    let saved = false;
    busy.sink.write = async (id, line) => {
      if (!saved && line.includes('"t":"donations"')) {
        saved = true; // 백업이 내역을 쓰는 도중 저장
        await transact(async () => ({ writes: [rowWrite('2026-03', { puts: [d('late', '2026-03-02')], deletes: [] })], result: 0 }));
      }
      return write(id, line);
    };
    fakeDesktop(busy.sink);
    await saveBackupFile('backup');
    expect(await isDirtySinceBackup()).toBe(true);
  });

  it('puts the changed flag back when a full manual backup is cancelled', async () => {
    fakeDesktop(fakeSink({ cancel: true }).sink);
    expect(await isDirtySinceBackup()).toBe(true);
    await expect(saveBackupFile('backup')).rejects.toThrow('저장을 취소');
    expect(await isDirtySinceBackup()).toBe(true);
  });

  it('10분 백업 뒤(변경 표시 꺼짐) 직접 전체 백업을 취소하면 변경 표시를 켜지 않고 바뀐 연도 목록만 되돌린다', async () => {
    fakeDesktop(fakeSink().sink);
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toMatchObject({ full: false });
    fakeDesktop(fakeSink({ cancel: true }).sink);
    await expect(saveBackupFile('backup', ['2026'], undefined, '교회암호123')).rejects.toThrow('저장을 취소');
    expect(await isDirtySinceBackup()).toBe(false); // 바뀐 것이 없으니 다음 10분 백업은 건너뜀
    expect(await dirtyYearsSinceFullBackup()).toEqual(['2026']); // 닫을 때 전체 백업은 그대로 함
  });

  it('desktopSink forwards to the bridge', async () => {
    const f = fakeSink();
    fakeDesktop(f.sink);
    const sink = desktopSink(window.desktop!, { kind: 'periodic' });
    const id = await sink.begin();
    expect(id).toBe(1);
  });
});

describe('runPeriodicBackup', () => {
  it('does nothing when nothing changed since the last backup', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    await db.kv.put(false, 'meta_dirty_since_backup');
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toBeNull();
    expect(specs).toEqual([]);
  });

  it('backs up the changed data as a periodic session and clears the changed flag', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    expect(await isDirtySinceBackup()).toBe(true);
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toEqual({ file: 'C:/x/backup.json.gz', full: false }); // 2026년만 바뀜
    expect(specs[0]).toMatchObject({ kind: 'periodic' });
    expect(f.final().some((l) => l.includes('"t":"donations"'))).toBe(true);
    expect(await isDirtySinceBackup()).toBe(false);
  });

  it('바뀐 연도를 모르면(목록이 비어 있으면) 전체를 담고 full: true를 돌려준다', async () => {
    const f = fakeSink();
    fakeDesktop(f.sink);
    // 다른 연도(2025)도 있어야 일부 백업(2026년만)과 전체 백업이 구별됩니다.
    await transact(async () => ({ writes: [monthWrite('2025-05', [d('c', '2025-05-04')])], result: 0 }));
    await db.kv.delete('meta_dirty_years');
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toEqual({ file: 'C:/x/backup.json.gz', full: true });
    expect(f.final().filter((l) => l.includes('"t":"donations"'))).toHaveLength(3); // 2025-05, 2026-01, 2026-02 모두
  });

  it('성도·헌금 종류만 바뀌었으면 헌금 내역이 있는 가장 최근 연도 하나만 담고, 종료 때는 전체 백업한다', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    await transact(async () => ({ writes: [rowWrite('2025-05', { puts: [d('old', '2025-05-01')], deletes: [] })], result: 0 }));
    await db.kv.put([], 'meta_dirty_years'); // 전체 백업 뒤 성도만 바뀐 상태
    await db.kv.put(true, 'meta_dirty_since_backup');
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toEqual({ file: 'C:/x/backup.json.gz', full: false });
    const months = f.final().filter((l) => l.includes('"t":"donations"'));
    expect(months).toHaveLength(2);
    expect(months.every((l) => l.includes('"ym":"2026'))).toBe(true);
    expect(await dirtyYearsSinceFullBackup()).toEqual(['2026']);
    expect(await buildAutoBackup()).not.toBeNull();
    expect(specs.at(-1)).toMatchObject({ kind: 'close' });
  });

  it('puts the changed flag back when the backup fails', async () => {
    const f = fakeSink({ failAtLine: 2 });
    fakeDesktop(f.sink);
    await expect(runPeriodicBackup(DEFAULT_SETTINGS)).rejects.toThrow('디스크 쓰기 실패');
    expect(await isDirtySinceBackup()).toBe(true);
  });

  it('is not a failure when another backup cancelled it: returns null and keeps the changed flag for the next try', async () => {
    const f = fakeSink({ failAtLine: 2, failMessage: "Error invoking remote method 'backup:write': Error: 백업이 취소되었거나 시작되지 않았습니다." });
    fakeDesktop(f.sink);
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toBeNull();
    expect(await isDirtySinceBackup()).toBe(true);
  });

  it('keeps changes made during the backup for the next one', async () => {
    const f = fakeSink();
    fakeDesktop(f.sink);
    await runPeriodicBackup(DEFAULT_SETTINGS, ); // 이 백업 뒤에 생긴 변경
    await transact(async () => ({ writes: [rowWrite('2026-03', { puts: [d('c', '2026-03-01')], deletes: [] })], result: 0 }));
    expect(await isDirtySinceBackup()).toBe(true);
  });

  it('skips when automatic backup is turned off', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    expect(await runPeriodicBackup({ ...DEFAULT_SETTINGS, autoBackupEnabled: false })).toBeNull();
    expect(specs).toEqual([]);
  });
});

describe('복원이 중간에 끊긴 데이터', () => {
  it('종료 백업과 10분 백업을 만들지 않는다(반쪽 데이터가 최신 전체 백업이 되지 않게)', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    await transact(async () => ({ writes: [{ key: KEYS.restoreMarker, value: { startedAt: '2026-01-01T00:00:00Z', years: ['2026'] } }], result: 0 }));
    expect(await buildAutoBackup()).toBeNull();
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toBeNull();
    expect(specs).toEqual([]);
    expect(await isDirtySinceBackup()).toBe(true); // 다시 복원하기 전까지 변경 표시는 그대로
  });
});

describe('hasAnyData', () => {
  it('is true with donations, false when empty', async () => {
    const { hasAnyData } = await import('./backupService');
    expect(await hasAnyData()).toBe(true);
    await db.kv.clear();
    await db.donations.clear();
    expect(await hasAnyData()).toBe(false);
  });
});

describe('buildAutoBackup (종료 때 백업)', () => {
  it('직접 백업·복원이 진행 중이면 건너뛰지 않고 오류를 던져 종료 여부를 묻게 한다', async () => {
    const f = fakeSink();
    fakeDesktop(f.sink);
    let release!: () => void;
    const busy = withBackupBusy(() => new Promise<void>((r) => (release = r)));
    await expect(buildAutoBackup()).rejects.toThrow('진행 중');
    expect(f.log).toEqual([]); // 진행 중인 세션을 건드리지 않음
    release();
    await busy;
  });

  it('설정과 상관없이 변경이 있으면 종료 때 백업을 한다(체크박스는 10분 백업만 끔)', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    expect(await buildAutoBackup()).not.toBeNull();
    expect(specs[0]).toMatchObject({ kind: 'close' });
  });

  it('10분 백업이 일부 연도만 담았으면 변경 표시가 꺼졌어도 닫을 때 전체 백업하고, 그 뒤 바뀐 게 없으면 건너뛴다', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toMatchObject({ full: false });
    expect(await isDirtySinceBackup()).toBe(false);
    expect(await buildAutoBackup()).not.toBeNull();
    expect(specs.at(-1)).toMatchObject({ kind: 'close' });
    expect(await dirtyYearsSinceFullBackup()).toEqual([]);
    expect(await buildAutoBackup()).toBeNull();
  });

  it('10분 백업이 일부 연도만 담은 뒤 직접 전체 백업을 하면, 닫을 때 같은 전체 백업을 다시 하지 않는다', async () => {
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    expect(await runPeriodicBackup(DEFAULT_SETTINGS)).toMatchObject({ full: false });
    await saveBackupFile('backup', ['2026'], undefined, '교회암호123'); // 데이터가 2026년뿐이라 전체 백업
    expect(await dirtyYearsSinceFullBackup()).toEqual([]);
    expect(await buildAutoBackup()).toBeNull();
    expect(specs.map((s) => (s as { kind: string }).kind)).toEqual(['periodic', 'manual']);
  });

  it('성도·헌금이 하나도 없으면 바뀐 표시가 있어도 종료 백업을 만들지 않는다', async () => {
    await db.kv.clear();
    await db.donations.clear();
    await db.kv.put(true, 'meta_dirty_since_backup');
    const f = fakeSink();
    const specs = fakeDesktop(f.sink);
    expect(await buildAutoBackup()).toBeNull();
    expect(specs).toEqual([]);
  });
});
