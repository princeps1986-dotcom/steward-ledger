// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DonationProvider } from '../contexts/DonationContext';
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
