// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { useDonationActions } from '../contexts/DonationContext';
import type { Donation } from '../contexts/types';
import { monthWrite, transact } from '../services/storage/storageService';
import { useHistoryItems } from './useHistoryItems';

describe('useHistoryItems', () => {
  it('최근 입력의 무명 내역을 같은 번호가 있는 날로 옮기면 목록에도 바뀐 이름을 보여 준다', async () => {
    const other = { id: 'x1', date: '2025-03-09', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 500, createdAt: 'c' } as Donation;
    await transact(async () => ({ writes: [monthWrite('2025-03', [other])], result: 0 }));
    const { result } = renderHook(() => ({ items: useHistoryItems(), actions: useDonationActions() }), { wrapper: AppProviders });
    await act(() => result.current.actions.ensureMonths(['2025-03']));
    let saved!: Donation;
    await act(async () => {
      const batch = await result.current.actions.saveBatch(
        [{ date: '2025-03-02', memberId: null, donorDisplayName: '무명1', familyGroupIdSnapshot: null, offeringTypeId: 't', amount: 1000 }],
        'SEPARATE',
      );
      saved = batch.createdAfter[0];
    });
    expect(result.current.items[0].donorDisplayName).toBe('무명1');
    await act(() => result.current.actions.updateDonation(saved, { ...saved, date: '2025-03-09' }, '날짜를 잘못 입력함'));
    await waitFor(() => expect(result.current.items[0].donorDisplayName).toBe('무명2'));
  });
});
