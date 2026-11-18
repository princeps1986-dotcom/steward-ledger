// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAllData } from '../services/backup/backupService';
import { donationKey, getItem, monthWrite, transact } from '../services/storage/storageService';
import { DonationProvider, useDonationMonths, useDonationSelector, useMonthVersions } from './DonationContext';
import type { AuditLog, Donation, DonationDraft } from './types';

// 읽기 실패를 흉내 내기 위해 readMonth만 바꿔 끼웁니다(나머지는 실제 저장소 그대로).
const failing = vi.hoisted(() => ({ keys: new Set<string>() }));
vi.mock('../services/storage/storageService', async (orig) => {
  const real = await orig<typeof import('../services/storage/storageService')>();
  return {
    ...real,
    readMonth: (ym: string) => (failing.keys.has(`donations_${ym}`) ? Promise.reject(new Error('읽기 실패')) : real.readMonth(ym)),
  };
});

const wrapper = ({ children }: { children: ReactNode }) => <DonationProvider>{children}</DonationProvider>;
const useAll = () => useDonationSelector((s) => s);
const setup = () => renderHook(() => useAll(), { wrapper });
// 달마다 1건씩 넣은 시험 데이터에서 '연도 3개'에 해당하는 건수 예산
const smallBudget = ({ children }: { children: ReactNode }) => <DonationProvider maxLoadedRows={3}>{children}</DonationProvider>;

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

  it('수정으로 같은 날짜·성도·종류의 다른 내역과 겹치게 되면 거절하고 아무것도 바꾸지 않는다', async () => {
    const a = don('a', '2025-03-02', 'm1', 't1');
    const b = don('b', '2025-03-02', 'm1', 't2');
    await seed({ '2025-03': [a, b] });
    const { result } = setup();
    await act(() => result.current.actions.ensureMonths(['2025-03']));
    await expect(result.current.actions.updateDonation(b, { ...b, offeringTypeId: 't1' }, '종류 오기입')).rejects.toThrow('이미 있습니다');
    expect(result.current.months['2025-03']?.map((d) => d.offeringTypeId).sort()).toEqual(['t1', 't2']);
    expect(await getItem<AuditLog[]>('audit_logs_2025')).toBeFalsy();
  });

  it('금액만 고치는 수정과 무명 내역의 수정은 겹침 검사에 걸리지 않는다', async () => {
    const a = don('a', '2025-03-02', 'm1', 't1');
    const x = don('x', '2025-03-02', null, 't1');
    const y = don('y', '2025-03-02', null, 't2');
    await seed({ '2025-03': [a, x, y] });
    const { result } = setup();
    await act(() => result.current.actions.ensureMonths(['2025-03']));
    await act(() => result.current.actions.updateDonation(a, { ...a, amount: 2000 }, '금액 오기입'));
    await act(() => result.current.actions.updateDonation(y, { ...y, offeringTypeId: 't1' }, '종류 오기입'));
    expect(result.current.months['2025-03']?.find((d) => d.id === 'a')?.amount).toBe(2000);
    expect(result.current.months['2025-03']?.find((d) => d.id === 'y')?.offeringTypeId).toBe('t1');
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

  it('건수 예산을 넘으면 오래 쓰지 않은 연도부터 내려가 메모리에는 예산 안의 연도만 남는다', async () => {
    const data: Record<string, Donation[]> = {};
    for (const y of ['2021', '2022', '2023', '2024', '2025']) data[`${y}-01`] = [don(`d${y}`, `${y}-01-03`)];
    await seed(data);
    const { result } = renderHook(() => useAll(), { wrapper: smallBudget });
    for (const y of ['2021', '2022', '2023', '2024', '2025']) await act(() => result.current.actions.ensureYear(y));
    expect([...new Set(Object.keys(result.current.months).map((m) => m.slice(0, 4)))]).toEqual(['2023', '2024', '2025']);
  });

  it('화면이 사용 중인 연도는 한도를 넘어도 내려가지 않는다', async () => {
    const data: Record<string, Donation[]> = {};
    for (const y of ['2021', '2022', '2023', '2024']) data[`${y}-01`] = [don(`d${y}`, `${y}-01-03`)];
    await seed(data);
    const { result } = renderHook(() => useAll(), { wrapper: smallBudget });
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

describe('monthVersions', () => {
  it('bumps the version of a month on save even when that month is not loaded in memory', async () => {
    const { result } = renderHook(() => ({ s: useAll(), v: useMonthVersions() }), { wrapper });
    expect(result.current.v['2025-09']).toBeUndefined();
    await act(async () => {
      await result.current.s.actions.saveBatch([draft('2025-09-07')], 'MERGE');
    });
    expect(result.current.v['2025-09']).toBe(1);
    expect(result.current.v['2025-10']).toBeUndefined();
  });
});
