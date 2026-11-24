// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, setCurrentUser } from '../../services/auth/currentUser';
import { prepareData } from '../../services/auth/prepareData';
import type { DesktopApi } from '../../services/desktopBridge';
import { setClosingNotice } from '../../services/auth/closing';
import { hasDataKey, setDataKey } from '../../services/storage/cipher';
import { Modal } from '../shared/Modal';
import { AuthGate } from './AuthGate';
import { SessionBar } from './SessionBar';

vi.mock('../../services/auth/prepareData', () => ({ prepareData: vi.fn(), startOver: vi.fn() }));

type Verify = Awaited<ReturnType<DesktopApi['authVerifyPin']>>;
function setDesktop(o: { hasPin?: boolean; verify?: Verify; relogin?: string } = {}) {
  const status = { email: 'a@b.c' as string | null, role: 'finance' as 'finance' | 'viewer' };
  const api = {
    status,
    skipBackup: vi.fn(async () => undefined),
    authStatus: vi.fn(async () => ({ configured: true, email: status.email, role: status.email ? status.role : null, hasPin: o.hasPin ?? true })),
    authLogin: vi.fn(async () => ({ email: o.relogin ?? 'a@b.c', role: status.role })),
    authVerifyPin: vi.fn(async () => o.verify ?? ({ ok: true } as Verify)),
    authSetPin: vi.fn(async () => ({ ok: true as const })),
    authLogout: vi.fn(async () => undefined),
    authCancel: vi.fn(async () => undefined),
    onBackupRequest: vi.fn(() => () => undefined),
  };
  window.desktop = api as unknown as DesktopApi;
  return api;
}
const gate = (
  <AuthGate>
    <SessionBar />
    <p>앱 내용</p>
  </AuthGate>
);
const lockIt = async () => {
  render(gate);
  await screen.findByText('앱 내용');
  fireEvent.click(await screen.findByRole('button', { name: '지금 잠그기' }));
  await screen.findByRole('dialog', { name: '잠금' });
};
const typePin = (v: string) => fireEvent.change(screen.getByLabelText('PIN 6자리'), { target: { value: v } });

beforeEach(() => {
  vi.mocked(prepareData).mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  delete window.desktop;
  setCurrentUser(null);
  setClosingNotice(false);
  vi.useRealTimers();
});

describe('자동 잠금', () => {
  it('잠그면 잠금 화면이 앱을 덮고, 앱은 지워지지 않아 내용이 남는다', async () => {
    setDesktop();
    await lockIt();
    expect(screen.getByText('앱 내용')).toBeTruthy(); // 가려졌을 뿐 그대로 있음
    expect(document.querySelector('[inert]')).not.toBeNull();
  });

  it('PIN이 맞으면 풀린다', async () => {
    const api = setDesktop();
    await lockIt();
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: '잠금 풀기' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '잠금' })).toBeNull());
    expect(api.authVerifyPin).toHaveBeenCalledWith('123456');
  });

  it('PIN이 틀리면 남은 횟수를 알리고 잠긴 채로 둔다', async () => {
    setDesktop({ verify: { ok: false, left: 3 } });
    await lockIt();
    typePin('000000');
    fireEvent.click(screen.getByRole('button', { name: '잠금 풀기' }));
    expect(await screen.findByText(/남은 시도 3회/)).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '잠금' })).toBeTruthy();
  });

  it('PIN을 5번 틀리면 로그아웃해 열쇠·사용자를 버리고 로그인 화면으로 돌아간다', async () => {
    const api = setDesktop({ verify: { ok: false, locked: true } });
    await setDataKey(new Uint8Array(32));
    await lockIt();
    typePin('000000');
    fireEvent.click(screen.getByRole('button', { name: '잠금 풀기' }));
    expect(await screen.findByRole('button', { name: '구글로 로그인' })).toBeTruthy();
    expect(api.authLogout).toHaveBeenCalled();
    expect(currentUser()).toBeNull();
    expect(hasDataKey()).toBe(false);
    expect(screen.queryByText('앱 내용')).toBeNull();
  });

  it('PIN이 없으면 구글 재로그인으로 풀고, 같은 계정이어야 한다', async () => {
    const api = setDesktop({ hasPin: false });
    await lockIt();
    expect(screen.queryByLabelText('PIN 6자리')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '구글로 다시 로그인' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '잠금' })).toBeNull());
    expect(api.authLogin).toHaveBeenCalledWith({ reauth: true }); // 이미 로그인된 브라우저에서 계정만 눌러 통과하지 못하게 비밀번호를 다시 묻는 로그인
  });

  it('다른 계정으로 다시 로그인하면 풀리지 않고 로그아웃된다', async () => {
    const api = setDesktop({ hasPin: false, relogin: 'other@b.c' });
    await lockIt();
    fireEvent.click(screen.getByRole('button', { name: '구글로 다시 로그인' }));
    expect(await screen.findByText(/다른 계정/)).toBeTruthy();
    expect(api.authLogout).toHaveBeenCalled();
    expect(currentUser()).toBeNull();
  });
});

