// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAllData } from '../services/backup/backupService';
import { donationKey, getItem, monthWrite, transact } from '../services/storage/storageService';
import { DonationProvider, useDonationMonths, useDonationSelector } from './DonationContext';
import type { AuditLog, Donation, DonationDraft } from './types';

// 읽기 실패를 흉내 내기 위해 getItem만 바꿔 끼웁니다(나머지는 실제 저장소 그대로).
const failing = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock('../services/storage/storageService', async (orig) => {
  const real = await orig<typeof import('../services/storage/storageService')>();
  return {
    ...real,
    getItem: (key: string) => (failing.keys.has(key) ? Promise.reject(new Error('읽기 실패')) : real.getItem(key)),
  };
});

const wrapper = ({ children }: { children: ReactNode }) => <DonationProvider>{children}</DonationProvider>;
const useAll = () => useDonationSelector((s) => s);
const setup = () => renderHook(() => useAll(), { wrapper });

const don = (id: string, date: string, memberId: string | null = 'm1', typeId = 't1', amount = 1000): Donation => ({
  id,
  date,
  memberId,
  donorDisplayName: '홍길동',
  familyGroupIdSnapshot: null,
  offeringTypeId: typeId,
  amount,
  createdAt: '2025-01-01T00:00:00.000Z',
});
const draft = (date: string, amount = 1000, typeId = 't1'): DonationDraft => ({
  date,
  memberId: 'm1',
  donorDisplayName: '홍길동',
  familyGroupIdSnapshot: null,
  offeringTypeId: typeId,
  amount,
});

async function seed(byMonth: Record<string, Donation[]>) {
  await transact(async () => ({ writes: Object.entries(byMonth).map(([ym, l]) => monthWrite(ym, l)), result: 0 }));
}

beforeEach(async () => {
  failing.keys.clear();
  await resetAllData();
});

