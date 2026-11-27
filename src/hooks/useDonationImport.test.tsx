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
  const { result } = renderHook(() => ({ imp: useDonationImport(noop), members: useMemberActions() }), { wrapper: AppProviders });
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

    const { confirm, onPaste, loadId } = result.current.imp;
    // 저장 중에 들어온 붙여넣기는 무시합니다.
    await act(() => Promise.all([confirm(), confirm(), onPaste('성도이름\t헌금종류\t금액\n김철수\t십일조\t5')]));
    expect(result.current.imp.loadId).toBe(loadId);

    const rows = await readMonth('2026-09');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-09-06', amount: 1000 });
    expect(result.current.imp.result).toContain('1건 저장');
  });

  it('오류 줄을 제거하면 남은 줄(확인 포함)만 저장합니다', async () => {
    const result = await setup('하동훈', '3456');
    await loadFile(result, [
      { 날짜: '2026-07-05', 성도이름: '하동훈(3456)', 헌금종류: '십일조', 금액: '1000' },
      { 날짜: '2026-07-05', 성도이름: '없는사람', 헌금종류: '십일조', 금액: '2000' },
      { 날짜: '2026-07-05', 성도이름: '하동훈', 헌금종류: '십일조', 금액: '99000000' },
    ]);
    await waitFor(() => expect(result.current.imp.summary).toMatchObject({ err: 1, warn: 1 }));

    act(() => result.current.imp.removeRow(3));
    await waitFor(() => expect(result.current.imp.preview.map((r) => r.rowNo)).toEqual([2, 4]));
    act(() => result.current.imp.setLargeConfirmed(true));
    await act(() => result.current.imp.confirm());
    expect(result.current.imp.result).toContain('제거한 1건은 저장하지 않았습니다');

    expect((await readMonth('2026-07')).map((d) => d.amount).sort()).toEqual([1000, 99000000]);
  });

  it('날짜 없는 자료는 날짜를 고르기 전까지 목록과 저장을 막습니다', async () => {
    const result = await setup('노홍철', '7777');
    vi.mocked(readImportFile).mockResolvedValue([{ 성도이름: '노홍철', 헌금종류: '십일조', 금액: '1000' }]);
    await act(() => result.current.imp.onFile(fileEvent));
    expect(result.current.imp.needsDate).toBe(true);
    expect(result.current.imp.canSave).toBe(false);

    const firstLoad = result.current.imp.loadId;
    act(() => result.current.imp.setDefaultDate('2026-06-07'));
    expect(result.current.imp.loadId).toBe(firstLoad);
    await waitFor(() => expect(result.current.imp.canSave).toBe(true));

    // 다음 자료를 불러오면 날짜를 다시 골라야 합니다.
    await act(() => result.current.imp.onFile(fileEvent));
    expect(result.current.imp.needsDate).toBe(true);
    expect(result.current.imp.preview).toHaveLength(0);
    expect(result.current.imp.loadId).toBe(firstLoad + 1);
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

  it('같은 성도·종류에 금액이 다른 줄이 있는 파일을 다시 불러와도 또 저장하지 않습니다', async () => {
    const result = await setup('정형돈', '9012');
    const file = [
      { 날짜: '2026-10-04', 성도이름: '정형돈', 연락처뒷4자리: '9012', 헌금종류: '십일조', 금액: '1000' },
      { 날짜: '2026-10-04', 성도이름: '정형돈', 연락처뒷4자리: '9012', 헌금종류: '십일조', 금액: '2000' },
    ];
    await loadFile(result, file);
    await waitFor(() => expect(result.current.imp.canSave).toBe(true));
    await act(() => result.current.imp.confirm());
    expect(await readMonth('2026-10')).toHaveLength(2);

    await loadFile(result, file);
    await waitFor(() => expect(result.current.imp.summary.saved).toBe(2));
    expect(result.current.imp.canSave).toBe(false);
    expect(await readMonth('2026-10')).toHaveLength(2);
  });

  it('파일 읽기가 끝나기 전에 붙여넣으면, 늦게 끝난 파일 결과는 버립니다', async () => {
    const result = await setup('늦은파일', '4321');
    let finish!: (rows: Record<string, string>[]) => void;
    vi.mocked(readImportFile).mockReturnValue(new Promise((r) => (finish = r)));
    let fileDone!: Promise<void>;
    act(() => {
      fileDone = result.current.imp.onFile(fileEvent);
    });
    await act(() => result.current.imp.onPaste('날짜\t성도이름\t헌금종류\t금액\n2026-08-02\t늦은파일\t십일조\t3000'));
    await act(async () => {
      finish([{ 날짜: '2026-08-02', 성도이름: '늦은파일', 헌금종류: '십일조', 금액: '1000' }, { 날짜: '2026-08-02', 성도이름: '늦은파일', 헌금종류: '감사헌금', 금액: '2000' }]);
      await fileDone;
    });
    await waitFor(() => expect(result.current.imp.preview.map((r) => r.amountRaw)).toEqual(['3000']));
    expect(result.current.imp.fileName).toBe('붙여넣은 표');
  });
});
