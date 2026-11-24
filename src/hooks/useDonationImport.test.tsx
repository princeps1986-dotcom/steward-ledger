// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { useMemberActions } from '../contexts/MemberContext';
import { EMPTY_MEMBER_DRAFT } from '../services/domain/memberRules';
import { readImportFile } from '../services/import/memberImportService';
import { readMonth } from '../services/storage/storageService';
import { useDonationImport } from './useDonationImport';

vi.mock('../services/import/memberImportService', async (orig) => ({
  ...(await orig<typeof import('../services/import/memberImportService')>()),
  readImportFile: vi.fn(),
}));

const noop = () => {};
const fileEvent = { target: { files: [new File([''], 'donations.csv')], value: 'x' } } as unknown as ChangeEvent<HTMLInputElement>;

/** 성도 한 명을 명단에 넣고 가져오기 화면을 엽니다. 테스트끼리 DB를 공유하므로 이름을 나눠 씁니다. */
async function setup(name: string, phone: string) {
  const { result } = renderHook(() => ({ imp: useDonationImport(noop, '2026-09-06'), members: useMemberActions() }), { wrapper: AppProviders });
  await waitFor(() => expect(result.current.imp.busy).toBe(false));
  await act(() => result.current.members.saveMember({ ...EMPTY_MEMBER_DRAFT, name, phoneLast4: phone }));
  return result;
}

async function loadFile(result: Awaited<ReturnType<typeof setup>>, rows: Record<string, string>[]) {
  vi.mocked(readImportFile).mockResolvedValue(rows);
  await act(() => result.current.imp.onFile(fileEvent));
  await waitFor(() => expect(result.current.imp.preview.length).toBe(rows.length));
}

describe('useDonationImport 저장 흐름', () => {
  beforeEach(() => {
    vi.mocked(readImportFile).mockReset();
  });

  it('같은 확인 단추를 연달아 눌러도 한 번만 저장합니다', async () => {
    const result = await setup('김철수', '1234');
    await loadFile(result, [{ 날짜: '2026-09-06', 성도이름: '김철수', 연락처뒷4자리: '1234', 헌금종류: '십일조', 금액: '1000' }]);
    await waitFor(() => expect(result.current.imp.canSave).toBe(true));

    const confirm = result.current.imp.confirm;
    await act(() => Promise.all([confirm(), confirm()]));

    const rows = await readMonth('2026-09');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-09-06', amount: 1000 });
    expect(result.current.imp.result).toContain('1건 저장');
  });

  it('날짜가 섞인 파일은 저장하지 않습니다', async () => {
    const result = await setup('박명수', '5678');
    await loadFile(result, [
      { 날짜: '2026-08-02', 성도이름: '박명수', 연락처뒷4자리: '5678', 헌금종류: '십일조', 금액: '1000' },
      { 날짜: '2026-12-06', 성도이름: '박명수', 연락처뒷4자리: '5678', 헌금종류: '십일조', 금액: '2000' },
    ]);

    expect(result.current.imp.dateError).toContain('한 날짜');
    expect(result.current.imp.canSave).toBe(false);
    await act(() => result.current.imp.confirm());

    expect(await readMonth('2026-08')).toHaveLength(0);
    expect(await readMonth('2026-12')).toHaveLength(0);
    expect(result.current.imp.result).toBeNull();
  });
});
