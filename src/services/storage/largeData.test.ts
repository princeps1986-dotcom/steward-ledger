import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Donation } from '../../contexts/types';
import type { DesktopApi } from '../desktopBridge';
import { createBackupBlob, type BackupSink } from '../backup/backupService';
import { runPeriodicBackup } from '../backup/autoBackupService';
import { scanBackupFile } from '../backup/streamRestore';
import { sumMonth } from '../domain/periodSummary';
import { db } from './db';
import { clearDirty, dirtyYearsSinceFullBackup, findDonationById, monthWrite, readMemberDonations, rowWrite, transact } from './storageService';

const d = (id: string, date: string, memberId: string | null = null, amount = 1000, offeringTypeId = 't'): Donation =>
  ({ id, date, memberId, donorDisplayName: memberId ?? '무명1', offeringTypeId, amount, createdAt: `c${id}`, updatedAt: 'x' }) as Donation;

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
  await transact(async () => ({
    writes: [monthWrite('2025-12', [d('a', '2025-12-28', 'm1')]), monthWrite('2026-01', [d('b', '2026-01-04', 'm1'), d('c', '2026-01-04', 'm2'), d('n', '2026-01-04')])],
    result: 0,
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('sumMonth', () => {
  it('sums amount, anonymous amount and count per offering type', () => {
    const s = sumMonth([d('1', '2026-01-04', 'm1', 1000, 't'), d('2', '2026-01-04', null, 500, 't'), d('3', '2026-01-11', 'm2', 300, 'u')]);
    expect(s.get('t')).toEqual({ amount: 1500, anonymous: 500, count: 2 });
    expect(s.get('u')).toEqual({ amount: 300, anonymous: 0, count: 1 });
  });
});

describe('lookups without scanning every row', () => {
  it('findDonationById finds a row by id alone and returns null when missing', async () => {
    expect((await findDonationById('c'))?.date).toBe('2026-01-04');
    expect(await findDonationById('zz')).toBeNull();
  });

  it('findDonationById keeps scanning past a chunk boundary', async () => {
    // 키 순서: a, b | c, n — 묶음이 2개면 n은 둘째 묶음에 있고, 셋째 묶음은 비어 있음
    expect((await findDonationById('n', 2))?.date).toBe('2026-01-04');
    expect((await findDonationById('c', 1))?.date).toBe('2026-01-04');
    expect(await findDonationById('zz', 2)).toBeNull();
  });

  it('readMemberDonations reads only the given members across years', async () => {
    expect((await readMemberDonations(['m1'])).map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(await readMemberDonations([])).toEqual([]);
  });
});

describe('dirty years and periodic backup', () => {
  it('records the years touched since the last full backup', async () => {
    expect(await dirtyYearsSinceFullBackup()).toEqual(['2025', '2026']);
    await clearDirty();
    await transact(async () => ({ writes: [rowWrite('2026-01', { puts: [d('x', '2026-01-11')], deletes: [] })], result: 0 }));
    expect(await dirtyYearsSinceFullBackup()).toEqual(['2026']);
    await clearDirty(false); // 일부 연도 백업은 목록을 남깁니다
    expect(await dirtyYearsSinceFullBackup()).toEqual(['2026']);
  });

  it('periodic backup writes only the dirty years', async () => {
    await clearDirty();
    await transact(async () => ({ writes: [rowWrite('2026-01', { puts: [d('x', '2026-01-11')], deletes: [] })], result: 0 }));
    const lines: string[] = [];
    const sink: BackupSink = { begin: async () => 1, write: async (_id, l) => void lines.push(l), restart: async () => 1, abort: async () => undefined, end: async () => 'C:/x/a.gz' };
    const api = { backupBegin: sink.begin, backupWrite: sink.write, backupRestart: sink.restart, backupAbort: sink.abort, backupEnd: sink.end } as unknown as DesktopApi;
    vi.stubGlobal('window', { desktop: api });
    expect(await runPeriodicBackup({ ...DEFAULT_SETTINGS, autoBackupEnabled: true })).toEqual({ file: 'C:/x/a.gz', full: false });
    const months = lines.filter((l) => l.includes('"t":"donations"')).map((l) => JSON.parse(l).ym);
    expect(months).toEqual(['2026-01']);
    expect(await dirtyYearsSinceFullBackup()).toEqual(['2026']); // 다음 주기 백업도 2026을 담음
  });
});

describe('browser backup blob', () => {
  it('is a valid line-based backup with every year', async () => {
    const scan = await scanBackupFile(await createBackupBlob());
    expect(scan.ok).toBe(true);
    if (scan.ok) expect(scan.yearCounts).toEqual({ '2025': 1, '2026': 3 });
  });
});