describe('DonationContext', () => {
  it('저장하면 그 달의 배열만 바뀌고 다른 달 배열은 같은 객체로 유지된다', async () => {
    await seed({ '2025-01': [don('a', '2025-01-05')], '2025-02': [don('b', '2025-02-02')] });
    const { result } = setup();
    await act(() => result.current.actions.ensureMonths(['2025-01', '2025-02']));
    const jan = result.current.months['2025-01'];
    const feb = result.current.months['2025-02'];
    await act(() => result.current.actions.saveBatch([draft('2025-02-09', 500, 't2')], 'MERGE').then(() => undefined));
    expect(result.current.months['2025-01']).toBe(jan);
    expect(result.current.months['2025-02']).not.toBe(feb);
    expect(result.current.months['2025-02']).toHaveLength(2);
  });

  it('달을 읽는 도중 저장이 커밋되면 다시 읽어 최신 값이 된다', async () => {
    await seed({ '2025-03': [don('a', '2025-03-02')] });
    const { result } = setup();
    await act(async () => {
      const load = result.current.actions.ensureMonths(['2025-03']);
      await result.current.actions.saveBatch([draft('2025-03-09', 300, 't2')], 'MERGE');
      await load;
    });
    await waitFor(() => expect(result.current.months['2025-03']?.map((d) => d.amount).sort((a, b) => a - b)).toEqual([300, 1000]));
  });

  it('복원·초기화(reloadAll) 중에 끝난 옛 읽기 결과는 버려진다', async () => {
    await seed({ '2025-04': [don('a', '2025-04-06')] });
    const { result } = setup();
    await act(async () => {
      const load = result.current.actions.ensureMonths(['2025-04']);
      await result.current.actions.reloadAll();
      await load;
    });
    expect(result.current.months['2025-04']).toBeUndefined();
    // 버려진 뒤에도 다시 불러올 수 있어야 한다.
    await act(() => result.current.actions.ensureMonths(['2025-04']));
    expect(result.current.months['2025-04']).toHaveLength(1);
  });

  it('읽기가 실패해도 다음에 다시 불러올 수 있다', async () => {
    await seed({ '2025-05': [don('a', '2025-05-04')] });
    const { result } = setup();
    failing.keys.add(donationKey('2025-05'));
    await act(() => result.current.actions.ensureMonths(['2025-05']));
    expect(result.current.months['2025-05']).toBeUndefined();
    failing.keys.clear();
    await act(() => result.current.actions.ensureMonths(['2025-05']));
    expect(result.current.months['2025-05']).toHaveLength(1);
  });

  it('수정으로 달·연도를 옮기면 두 달이 함께 갱신되고 새 연도에 이력이 남는다', async () => {
    const orig = don('a', '2025-12-28');
    await seed({ '2025-12': [orig] });
    const { result } = setup();
    await act(() => result.current.actions.ensureMonths(['2025-12', '2026-01']));
    await act(() => result.current.actions.updateDonation(orig, { ...orig, date: '2026-01-04' }, '날짜 정정'));
    expect(result.current.months['2025-12']).toHaveLength(0);
    expect(result.current.months['2026-01']?.map((d) => d.id)).toEqual(['a']);
    const logs = (await getItem<AuditLog[]>('audit_logs_2026')) ?? [];
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'UPDATE', reason: '날짜 정정' });
    await waitFor(() => expect(result.current.years).toEqual(['2026']));
  });

  it('되돌리기는 저장한 내역이 다른 달로 옮겨졌어도 찾아서 지운다', async () => {
    const { result } = setup();
    await act(() => result.current.actions.ensureMonths(['2025-06', '2025-07']));
    await act(async () => {
      await result.current.actions.saveBatch([draft('2025-06-08')], 'MERGE');
    });
    const created = result.current.months['2025-06']![0];
    await act(() => result.current.actions.updateDonation(created, { ...created, date: '2025-07-06' }, '이동'));
    expect(result.current.months['2025-07']).toHaveLength(1);
    await act(async () => {
      await result.current.actions.undoLast();
    });
    expect(result.current.months['2025-07']).toHaveLength(0);
    expect(result.current.history).toHaveLength(0);
  });

  it('연도 5개를 차례로 열어도 메모리에는 최대 3개 연도만 남는다', async () => {
    const data: Record<string, Donation[]> = {};
    for (const y of ['2021', '2022', '2023', '2024', '2025']) data[`${y}-01`] = [don(`d${y}`, `${y}-01-03`)];
    await seed(data);
    const { result } = setup();
    for (const y of ['2021', '2022', '2023', '2024', '2025']) await act(() => result.current.actions.ensureYear(y));
    expect([...new Set(Object.keys(result.current.months).map((m) => m.slice(0, 4)))]).toEqual(['2023', '2024', '2025']);
  });

  it('화면이 사용 중인 연도는 한도를 넘어도 내려가지 않는다', async () => {
    const data: Record<string, Donation[]> = {};
    for (const y of ['2021', '2022', '2023', '2024']) data[`${y}-01`] = [don(`d${y}`, `${y}-01-03`)];
    await seed(data);
    const { result } = setup();
    let unpin = () => undefined as void;
    await act(async () => {
      unpin = result.current.actions.pinMonths(['2021-01']);
      for (const y of ['2021', '2022', '2023', '2024']) await result.current.actions.ensureYear(y);
    });
    const years = new Set(Object.keys(result.current.months).map((m) => m.slice(0, 4)));
    // 사용 중인 2021은 유지하고, 나머지에서 가장 오래 쓰지 않은 2022가 내려가 총 3개 연도가 남는다.
    expect([...years].sort()).toEqual(['2021', '2023', '2024']);
    await act(async () => unpin());
    await act(() => result.current.actions.ensureYear('2022')); // 사용 중이 아니게 된 연도는 이제 한도에 따라 내려갈 수 있다
    const after = new Set(Object.keys(result.current.months).map((m) => m.slice(0, 4)));
    expect(after.size).toBe(3);
    expect(after.has('2022')).toBe(true);
  });

  it('useDonationMonths는 달을 불러오고 다른 달에 저장해도 같은 배열을 돌려준다', async () => {
    await seed({ '2025-08': [don('a', '2025-08-03')] });
    const { result } = renderHook(() => ({ list: useDonationMonths(['2025-08']), s: useAll() }), { wrapper });
    await waitFor(() => expect(result.current.list).toHaveLength(1));
    const before = result.current.list;
    await act(async () => {
      await result.current.s.actions.saveBatch([draft('2025-09-07')], 'MERGE');
    });
    expect(result.current.list).toBe(before);
  });

  it('달을 비우면 연도 목록에서 사라지고, 연도 목록은 마지막 읽기 결과를 따른다', async () => {
    const only = don('a', '2025-10-05');
    await seed({ '2025-10': [only] });
    const { result } = setup();
    await waitFor(() => expect(result.current.years).toEqual(['2025']));
    await act(() => result.current.actions.deleteDonation(only, '삭제'));
    await waitFor(() => expect(result.current.years).toEqual([]));
  });
});
