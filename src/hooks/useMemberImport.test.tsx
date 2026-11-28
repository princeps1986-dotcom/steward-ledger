// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { useMemberActions, useMembers } from '../contexts/MemberContext';
import { EMPTY_MEMBER_DRAFT } from '../services/domain/memberRules';
import { readImportFile } from '../services/import/memberImportService';
import { useMemberImport } from './useMemberImport';

vi.mock('../services/import/memberImportService', async (orig) => ({
  ...(await orig<typeof import('../services/import/memberImportService')>()),
  readImportFile: vi.fn(),
}));

const fileEvent = { target: { files: [new File([''], 'members.csv')], value: 'x' } } as unknown as ChangeEvent<HTMLInputElement>;

const noop = () => {};

/** 연락처가 있는 성도 한 명을 넣고 불러오기 화면을 엽니다. 테스트끼리 DB를 공유하므로 이름을 나눠 씁니다. */
async function setup(name: string) {
  const { result } = renderHook(() => ({ imp: useMemberImport(noop), actions: useMemberActions(), members: useMembers() }), { wrapper: AppProviders });
  await waitFor(() => expect(result.current.imp.busy).toBe(false));
  await act(() => result.current.actions.saveMember({ ...EMPTY_MEMBER_DRAFT, name, phoneLast4: '1111' }));
  await waitFor(() => expect(result.current.members.some((m) => m.name === name)).toBe(true));
  return result;
}

describe('useMemberImport 미리보기 행 수정·제외', () => {
  it('중복 행에 연락처를 넣으면 새 성도로 판정되고, 제외한 행은 저장하지 않는다', async () => {
    const result = await setup('동명수정');
    await act(() => result.current.imp.onPaste('이름\n동명수정\n빼는사람'));
    await waitFor(() => expect(result.current.imp.preview.map((r) => r.status)).toEqual(['DUPLICATE', 'OK']));

    act(() => result.current.imp.updateRow(2, { name: '동명수정', position: '', phoneLast4: '22-22' }));
    expect(result.current.imp.preview[0]).toMatchObject({ status: 'OK', phoneLast4: '2222' });

    act(() => result.current.imp.removeRow(3));
    expect(result.current.imp.preview).toHaveLength(1);

    await act(() => result.current.imp.confirm());
    expect(result.current.imp.stats).toMatchObject({ created: 1 });
    expect(result.current.imp.removed).toBe(1);
    await waitFor(() => expect(result.current.members.filter((m) => m.name === '동명수정')).toHaveLength(2));
    expect(result.current.members.some((m) => m.name === '빼는사람')).toBe(false);
  });

  it('행을 고치면 덮어쓰기 체크가 풀려, 고른 적 없는 성도를 덮어쓰지 않는다', async () => {
    const result = await setup('덮어쓰기해제');
    await act(() => result.current.imp.onPaste('이름\n덮어쓰기해제'));
    await waitFor(() => expect(result.current.imp.preview[0]?.status).toBe('DUPLICATE'));
    act(() => result.current.imp.updateRow(2, { name: '덮어쓰기해제', position: '집사', phoneLast4: '' }));
    act(() => result.current.imp.toggleOverwrite(2));
    expect(result.current.imp.preview[0].overwrite).toBe(true);

    act(() => result.current.imp.updateRow(2, { name: '덮어쓰기해제', position: '권사', phoneLast4: '' }));
    expect(result.current.imp.preview[0]).toMatchObject({ status: 'DUPLICATE', overwrite: false });
    await act(() => result.current.imp.confirm());
    expect(result.current.imp.stats).toMatchObject({ overwritten: 0, skipped: 1 });
  });

  it('비활성 성도와 이름이 같으면 비활성이라고 알려 준다', async () => {
    const result = await setup('비활성중복');
    const id = result.current.members.find((m) => m.name === '비활성중복')!.id;
    await act(async () => {
      await result.current.actions.setActive(id, false);
    });
    await act(() => result.current.imp.onPaste('성도\n비활성중복'));
    await waitFor(() => expect(result.current.imp.preview[0]?.status).toBe('DUPLICATE'));
    expect(result.current.imp.preview[0].messages.join(' ')).toContain('비활성 성도와 같습니다');
  });

  it('기존 성도에 연락처가 없으면 행에 연락처를 넣어도 중복이며, 성도 화면에서 고치라고 안내한다', async () => {
    const { result } = renderHook(() => ({ imp: useMemberImport(noop), actions: useMemberActions(), members: useMembers() }), { wrapper: AppProviders });
    await waitFor(() => expect(result.current.imp.busy).toBe(false));
    await act(() => result.current.actions.saveMember({ ...EMPTY_MEMBER_DRAFT, name: '연락처없음' }));
    await act(() => result.current.imp.onPaste('이름\n연락처없음'));
    await waitFor(() => expect(result.current.imp.preview[0]?.status).toBe('DUPLICATE'));
    act(() => result.current.imp.updateRow(2, { name: '연락처없음', position: '', phoneLast4: '3333' }));
    expect(result.current.imp.preview[0].status).toBe('DUPLICATE');
    expect(result.current.imp.preview[0].messages.join(' ')).toContain('성도 화면에서 기존 성도의 연락처를 먼저');
  });

  it('파일 읽기가 끝나기 전에 붙여넣으면, 늦게 끝난 파일 결과는 버린다', async () => {
    const result = await setup('늦은명단');
    let finish!: (rows: Record<string, string>[]) => void;
    vi.mocked(readImportFile).mockReturnValue(new Promise((r) => (finish = r)));
    let fileDone!: Promise<void>;
    act(() => {
      fileDone = result.current.imp.onFile(fileEvent);
    });
    await act(() => result.current.imp.onPaste('이름\n붙인사람'));
    await act(async () => {
      finish([{ 이름: '파일사람1' }, { 이름: '파일사람2' }]);
      await fileDone;
    });
    expect(result.current.imp.preview.map((r) => r.name)).toEqual(['붙인사람']);
    expect(result.current.imp.fileName).toBe('붙여넣은 표');
  });
});
