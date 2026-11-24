// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, setCurrentUser } from '../../services/auth/currentUser';
import { prepareData } from '../../services/auth/prepareData';
import type { DesktopApi } from '../../services/desktopBridge';
import { hasDataKey, setDataKey } from '../../services/storage/cipher';
import { AuthGate } from './AuthGate';
import { SessionBar } from './SessionBar';

vi.mock('../../services/auth/prepareData', () => ({ prepareData: vi.fn(), startOver: vi.fn() }));

type Verify = Awaited<ReturnType<DesktopApi['authVerifyPin']>>;
function setDesktop(o: { hasPin?: boolean; verify?: Verify; relogin?: string } = {}) {
  const api = {
    authStatus: vi.fn(async () => ({ configured: true, email: 'a@b.c', role: 'finance' as const, hasPin: o.hasPin ?? true })),
    authLogin: vi.fn(async () => ({ email: o.relogin ?? 'a@b.c', role: 'finance' as const })),
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
    setDesktop({ hasPin: false });
    await lockIt();
    expect(screen.queryByLabelText('PIN 6자리')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '구글로 다시 로그인' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '잠금' })).toBeNull());
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
