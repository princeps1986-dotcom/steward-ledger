import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { applyRowOps } from '../domain/donationOps';
import { db } from './db';
import {
  countDonationsOfType,
  findDonationById,
  findDuplicateRow,
  getItem,
  listDonationMonths,
  listDonationYears,
  monthWrite,
  readMonth,
  readRow,
  rowWrite,
  transact,
} from './storageService';

const d = (id: string, date: string, extra: Partial<Donation> = {}): Donation =>
  ({ id, date, memberId: 'm1', donorDisplayName: '김', offeringTypeId: 't1', amount: 1000, createdAt: `c${id}`, updatedAt: 'x', ...extra }) as Donation;
const ids = (l: Donation[]) => l.map((x) => x.id);
const put = (ym: string, ...list: Donation[]) => transact(async () => ({ writes: [rowWrite(ym, { puts: list, deletes: [] })], result: null }));

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
});

/** 색인 조회(findDuplicateRow)와 비교하는 기준 구현: 목록을 처음부터 훑어 [날짜+성도+종류]가 같은 첫 내역을 찾습니다(무명 제외). */
const findDuplicate = (list: Donation[], d: Pick<Donation, 'date' | 'memberId' | 'offeringTypeId'>): Donation | undefined =>
  d.memberId === null ? undefined : list.find((x) => x.date === d.date && x.memberId === d.memberId && x.offeringTypeId === d.offeringTypeId);

