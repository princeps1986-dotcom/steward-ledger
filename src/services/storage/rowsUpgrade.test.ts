import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';

it('fills the row table from existing month arrays when upgrading from version 3, keeping the arrays', async () => {
  const old = new Dexie('church-offering-ledger');
  old.version(1).stores({ kv: '' });
  old.version(2).stores({ kv: '' });
  old.version(3).stores({ kv: '', donations: 'id, date, memberId, [date+memberId+offeringTypeId]' });
  const mk = (id: string, date: string) => ({ id, date, memberId: 'm1', donorDisplayName: '김', offeringTypeId: 't1', amount: 1, createdAt: 'x', updatedAt: 'x' });
  await old.table('kv').bulkPut([[mk('a', '2026-01-04'), mk('b', '2026-01-11')], [mk('c', '2026-02-01')]], ['donations_2026-01', 'donations_2026-02']);
  await old.table('donations').put(mk('stale', '2026-03-01')); // 이전 방식의 찌꺼기는 새 테이블로 넘어가지 않음
  old.close();

  const { db } = await import('./db');
  await db.open();
  expect(db.verno).toBe(5);
  expect((await db.donations.toArray()).map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  expect(await db.kv.get('meta_donation_rows_ready_v1')).toBe(true);
  expect(((await db.kv.get('donations_2026-01')) as unknown[]).length).toBe(2); // 월 배열은 그대로
  // 월 로드 = 기본키 날짜 범위 읽기
  const jan = await db.donations.where('[date+id]').between(['2026-01-01', Dexie.minKey], ['2026-01-31', Dexie.maxKey], true, true).toArray();
  expect(jan.map((r) => r.id)).toEqual(['a', 'b']);
});
