// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { KEYS, monthWrite, transact } from '../services/storage/storageService';
import { REPORT_DELAY_MS, usePersonalReport, useReportFilters } from './useReports';

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const member = (id: string, name: string) => ({
  id,
  name,
  position: '',
  phoneLast4: '',
  isFamilyHead: true,
  familyGroupId: id,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const row = (id: string, memberId: string, date: string, amount: number) => ({
  id,
  date,
  memberId,
  donorDisplayName: memberId,
  familyGroupIdSnapshot: memberId, // 납부 당시 묶음(납부 당시 기준 조회에 필요)
  offeringTypeId: 't',
  amount,
  createdAt: id,
  updatedAt: '',
});

describe('usePersonalReport 합산 기준 전환', () => {
  it('기준을 바꾸는 동안 같은 성도의 내역을 비우지 않고, 성도를 바꾸면 이전 내역을 보이지 않습니다', async () => {
    await transact(async () => ({
      writes: [{ key: KEYS.members, value: [member('a', '김가'), member('b', '이나')] }, monthWrite('2026-11', [row('r1', 'a', '2026-11-08', 1000) as never])],
      result: 0,
    }));
    const { result, unmount } = renderHook(() => {
      const f = useReportFilters();
      return { f, r: usePersonalReport(f) };
    }, { wrapper: AppProviders });

    act(() => {
      result.current.f.setPeriodType('YEAR');
      result.current.f.setYear('2026');
    });
    await wait(REPORT_DELAY_MS + 50);
    act(() => result.current.r.select('a'));
    act(() => result.current.r.setMode('FAMILY'));
    await waitFor(() => expect(result.current.r.loading).toBe(false));
    expect(result.current.r.rows).toHaveLength(1);

    act(() => result.current.f.setBasis('SNAPSHOT'));
    expect(result.current.r.stale).toBe(true); // 새 결과를 기다리는 중
    expect(result.current.r.rows).toHaveLength(1); // 표를 비우지 않음
    await waitFor(() => expect(result.current.r.loading).toBe(false));
    expect(result.current.r.stale).toBe(false);
    expect(result.current.r.rows).toHaveLength(1);

    act(() => result.current.r.select('b'));
    expect(result.current.r.rows).toHaveLength(0); // 다른 성도의 이전 내역은 보이지 않음
    // 남은 예약 작업이 jsdom 환경이 닫힌 뒤 실행되어 "window is not defined"가 나지 않도록 기다린 뒤 해제
    await wait(REPORT_DELAY_MS + 50);
    unmount();
  });
});
