// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser } from '../../../services/auth/currentUser';
import type { DesktopApi, UserEntry } from '../../../services/desktopBridge';
import { AdminPage } from './AdminPage';

// 기간 헌금 삭제 영역은 헌금 저장소가 필요하므로 여기서는 자리만 확인합니다(동작은 yearLock.test.tsx).
vi.mock('../../../contexts/DonationContext', () => ({ useDonationActions: () => ({ deletePeriod: vi.fn() }) }));

const user = (email: string, o: Partial<UserEntry> = {}): UserEntry => ({ email, role: 'finance', addedAt: '2026-11-24T00:00:00Z', disabled: false, registered: true, hasPin: false, ...o });
function setDesktop(add: () => Promise<{ ok: true } | { error: string }> = async () => ({ ok: true }), rebuilt: { at: string | null } = { at: null }) {
  const api = {
    usersList: vi.fn(async () => ({ users: [user('me@b.c', { role: 'admin' }), user('fin@b.c'), user('new@b.c', { registered: false }), user('off@b.c', { disabled: true })] })),
    usersLog: vi.fn(async () => ({
      log: [
        { at: '2026-11-24T01:00:00Z', who: 'me@b.c', text: '오래된 기록' },
        { at: '2026-11-24T02:00:00Z', who: 'me@b.c', text: '최근 기록' },
      ],
      rebuiltAt: rebuilt.at,
    })),
    usersAckRebuilt: vi.fn(async () => ((rebuilt.at = null), { ok: true as const })),
    usersAdd: vi.fn(add),
    usersSetRole: vi.fn(async () => ({ ok: true as const })),
    usersSetDisabled: vi.fn(async () => ({ ok: true as const })),
  };
  window.desktop = api as unknown as DesktopApi;
  setCurrentUser({ email: 'me@b.c', role: 'admin' });
  return api;
}
afterEach(() => {
  cleanup();
  delete window.desktop;
  setCurrentUser(null);
});

describe('관리자 탭', () => {
  it('계정 목록과 상태를 보여 주고, 기록은 최근 것이 위에 온다', async () => {
    setDesktop();
    render(<AdminPage />);
    expect(await screen.findByText('fin@b.c')).toBeTruthy();
    expect(screen.getByText('로그인 전(등록만 됨)')).toBeTruthy();
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(rows.findIndex((t) => t.includes('최근 기록'))).toBeLessThan(rows.findIndex((t) => t.includes('오래된 기록')));
  });

  it('계정 목록이 새로 만들어졌으면 경고를 보이고, [확인했습니다]를 누르면 사라진다', async () => {
    const api = setDesktop(undefined, { at: '2026-11-24T03:00:00Z' });
    render(<AdminPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('계정 목록이 새로 만들어졌습니다');
    fireEvent.click(screen.getByRole('button', { name: '확인했습니다' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(api.usersAckRebuilt).toHaveBeenCalled();
  });

  it('기간 헌금 삭제 영역이 있다(설정 화면에서 옮겨 옴)', async () => {
    setDesktop();
    render(<AdminPage />);
    expect(await screen.findByText('기간 헌금 삭제')).toBeTruthy();
  });

  it('자기 자신에게는 사용 중지 단추가 없다', async () => {
    setDesktop();
    render(<AdminPage />);
    await screen.findByText('fin@b.c');
    expect(screen.getAllByRole('button', { name: '사용 중지' })).toHaveLength(2); // fin, new (off는 다시 사용, me는 없음)
    expect(screen.getByRole('button', { name: '다시 사용' })).toBeTruthy();
  });

  it('역할을 바꾸고 사용을 중지하면 main에 요청한다', async () => {
    const api = setDesktop();
    render(<AdminPage />);
    await screen.findByText('fin@b.c');
    fireEvent.change(screen.getByLabelText('fin@b.c 역할'), { target: { value: 'viewer' } });
    await waitFor(() => expect(api.usersSetRole).toHaveBeenCalledWith('fin@b.c', 'viewer'));
    fireEvent.click(screen.getAllByRole('button', { name: '사용 중지' })[0]);
    await waitFor(() => expect(api.usersSetDisabled).toHaveBeenCalledWith('fin@b.c', true));
  });

  it('내 역할을 낮추려면 확인을 받고, [취소]하면 바꾸지 않는다', async () => {
    const api = setDesktop();
    render(<AdminPage />);
    await screen.findByText('fin@b.c');
    fireEvent.change(screen.getByLabelText('me@b.c 역할'), { target: { value: 'viewer' } });
    expect(await screen.findByRole('dialog', { name: '내 역할을 바꿀까요?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(api.usersSetRole).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('me@b.c 역할'), { target: { value: 'viewer' } });
    fireEvent.click(await screen.findByRole('button', { name: '바꾸기' }));
    await waitFor(() => expect(api.usersSetRole).toHaveBeenCalledWith('me@b.c', 'viewer'));
  });

  it('이메일을 등록하고, main이 거절하면 사유를 보여 준다', async () => {
    const api = setDesktop(async () => ({ error: '관리자는 최대 2명입니다.' }));
    render(<AdminPage />);
    await screen.findByText('fin@b.c');
    fireEvent.change(screen.getByLabelText('등록할 이메일'), { target: { value: 'x@y.co' } });
    fireEvent.change(screen.getByLabelText('역할', { selector: 'select:not([aria-label])' }), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    expect(await screen.findByText('관리자는 최대 2명입니다.')).toBeTruthy();
    expect(api.usersAdd).toHaveBeenCalledWith({ email: 'x@y.co', role: 'admin' });
  });
});
