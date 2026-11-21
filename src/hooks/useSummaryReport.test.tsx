// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import type { Donation } from '../contexts/types';
import { monthWrite, transact } from '../services/storage/storageService';
import { REPORT_DELAY_MS, useReportFilters, useSummaryReport } from './useReports';

describe('useSummaryReport', () => {
  it('종류 목록에 없는 종류의 헌금도 (삭제된 종류) 줄로 보여 줘서 줄 합계가 총합과 맞는다', async () => {
    const d = { id: 'g1', date: '2024-05-05', memberId: null, donorDisplayName: '무명1', offeringTypeId: 'gone', amount: 7000, createdAt: 'c' } as Donation;
    await transact(async () => ({ writes: [monthWrite('2024-05', [d])], result: 0 }));
    const { result } = renderHook(() => {
      const f = useReportFilters();
      return { f, r: useSummaryReport(f) };
    }, { wrapper: AppProviders });
    act(() => {
      result.current.f.setPeriodType('YEAR');
      result.current.f.setYear('2024');
    });
    await act(() => new Promise<void>((r) => setTimeout(r, REPORT_DELAY_MS + 50)));
    await waitFor(() => expect(result.current.r.total).toBe(7000));
    const gone = result.current.r.rows.find((row) => row.id === 'gone');
    expect(gone?.name).toBe('(삭제된 종류)');
    expect(result.current.r.rows.reduce((s, row) => s + row.total, 0)).toBe(result.current.r.total);
  });
});