describe('row-per-donation storage', () => {
  it('reads one month by date range, in entry order, without touching neighbours', async () => {
    await put('2026-01', d('b', '2026-01-11'), d('a', '2026-01-04'));
    await put('2026-02', d('c', '2026-02-01'));
    await put('2025-01', d('z', '2025-01-31'));
    expect(ids(await readMonth('2026-01'))).toEqual(['a', 'b']); // 만든 시각(c a < c b) 순서
    expect(ids(await readMonth('2026-02'))).toEqual(['c']);
    expect(await readMonth('2026-03')).toEqual([]);
    expect(await listDonationMonths()).toEqual(['2025-01', '2026-01', '2026-02']);
    expect(await listDonationYears()).toEqual(['2025', '2026']);
  });

  it('writes only the given rows: add, edit in place, change date inside a month, delete', async () => {
    await put('2026-01', d('a', '2026-01-04'), d('b', '2026-01-11'));
    await put('2026-01', d('a', '2026-01-04', { amount: 5000 }));
    expect((await readRow('2026-01-04', 'a'))!.amount).toBe(5000);
    expect((await readMonth('2026-01')).length).toBe(2);

    // 같은 달 안에서 날짜 변경: 이전 행을 지우고 새 날짜의 행을 만듭니다.
    await transact(async () => ({ writes: [rowWrite('2026-01', { puts: [d('a', '2026-01-25')], deletes: [['2026-01-04', 'a']] })], result: null }));
    expect(await readRow('2026-01-04', 'a')).toBeNull();
    expect((await readRow('2026-01-25', 'a'))!.id).toBe('a');
    expect((await readMonth('2026-01')).length).toBe(2);

    await transact(async () => ({ writes: [rowWrite('2026-01', { puts: [], deletes: [['2026-01-25', 'a']] })], result: null }));
    expect(ids(await readMonth('2026-01'))).toEqual(['b']);
    expect((await findDonationById('b'))!.date).toBe('2026-01-11');
  });

  it('replaces or empties a whole month with monthWrite (restore)', async () => {
    await put('2026-01', d('a', '2026-01-04'), d('b', '2026-01-05'));
    await put('2026-02', d('keep', '2026-02-02'));
    await transact(async () => ({ writes: [monthWrite('2026-01', [d('n', '2026-01-09')])], result: null }));
    expect(ids(await readMonth('2026-01'))).toEqual(['n']);
    await transact(async () => ({ writes: [monthWrite('2026-01', [])], result: null }));
    expect(await listDonationMonths()).toEqual(['2026-02']);
    expect(ids(await readMonth('2026-02'))).toEqual(['keep']);
  });

  it('keeps the order of delete then write for the same month in one transaction', async () => {
    await put('2026-03', d('old', '2026-03-01'));
    await transact(async () => ({ writes: [monthWrite('2026-03', []), monthWrite('2026-03', [d('new', '2026-03-02')])], result: null }));
    expect(ids(await readMonth('2026-03'))).toEqual(['new']);
  });

  it('rolls rows back together with the other keys when the transaction fails', async () => {
    await put('2026-01', d('a', '2026-01-04'));
    await expect(
      transact(async () => ({ writes: [rowWrite('2026-01', { puts: [d('z', '2026-01-05')], deletes: [['2026-01-04', 'a']] }), { key: 'bad', value: () => 1 }], result: null })),
    ).rejects.toBeTruthy();
    expect(ids(await readMonth('2026-01'))).toEqual(['a']);
  });

  it('marks the data as changed since the last backup when only rows change', async () => {
    await put('2026-01', d('a', '2026-01-04'));
    expect(await getItem('meta_dirty_since_backup')).toBe(true);
  });

  it('finds duplicates by index exactly like the in-memory search does', async () => {
    const list = [d('a', '2026-01-04'), d('b', '2026-01-04', { offeringTypeId: 't2' }), d('c', '2026-01-11', { memberId: null })];
    await put('2026-01', ...list);
    const drafts = [
      { date: '2026-01-04', memberId: 'm1', offeringTypeId: 't1' },
      { date: '2026-01-04', memberId: 'm1', offeringTypeId: 't2' },
      { date: '2026-01-04', memberId: 'm1', offeringTypeId: 't9' },
      { date: '2026-01-11', memberId: null, offeringTypeId: 't1' },
    ];
    const byIndex = await Promise.all(drafts.map((x) => findDuplicateRow(x)));
    expect(byIndex.map((x) => x?.id)).toEqual(drafts.map((x) => findDuplicate(list, x as never)?.id));
    expect(byIndex.map((x) => x?.id)).toEqual(['a', 'b', undefined, undefined]);
  });

  it('counts donations of an offering type by index', async () => {
    await put('2026-01', d('a', '2026-01-04'), d('b', '2026-01-05', { offeringTypeId: 't2' }), d('c', '2026-01-06'));
    expect(await countDonationsOfType('t1')).toBe(2);
    expect(await countDonationsOfType('nope')).toBe(0);
  });
});

describe('applyRowOps (in-memory month list)', () => {
  it('replaces in place, removes deleted ids and appends new rows', () => {
    const list = [d('a', '2026-01-01'), d('b', '2026-01-02'), d('c', '2026-01-03')];
    const out = applyRowOps(list, [d('b', '2026-01-09'), d('n', '2026-01-10')], [['2026-01-02', 'b'], ['2026-01-03', 'c']]);
    expect(out.map((x) => [x.id, x.date])).toEqual([['a', '2026-01-01'], ['b', '2026-01-09'], ['n', '2026-01-10']]);
  });
});

describe('internDonations', () => {
  it('keeps values and shares equal strings', async () => {
    const { internDonations } = await import('./storageService');
    const mk = (id: string) => ({ id, date: ['2026', '01', '04'].join('-'), memberId: ['m', '1'].join(''), donorDisplayName: ['김', '철수'].join(''), offeringTypeId: ['t', '1'].join(''), amount: 1, createdAt: id, updatedAt: id }) as never as import('../../contexts/types').Donation;
    const rows = internDonations([mk('a'), mk('b')]);
    expect(rows.map((r) => [r.date, r.memberId, r.donorDisplayName, r.offeringTypeId])).toEqual(Array(2).fill(['2026-01-04', 'm1', '김철수', 't1']));
  });
});
