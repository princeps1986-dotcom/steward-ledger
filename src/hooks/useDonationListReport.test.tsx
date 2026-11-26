// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { monthWrite, transact } from '../services/storage/storageService';
import { REPORT_DELAY_MS, useDonationListReport, useReportFilters } from './useReports';

// 전체 입력 내역이 달을 읽을 때만 실패시키는 스위치(다른 읽기는 그대로)
const fail = vi.hoisted(() => ({ month: '' }));
vi.mock('../services/storage/storageService', async (orig) => {
  const real = await orig<typeof import('../services/storage/storageService')>();
  return { ...real, readMonth: (ym: string) => (ym === fail.month ? Promise.reject(new Error('읽기 실패')) : real.readMonth(ym)) };
});

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const row = (id: string, date: string) => ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: id, updatedAt: '' });

describe('useDonationListReport 입력일', () => {
  it('입력 시각을 한국 시간으로 주고, 잘못된 값은 빈 칸으로 둡니다', async () => {
    const rows = [row('a', '2026-10-04'), row('b', '2026-10-04')];
    rows[0].createdAt = '2026-10-04T15:30:00.000Z';
    rows[1].createdAt = '';
    await transact(async () => ({ writes: [monthWrite('2026-10', rows as never)], result: 0 }));
    const { result } = renderHook(() => {
      const f = useReportFilters();
      return { f, r: useDonationListReport(f) };
    }, { wrapper: AppProviders });
    act(() => {
      result.current.f.setPeriodType('MONTH');
      result.current.f.setYear('2026');
      result.current.f.setPeriodValue(10);
    });
    await wait(REPORT_DELAY_MS + 50);
    await waitFor(() => expect([0, 1].map((i) => result.current.r.rowAt(i).enteredAt).sort()).toEqual(['', '2026-10-05 00:30:00']), { timeout: 3000 });
  });
});

describe('useDonationListReport 읽기 실패', () => {
  it('어느 달을 읽지 못하면 failed로 알리고, 다시 읽을 수 있게 되면 표시를 지웁니다', async () => {
    await transact(async () => ({ writes: [monthWrite('2026-11', [row('a', '2026-11-08') as never])], result: 0 }));
    fail.month = '2026-11';
    const { result } = renderHook(() => {
      const f = useReportFilters();
      return { f, r: useDonationListReport(f) };
    }, { wrapper: AppProviders });
    act(() => {
      result.current.f.setPeriodType('MONTH');
      result.current.f.setYear('2026');
      result.current.f.setPeriodValue(11);
    });
    await wait(REPORT_DELAY_MS + 50);
    act(() => result.current.r.setQuery('무명')); // 검색어가 있으면 건수·합계를 달을 읽어 구함
    await waitFor(() => expect(result.current.r.failed).toBe(true), { timeout: 3000 });
    expect(result.current.r.count).toBe(0);

    fail.month = '';
    act(() => result.current.r.setQuery('무명1'));
    await waitFor(() => expect(result.current.r.count).toBe(1), { timeout: 3000 });
    expect(result.current.r.failed).toBe(false);
  });
});
