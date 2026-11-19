// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DonationProvider, useDonationActions } from '../contexts/DonationContext';
import { REPORT_DELAY_MS, useReportFilters } from './useReports';

const wrapper = ({ children }: { children: ReactNode }) => <DonationProvider>{children}</DonationProvider>;
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe('useReportFilters 주별/일별 갱신', () => {
  it('같은 주(일~토) 안에서 날짜만 바꾸면 다시 계산하지 않고, 다른 주로 바꾸면 갱신합니다', async () => {
    const { result } = renderHook(() => useReportFilters(), { wrapper });
    act(() => result.current.setWeekDate('2026-11-15')); // 일요일
    await wait(REPORT_DELAY_MS + 50);
    const week = result.current.week;
    const donations = result.current.donations;
    expect(week).toEqual({ start: '2026-11-15', end: '2026-11-21' });

    act(() => result.current.setWeekDate('2026-11-18')); // 같은 주
    expect(result.current.pending).toBe(false);
    expect(result.current.week).toBe(week);
    expect(result.current.donations).toBe(donations);
    expect(result.current.weekDate).toBe('2026-11-18'); // 입력 칸 값은 그대로 보입니다

    act(() => result.current.setWeekDate('2026-11-22')); // 다음 주
    expect(result.current.pending).toBe(true);
    await wait(REPORT_DELAY_MS + 50);
    expect(result.current.pending).toBe(false);
    expect(result.current.week).toEqual({ start: '2026-11-22', end: '2026-11-28' });
  });

  it('일별은 날짜마다 갱신합니다', async () => {
    const { result } = renderHook(() => useReportFilters(), { wrapper });
    act(() => result.current.setPeriodType('DAY'));
    await wait(REPORT_DELAY_MS + 50);
    act(() => result.current.setWeekDate('2026-11-17'));
    await wait(REPORT_DELAY_MS + 50);
    act(() => result.current.setWeekDate('2026-11-18'));
    expect(result.current.pending).toBe(true);
    await wait(REPORT_DELAY_MS + 50);
    expect(result.current.week).toEqual({ start: '2026-11-18', end: '2026-11-18' });
  });
});

describe('useReportFilters 분기·연도 요약', () => {
  it('연도별은 내역을 올리지 않고 달별 합계만 구하며, 저장하면 바뀐 달만 다시 합산합니다', async () => {
    const { transact, monthWrite, rowWrite } = await import('../services/storage/storageService');
    const row = (id: string, date: string, amount: number) => ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount, createdAt: id, updatedAt: '' });
    await transact(async () => ({ writes: [monthWrite('2024-03', [row('a', '2024-03-03', 1000) as never])], result: 0 }));
    const { result } = renderHook(() => ({ f: useReportFilters(), actions: useDonationActions() }), { wrapper });
    act(() => {
      result.current.f.setPeriodType('YEAR');
      result.current.f.setYear('2024');
    });
    await wait(REPORT_DELAY_MS + 50);
    await waitFor(() => expect(result.current.f.pending).toBe(false));
    expect(result.current.f.donations).toHaveLength(0); // 메모리에 올리지 않음
    expect(result.current.f.monthSums?.get('2024-03')?.get('t')).toEqual({ amount: 1000, anonymous: 1000, count: 1 });
    await transact(async () => ({ writes: [rowWrite('2024-03', { puts: [row('b', '2024-03-10', 500) as never], deletes: [] })], result: 0 }));
    await act(() => result.current.actions.reloadAll());
    await waitFor(() => expect(result.current.f.monthSums?.get('2024-03')?.get('t')?.amount).toBe(1500));
  });

  it('합계를 읽지 못하면 불러오는 중을 끝내고 실패로 알립니다', async () => {
    const { db } = await import('../services/storage/db');
    const { result } = renderHook(() => useReportFilters(), { wrapper });
    await waitFor(() => expect(result.current.pending).toBe(false));
    db.close({ disableAutoOpen: true }); // 이후 읽기가 모두 실패
    try {
      act(() => {
        result.current.setPeriodType('YEAR');
        result.current.setYear('2023');
      });
      await wait(REPORT_DELAY_MS + 50);
      await waitFor(() => expect(result.current.loadFailed).toBe(true));
      expect(result.current.pending).toBe(false);
    } finally {
      await db.open();
    }
  });
});
