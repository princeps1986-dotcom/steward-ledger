import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

// 이 시험은 개발 의존성으로만 남겨 둔 localForage(실제 이전 버전이 쓰던 라이브러리)로 데이터를 먼저 만든 뒤,
// 새 저장소 코드(Dexie)가 그 데이터를 옮기지 않고 그대로 읽는지 확인합니다.
describe('upgrade from localForage data', () => {
  it('reads and writes data that localForage created, without a migration step', async () => {
    (globalThis as unknown as { window?: unknown }).window ??= globalThis;
    const localforage = (await import('localforage')).default;
    const legacy = localforage.createInstance({ name: 'church-offering-ledger', storeName: 'kv' });
    await legacy.setItem('members', [{ id: 'm1', name: '김철수', isActive: true }]);
    await legacy.setItem('donations_2026-03', [{ id: 'd1', date: '2026-03-01', memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't', amount: 100000 }]);
    await legacy.setItem('offering_types', [{ id: 't', name: '십일조' }]);
    await legacy.setItem('meta_dirty_since_backup', true);
    // localForage는 확인용 저장소를 하나 더 만들어 데이터베이스 버전이 2가 됩니다(실제 사용자 데이터와 같은 모양).
    const before = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('church-offering-ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    expect(before.version).toBeGreaterThanOrEqual(1);
    before.close();

    const { getItem, listDonationKeys, listDonationYears, transact, monthWrite, isDirtySinceBackup } = await import('./storageService');
    expect(await getItem('members')).toEqual([{ id: 'm1', name: '김철수', isActive: true }]);
    expect(await listDonationKeys()).toEqual(['donations_2026-03']);
    expect(await listDonationYears()).toEqual(['2026']);
    expect(await isDirtySinceBackup()).toBe(true);

    // 새 코드로 쓴 값도 정상이며, 기존 값은 그대로입니다.
    await transact(async (read) => {
      const cur = (await read<unknown[]>('donations_2026-03')) ?? [];
      return { writes: [monthWrite('2026-03', [...cur, { id: 'd2', date: '2026-03-08', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 20000 }] as never)], result: 0 };
    });
    expect(((await getItem<unknown[]>('donations_2026-03')) ?? []).length).toBe(2);
    expect(await getItem('offering_types')).toEqual([{ id: 't', name: '십일조' }]);
  });
});
