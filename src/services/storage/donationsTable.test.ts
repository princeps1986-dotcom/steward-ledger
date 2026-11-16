import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { db } from './db';
import { donationKey, getItem, monthWrite, transact } from './storageService';

const d = (id: string, date: string, amount = 1000): Donation =>
  ({ id, date, memberId: 'm1', donorDisplayName: '김', offeringTypeId: 't1', amount, createdAt: 'x', updatedAt: 'x' }) as Donation;

/** 월 배열과 행 테이블이 같은 내용인지 */
async function expectInSync() {
  const keys = (await db.kv.toCollection().primaryKeys()).map(String).filter((k) => k.startsWith('donations_'));
  const fromArrays = (await Promise.all(keys.map((k) => getItem<Donation[]>(k)))).flatMap((l) => l ?? []);
  const rows = await db.donations.toArray();
  const byId = (a: Donation, b: Donation) => a.id.localeCompare(b.id);
  expect(rows.sort(byId)).toEqual(fromArrays.sort(byId));
}
const put = (ym: string, list: Donation[]) => transact(async () => ({ writes: [monthWrite(ym, list)], result: null }));

beforeEach(async () => {
  await db.kv.clear();
  await db.donations.clear();
});

it('has an indexed donations table next to kv', async () => {
  await db.open();
  expect(db.tables.map((t) => t.name).sort()).toEqual(['donations', 'kv']);
  await db.donations.put(d('a', '2026-01-04'));
  expect(await db.donations.where('[date+memberId+offeringTypeId]').equals(['2026-01-04', 'm1', 't1']).count()).toBe(1);
});

it('mirrors add, edit, delete, month move and emptying a month into rows', async () => {
  await put('2026-01', [d('a', '2026-01-04'), d('b', '2026-01-11')]);
  await expectInSync();
  expect(await db.donations.count()).toBe(2);

  await put('2026-01', [d('a', '2026-01-04', 5000), d('b', '2026-01-11'), d('c', '2026-01-18')]); // 수정 + 추가
  await expectInSync();
  expect((await db.donations.get(['2026-01-04', 'a']))!.amount).toBe(5000);

  await put('2026-01', [d('a', '2026-01-04', 5000)]); // 삭제
  await expectInSync();
  expect(await db.donations.count()).toBe(1);

  // 월 이동: 1월에서 빼고 2월에 넣기를 한 번에
  await transact(async () => ({ writes: [monthWrite('2026-01', []), monthWrite('2026-02', [d('a', '2026-02-01', 5000)])], result: null }));
  await expectInSync();
  expect(await db.kv.get(donationKey('2026-01'))).toBeUndefined();
  expect((await db.donations.get(['2026-02-01', 'a']))!.date).toBe('2026-02-01');
});

it('rolls the rows back together with the month array when the transaction fails', async () => {
  await put('2026-01', [d('a', '2026-01-04')]);
  await expect(
    transact(async () => ({ writes: [monthWrite('2026-01', [d('a', '2026-01-04'), d('z', '2026-01-05')]), { key: 'bad', value: () => 1 }], result: null })),
  ).rejects.toBeTruthy();
  await expectInSync();
  expect(await db.donations.count()).toBe(1);
});

it('removes the old key when a donation date changes inside the same month', async () => {
  await put('2026-01', [d('a', '2026-01-04')]);
  await put('2026-01', [d('a', '2026-01-25')]);
  await expectInSync();
  expect(await db.donations.count()).toBe(1);
  expect(await db.donations.get(['2026-01-04', 'a'])).toBeUndefined();
});
