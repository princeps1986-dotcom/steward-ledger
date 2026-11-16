import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

// 이 시험은 개발 의존성으로만 남겨 둔 localForage(실제 이전 버전이 쓰던 라이브러리)로 데이터를 먼저 만든 뒤,
// 새 저장소 코드(Dexie)가 그 데이터를 옮기지 않고 그대로 읽는지 확인합니다.
describe('upgrade from localForage data', () => {
  it('reads data that localForage created and runs the one-time migrations on upgrade', async () => {
    (globalThis as unknown as { window?: unknown }).window ??= globalThis;
    const localforage = (await import('localforage')).default;
    const legacy = localforage.createInstance({ name: 'church-offering-ledger', storeName: 'kv' });
    await legacy.setItem('members', [{ id: 'm1', name: '김철수', position: '성도', isActive: true }]);
    await legacy.setItem('settings', { largeAmountThreshold: 100_000_000, theme: 'LIGHT' });
    await legacy.setItem('donations_2025', [
      { id: 'y1', date: '2025-12-28', memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't', amount: 1000 },
      { id: 'y2', date: '2025-01-05', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 2000 },
    ]);
    await legacy.setItem('donations_2026-03', [{ id: 'd1', date: '2026-03-01', memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't', amount: 100000 }]);
    await legacy.setItem('offering_types', [{ id: 't', name: '십일조', displayArea: 'PRIMARY', quickAmounts: [10000], sortOrder: 1, isActive: true }]);
    await legacy.setItem('meta_dirty_since_backup', true);
    // localForage는 확인용 저장소를 하나 더 만들어 데이터베이스 버전이 2가 됩니다(실제 사용자 데이터와 같은 모양).
    const before = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('church-offering-ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    expect(before.version).toBeGreaterThanOrEqual(1);
    before.close();

    const { getItem, listDonationMonths, listDonationYears, readMonth, transact, rowWrite, isDirtySinceBackup } = await import('./storageService');
    // 업그레이드 때 1회 보정이 실행됩니다: 직분 '성도' 정리, 큰 금액 기준 보정, 연도 키 → 월 키
    expect(await getItem('members')).toEqual([{ id: 'm1', name: '김철수', position: '', isActive: true }]);
    expect(((await getItem('settings')) as { largeAmountThreshold: number }).largeAmountThreshold).toBe(10_000_000);
    expect(await getItem('donations_2025')).toBeNull();
    expect((await readMonth('2025-12')).map((x) => x.id)).toEqual(['y1']);
    expect((await readMonth('2025-01')).map((x) => x.id)).toEqual(['y2']);
    expect(await getItem('meta_migration_donations_monthly_v1')).toBe(true);
    expect(await getItem('donations_2026-03')).toBeNull(); // 월 배열은 행으로 옮겨진 뒤 지워집니다
    expect(await listDonationMonths()).toEqual(['2025-01', '2025-12', '2026-03']);
    expect(await listDonationYears()).toEqual(['2025', '2026']);
    expect(await isDirtySinceBackup()).toBe(true);

    // 새 코드로 쓴 값도 정상이며, 기존 값은 그대로입니다.
    await transact(async () => ({
      writes: [rowWrite('2026-03', { puts: [{ id: 'd2', date: '2026-03-08', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 20000, createdAt: 'x', updatedAt: 'x' } as never], deletes: [] })],
      result: 0,
    }));
    expect((await readMonth('2026-03')).length).toBe(2);
    expect(((await getItem('offering_types')) as { name: string }[]).some((t) => t.name === '십일조')).toBe(true);
  });
});
