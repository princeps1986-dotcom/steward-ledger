// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAllData } from '../services/backup/backupService';
import { OfferingTypeProvider, useOfferingActions, useOfferingTypes } from './OfferingTypeContext';

const wrapper = ({ children }: { children: ReactNode }) => <OfferingTypeProvider>{children}</OfferingTypeProvider>;
const setup = () => renderHook(() => ({ types: useOfferingTypes(), actions: useOfferingActions() }), { wrapper });
const order = (types: { name: string; sortOrder: number }[]) => [...types].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.name);

beforeEach(async () => {
  await resetAllData();
});

describe('reorder', () => {
  it('주어진 순서대로 정렬 순서를 1..n으로 다시 매기고, 빠진 종류는 뒤에 붙입니다', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.types.length).toBeGreaterThan(3));
    const all = [...result.current.types].sort((a, b) => a.sortOrder - b.sortOrder);
    const [a, b, c] = all;

    await act(() => result.current.actions.reorder([c.id, a.id]));
    expect(order(result.current.types).slice(0, 3)).toEqual([c.name, a.name, b.name]);
    expect(result.current.types.map((t) => t.sortOrder).sort((x, y) => x - y)).toEqual(all.map((_, i) => i + 1));
  });

  it('없는 id는 무시하고, 비활성 종류도 순서에 포함하며, 다른 값은 바꾸지 않습니다', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.types.length).toBeGreaterThan(3));
    const all = [...result.current.types].sort((a, b) => a.sortOrder - b.sortOrder);
    const last = all[all.length - 1];
    await act(() => result.current.actions.save({ ...last, isActive: false }, last.id));
    await act(() => result.current.actions.reorder(['nope', last.id, all[0].id]));
    expect(order(result.current.types).slice(0, 2)).toEqual([last.name, all[0].name]);
    expect(result.current.types.find((t) => t.id === last.id)).toMatchObject({ isActive: false, quickAmounts: last.quickAmounts });
    expect(result.current.types).toHaveLength(all.length);
  });
});
