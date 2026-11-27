// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../contexts/AppProviders';
import { useMemberActions, useMembers } from '../contexts/MemberContext';
import { EMPTY_MEMBER_DRAFT } from '../services/domain/memberRules';
import { useMemberImport } from './useMemberImport';

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
});
