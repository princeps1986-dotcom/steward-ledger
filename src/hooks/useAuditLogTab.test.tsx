// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import type { AuditLog, Donation } from '../contexts/types';
import { auditAppend, transact } from '../services/storage/storageService';
import { REPORT_DELAY_MS, useAuditLogTab, useReportFilters } from './useReports';

describe('useAuditLogTab', () => {
  it('헌금을 모두 지워 헌금 연도 목록에 없는 해의 삭제 이력도 보여 준다', async () => {
    const before = { id: 'd1', date: '2024-03-03', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: 'c' } as Donation;
    const log: AuditLog = { id: 'l1', targetId: 'd1', action: 'DELETE', beforeSnapshot: before, afterSnapshot: null, reason: '잘못 입력한 내역', timestamp: '2024-03-03T01:00:00.000Z' };
    await transact(async () => ({ writes: [auditAppend('2024', [log])], result: 0 })); // 2024년에는 헌금이 하나도 없음
    const { result } = renderHook(() => {
      const f = useReportFilters();
      return { f, logs: useAuditLogTab(f) };
    }, { wrapper: AppProviders });
    await waitFor(() => expect(result.current.f.yearOptions).toContain('2024')); // 연도 목록에서도 고를 수 있음
    act(() => {
      result.current.f.setPeriodType('YEAR');
      result.current.f.setYear('2024');
    });
    await act(() => new Promise<void>((r) => setTimeout(r, REPORT_DELAY_MS + 50)));
    await waitFor(() => expect(result.current.logs.map((l) => l.id)).toEqual(['l1']));
    expect(result.current.logs[0].actionLabel).toBe('삭제');
  });
});
