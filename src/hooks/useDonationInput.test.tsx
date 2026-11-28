// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { useMemberActions } from '../contexts/MemberContext';
import { EMPTY_MEMBER_DRAFT } from '../services/domain/memberRules';
import { readMonth } from '../services/storage/storageService';
import { useDonationInput } from './useDonationInput';

describe('useDonationInput 성도 검색', () => {
  it('이름이 같은 성도가 여럿이면 Enter만으로 첫 사람을 고르지 않고, ↓로 고른 뒤 Enter를 누르면 고른다', async () => {
    const { result } = renderHook(() => ({ input: useDonationInput(), members: useMemberActions() }), { wrapper: AppProviders });
    await waitFor(() => expect(result.current.input.primaryTypes.length).toBeGreaterThan(0));
    await act(() => result.current.members.saveMember({ ...EMPTY_MEMBER_DRAFT, name: '동명테스트', phoneLast4: '1111' }));
    await act(() => result.current.members.saveMember({ ...EMPTY_MEMBER_DRAFT, name: '동명테스트', phoneLast4: '2222' }));
    const key = (k: string) => act(() => result.current.input.search.onSearchKeyDown({ key: k, preventDefault() {}, nativeEvent: {} } as never));

    act(() => result.current.input.search.onQueryChange('동명테스트'));
    await key('Enter');
    expect(result.current.input.message?.text).toContain('같은 이름이 2명');
    expect(result.current.input.search.selectedLabel).toBe('');

    await key('ArrowDown');
    await key('Enter');
    expect(result.current.input.search.selectedLabel).toContain('동명테스트');
  });
});

describe('useDonationInput 저장 흐름', () => {
  it('큰 금액은 확인을 받은 뒤 한 번만 저장합니다', async () => {
    const { result } = renderHook(() => useDonationInput(), { wrapper: AppProviders });
    await waitFor(() => expect(result.current.primaryTypes.length).toBeGreaterThan(0));
    const typeId = result.current.primaryTypes[0].id;

    act(() => {
      result.current.setDate('2026-11-08');
      result.current.search.toggleAnonymous();
    });
    act(() => result.current.onAmountChange(typeId, '20000000'));

    await act(() => result.current.requestSave());
    expect(result.current.largeAmount.pending?.items).toEqual([expect.objectContaining({ amount: 20_000_000 })]);
    expect(await readMonth('2026-11')).toHaveLength(0); // 확인 전에는 저장하지 않음

    // 확인 단추를 연달아 눌러도 한 번만 저장
    const confirm = result.current.largeAmount.onConfirm;
    await act(() => Promise.all([confirm(), confirm()]));
    await waitFor(() => expect(result.current.message?.kind).toBe('info'));
    const rows = await readMonth('2026-11');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ offeringTypeId: typeId, amount: 20_000_000, memberId: null });
    expect(result.current.largeAmount.pending).toBeNull();
    expect(result.current.amounts[typeId] ?? '').toBe(''); // 저장 뒤 입력 칸을 비움
  });

  it('잠금 화면이 떠 있으면 Ctrl+Z로 마지막 저장을 되돌리지 않습니다', async () => {
    const { result } = renderHook(() => useDonationInput(), { wrapper: AppProviders });
    await waitFor(() => expect(result.current.primaryTypes.length).toBeGreaterThan(0));
    const typeId = result.current.primaryTypes[0].id;
    act(() => {
      result.current.setDate('2026-10-18');
      result.current.search.toggleAnonymous();
    });
    act(() => result.current.onAmountChange(typeId, '10000'));
    await act(() => result.current.requestSave());
    await waitFor(() => expect(result.current.message?.kind).toBe('info'));
    expect(await readMonth('2026-10')).toHaveLength(1);

    const lock = document.createElement('div');
    lock.setAttribute('data-lock-screen', '');
    document.body.appendChild(lock);
    const ctrlZ = () => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    await ctrlZ();
    await act(() => new Promise((r) => setTimeout(r, 300))); // 복구하기는 비동기라 끝날 시간을 줍니다
    expect(await readMonth('2026-10')).toHaveLength(1); // 잠금 중에는 그대로

    lock.remove();
    await ctrlZ();
    await waitFor(async () => expect(await readMonth('2026-10')).toHaveLength(0)); // 잠금을 풀면 복구하기가 동작
  });
});
