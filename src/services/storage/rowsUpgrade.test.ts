import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';

it('moves existing month arrays into rows when upgrading from version 3, then removes the arrays', async () => {
  const old = new Dexie('church-offering-ledger');
  old.version(1).stores({ kv: '' });
  old.version(2).stores({ kv: '' });
  old.version(3).stores({ kv: '', donations: 'id, date, memberId, [date+memberId+offeringTypeId]' });
  const mk = (id: string, date: string, offeringTypeId = 't1') => ({ id, date, memberId: 'm1', donorDisplayName: '김', offeringTypeId, amount: 1, createdAt: 'x', updatedAt: 'x' });
  await old.table('kv').bulkPut(
    [[mk('a', '2026-01-04'), mk('b', '2026-01-11', 't2')], [mk('c', '2026-02-01'), mk('c', '2026-02-01')]], // 같은 날짜·id가 겹친 중복은 한 행으로
    ['donations_2026-01', 'donations_2026-02'],
  );
  await old.table('kv').put(true, 'meta_donation_rows_ready_v1');
  await old.table('donations').put(mk('stale', '2026-03-01')); // 이전 방식의 찌꺼기는 새 테이블로 넘어가지 않음
  old.close();

  const { db } = await import('./db');
  await db.open();
  expect(db.verno).toBe(6);
  expect((await db.donations.toArray()).map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  expect((await db.kv.toCollection().primaryKeys()).map(String).filter((k) => k.startsWith('donations_') || k.startsWith('meta_donation'))).toEqual([]);
  expect(await db.donations.where('offeringTypeId').equals('t2').count()).toBe(1);
  // 월 로드 = 기본키 날짜 범위 읽기
  const jan = await db.donations.where('[date+id]').between(['2026-01-01', Dexie.minKey], ['2026-01-31', Dexie.maxKey], true, true).toArray();
  expect(jan.map((r) => r.id)).toEqual(['a', 'b']);
});
