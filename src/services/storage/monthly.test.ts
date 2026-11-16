import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { collectPayload, replaceAllData, restoreBackup, yearsInPayload } from '../backup/backupService';
import {
  donationKey,
  getItem,
  KEYS,
  listDonationKeys,
  listDonationYears,
  migrateDonationsToMonthly,
  monthWrite,
  readDonationYear,
  transact,
} from './storageService';

const d = (id: string, date: string): Donation =>
  ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: '', updatedAt: '' }) as unknown as Donation;

beforeAll(() => {
  // localforage는 브라우저 전역(window)을 찾으므로 Node 테스트에서는 같은 전역을 흉내냅니다.
  (globalThis as unknown as { window?: unknown }).window ??= globalThis;
});

describe('monthly donation storage', () => {
  it('migrates legacy year keys to month keys once and keeps every donation', async () => {
    const localforage = (await import('localforage')).default;
    const raw = localforage.createInstance({ name: 'church-offering-ledger', storeName: 'kv' });
    await raw.setItem('donations_2025', [d('a', '2025-12-28'), d('b', '2025-01-05'), d('c', '2025-12-21')]);
    await raw.setItem('donations_2026', [d('e', '2026-02-01')]);
    expect(await migrateDonationsToMonthly()).toBe(true);
    expect(await listDonationKeys()).toEqual(['donations_2025-01', 'donations_2025-12', 'donations_2026-02']);
    expect((await getItem<Donation[]>('donations_2025-12'))!.map((x) => x.id)).toEqual(['a', 'c']);
    expect(await getItem('donations_2025')).toBeNull();
    expect(await listDonationYears()).toEqual(['2025', '2026']);
    expect((await readDonationYear(getItem, '2025')).map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
    expect(await getItem(KEYS.migrationDonationsMonthly)).toBe(true);
    expect(await migrateDonationsToMonthly()).toBe(false); // 두 번째는 아무것도 하지 않음
  });

  it('writes only the touched month and removes the key when the month becomes empty', async () => {
    const { writes } = await transact(async (read) => {
      const list = [...((await read<Donation[]>(donationKey('2026-03'))) ?? []), d('n', '2026-03-01')];
      return { writes: [monthWrite('2026-03', list)], result: 0 };
    });
    expect(writes.map((w) => w.key)).toEqual(['donations_2026-03']);
    expect((await getItem<Donation[]>('donations_2026-03'))!.map((x) => x.id)).toEqual(['n']);
    await transact(async () => ({ writes: [monthWrite('2026-03', [])], result: 0 }));
    expect(await getItem('donations_2026-03')).toBeNull();
  });

  it('backup round-trips through month keys (collect → replace → collect)', async () => {
    const before = await collectPayload();
    expect(Object.keys(before.donationsByYear).sort()).toEqual(['2025', '2026']);
    await replaceAllData({ ...before, donationsByYear: { '2024': [d('x', '2024-06-02'), d('y', '2024-07-07')] } });
    expect(await listDonationKeys()).toEqual(['donations_2024-06', 'donations_2024-07']);
    const after = await collectPayload();
    expect(Object.fromEntries(Object.entries(after.donationsByYear).map(([y, l]) => [y, l.map((x) => x.id)]))).toEqual({ '2024': ['x', 'y'] });
  });
});

describe('year-selectable backup and restore', () => {
  const m = (id: string, name: string) => ({ id, name, position: '', isFamilyHead: false, isActive: true, createdAt: '', updatedAt: '' });
  const t = (id: string) => ({ id, name: id, displayArea: 'PRIMARY' as const, quickAmounts: [], sortOrder: 1, isActive: true });
  const ids = (l: Donation[] | undefined) => (l ?? []).map((x) => x.id).sort();

  it('collectPayload(years) keeps only the chosen years but always all members and types', async () => {
    await replaceAllData({
      members: [m('a', '가'), m('b', '나')],
      offeringTypes: [t('t')],
      donationsByYear: { '2024': [d('a1', '2024-03-03')], '2025': [d('b1', '2025-05-04'), d('b2', '2025-12-28')] },
      auditLogsByYear: { '2024': [], '2025': [] },
    });
    const only = await collectPayload(['2025']);
    expect(Object.keys(only.donationsByYear)).toEqual(['2025']);
    expect(ids(only.donationsByYear['2025'])).toEqual(['b1', 'b2']);
    expect(only.members).toHaveLength(2);
    expect(yearsInPayload(await collectPayload())).toEqual(['2024', '2025']);
  });

  it('YEARS mode replaces only the chosen year, keeps other years, and only adds missing members/types', async () => {
    await replaceAllData({
      members: [m('a', '가'), m('b', '나')],
      offeringTypes: [t('t')],
      donationsByYear: { '2024': [d('keep24', '2024-03-03')], '2025': [d('old25', '2025-05-04')] },
      auditLogsByYear: {},
    });
    const backup = {
      members: [m('a', '이름이바뀐가'), m('c', '다')], // a는 현재 값 유지, c만 추가
      offeringTypes: [t('t'), t('t2')],
      donationsByYear: { '2025': [d('new25a', '2025-01-05'), d('new25b', '2025-02-02')], '2026': [d('skip26', '2026-01-04')] },
      auditLogsByYear: {},
    };
    await restoreBackup(backup, { years: ['2025'], mode: 'YEARS' });
    const after = await collectPayload();
    expect(ids(after.donationsByYear['2024'])).toEqual(['keep24']); // 다른 연도 유지
    expect(ids(after.donationsByYear['2025'])).toEqual(['new25a', 'new25b']); // 선택 연도 교체
    expect(after.donationsByYear['2026']).toBeUndefined(); // 선택하지 않은 연도는 가져오지 않음
    expect(after.members.map((x) => [x.id, x.name]).sort()).toEqual([['a', '가'], ['b', '나'], ['c', '다']]);
    expect(after.offeringTypes.map((x) => x.id).sort()).toEqual(['t', 't2']);
  });

  it('FULL mode wipes everything and restores only the chosen years', async () => {
    const backup = {
      members: [m('z', '자')],
      offeringTypes: [t('t')],
      donationsByYear: { '2023': [d('x23', '2023-06-04')], '2025': [d('x25', '2025-06-01')] },
      auditLogsByYear: {},
    };
    await restoreBackup(backup, { years: ['2023'], mode: 'FULL' });
    const after = await collectPayload();
    expect(Object.keys(after.donationsByYear)).toEqual(['2023']);
    expect(after.members.map((x) => x.id)).toEqual(['z']);
  });
});
