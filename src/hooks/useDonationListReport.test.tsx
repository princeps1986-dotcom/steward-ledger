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
