// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import type { ChangeEvent } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { useSettingsPage } from './useSettingsPage';

describe('useSettingsPage 복원 파일 검사', () => {
  it('손상된 .gz 파일이면 "확인 중" 문구를 남기지 않고 복원 불가를 알립니다', async () => {
    const { result } = renderHook(() => useSettingsPage(), { wrapper: AppProviders });
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'old.json.gz');
    const event = { target: { files: [file], value: 'x' } } as unknown as ChangeEvent<HTMLInputElement>;
    await act(() => result.current.onRestoreFile(event));
    await waitFor(() => expect(result.current.message?.kind).toBe('error'));
    expect(result.current.message?.text).toMatch(/^복원 불가/);
  });
});