describe('로그아웃·PIN 만들기', () => {
  it('로그아웃하면 앱이 사라지고 로그인 화면이 나온다', async () => {
    const api = setDesktop();
    render(gate);
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('button', { name: '구글로 로그인' })).toBeTruthy();
    expect(api.authLogout).toHaveBeenCalled();
    expect(screen.queryByText('앱 내용')).toBeNull();
  });

  it('PIN은 두 번 같게 입력해야 저장된다', async () => {
    const api = setDesktop({ hasPin: false });
    render(gate);
    fireEvent.click(await screen.findByRole('button', { name: 'PIN 만들기' }));
    fireEvent.change(screen.getByLabelText('새 PIN'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('새 PIN 확인'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/다릅니다/)).toBeTruthy();
    expect(api.authSetPin).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('새 PIN 확인'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(api.authSetPin).toHaveBeenCalledWith('123456'));
  });
});

describe('잠금 보완', () => {
  it('브라우저(시연) 모드는 오래 두어도 잠기지 않는다', async () => {
    vi.useFakeTimers();
    render(<AuthGate>앱 내용</AuthGate>);
    await act(() => vi.advanceTimersByTimeAsync(16 * 60 * 1000));
    expect(screen.queryByRole('dialog', { name: '잠금' })).toBeNull();
    expect(screen.getByText('앱 내용')).toBeTruthy();
  });

  it('15분 동안 조작이 없으면 PC앱은 잠긴다', async () => {
    setDesktop();
    vi.useFakeTimers(); // 타이머는 앱이 열릴 때 걸리므로 그전에 가짜로 바꿉니다.
    render(gate);
    await act(() => vi.advanceTimersByTimeAsync(50)); // 가짜 타이머에서는 findBy가 멈추므로 직접 흘려보냅니다.
    expect(screen.getByText('앱 내용')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 100));
    expect(screen.getByRole('dialog', { name: '잠금' })).toBeTruthy();
  });

  it('PIN이 맞아도 그 사이 사용 중지됐으면 풀리지 않고 로그아웃된다', async () => {
    const api = setDesktop();
    await lockIt();
    api.status.email = null; // main이 사용 중지를 확인해 로그인을 지운 상태
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: '잠금 풀기' }));
    expect(await screen.findByRole('button', { name: '구글로 로그인' })).toBeTruthy();
    expect(screen.getByText(/사용이 중지/)).toBeTruthy();
    expect(currentUser()).toBeNull();
  });

  it('main이 오류로 답하고 로그인이 지워졌어도(사용 중지) 로그인 화면으로 돌아간다', async () => {
    const api = setDesktop({ verify: { error: '로그인이 필요합니다.' } });
    await lockIt();
    api.status.email = null;
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: '잠금 풀기' }));
    expect(await screen.findByRole('button', { name: '구글로 로그인' })).toBeTruthy();
  });

  it('PIN이 맞아도 그 사이 역할이 바뀌었으면 다시 로그인하게 한다', async () => {
    const api = setDesktop();
    await lockIt();
    api.status.role = 'viewer';
    typePin('123456');
    fireEvent.click(screen.getByRole('button', { name: '잠금 풀기' }));
    expect(await screen.findByText(/역할이 바뀌었습니다/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '구글로 로그인' })).toBeTruthy();
  });

  it('구글로 풀 때 역할이 바뀌었으면 다시 로그인시키지 않고 새 역할로 연다', async () => {
    const api = setDesktop({ hasPin: false });
    await lockIt();
    api.status.role = 'viewer';
    fireEvent.click(screen.getByRole('button', { name: '구글로 다시 로그인' }));
    await waitFor(() => expect(currentUser()?.role).toBe('viewer'));
    expect(screen.queryByRole('dialog', { name: '잠금' })).toBeNull();
    expect(api.authLogout).not.toHaveBeenCalled();
    expect(api.authLogin).toHaveBeenCalledTimes(1);
  });

  it('PIN 칸에는 숫자만 들어간다', async () => {
    setDesktop();
    await lockIt();
    typePin('12a3b4');
    expect((screen.getByLabelText('PIN 6자리') as HTMLInputElement).value).toBe('1234');
  });

  it('잠긴 채 창을 닫으면 잠금 화면에서 [백업 없이 종료]를 누를 수 있다', async () => {
    const api = setDesktop();
    await lockIt();
    act(() => setClosingNotice(true));
    fireEvent.click(await screen.findByRole('button', { name: '백업 없이 종료' }));
    expect(api.skipBackup).toHaveBeenCalled();
    expect(screen.queryByLabelText('PIN 6자리')).toBeNull();
  });

  it('열려 있던 대화상자도 잠그면 막히고(포커스를 붙잡지 못함), 풀면 되돌아온다', async () => {
    setDesktop();
    vi.useFakeTimers();
    render(
      <AuthGate>
        <SessionBar />
        <Modal open onClose={() => undefined} title="열린 창">
          <input aria-label="내용" />
        </Modal>
      </AuthGate>,
    );
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(screen.getByText('열린 창')).toBeTruthy();
    const dialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter((d) => !d.hasAttribute('data-lock-screen'));
    expect(dialogs()[0].closest('[inert]')).toBeNull();
    // 열린 대화상자가 있으면 머리글 단추도 Radix가 막으므로 15분 무조작으로 잠급니다.
    await act(() => vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 100));
    expect(dialogs()[0].closest('[inert]')).not.toBeNull();
    expect(document.querySelector('[data-lock-screen]')!.closest('[inert]')).toBeNull();
  });
});
