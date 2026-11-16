import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { db } from './db';

it('has an empty, indexed donations table next to kv', async () => {
  await db.open();
  expect(db.tables.map((t) => t.name).sort()).toEqual(['donations', 'kv']);
  expect(await db.donations.count()).toBe(0);
  await db.donations.put({ id: 'a', date: '2026-01-04', memberId: 'm1', offeringTypeId: 't1' });
  expect((await db.donations.where('memberId').equals('m1').toArray()).length).toBe(1);
  expect(await db.donations.where('[date+memberId+offeringTypeId]').equals(['2026-01-04', 'm1', 't1']).count()).toBe(1);
  await db.donations.clear();
});
