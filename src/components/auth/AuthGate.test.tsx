// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopApi } from '../../services/desktopBridge';
import { AuthGate } from './AuthGate';

type Login = { email: string } | { error: string };
function setDesktop(o: { configured?: boolean; email?: string | null; login?: () => Promise<Login> } = {}) {
  const api = {
    authStatus: vi.fn(async () => ({ configured: o.configured ?? true, email: o.email ?? null })),
    authLogin: vi.fn(o.login ?? (async () => ({ email: 'a@b.c' }))),
    authCancel: vi.fn(async () => undefined),
  };
  window.desktop = api as unknown as DesktopApi;
  return api;
}
const app = <AuthGate>앱 내용</AuthGate>;

describe('AuthGate', () => {
  afterEach(() => {
    cleanup();
    delete window.desktop;
  });

  it('브라우저(시연) 모드는 로그인 없이 바로 앱을 보여 준다', () => {
    render(app);
    expect(screen.getByText('앱 내용')).toBeTruthy();
  });

  it('PC앱: 로그인 전에는 앱을 그리지 않고, 로그인하면 앱을 보여 준다', async () => {
    const api = setDesktop();
    render(app);
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }));
    expect(api.authLogin).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('앱 내용')).toBeTruthy();
  });

  it('로그인 전에는 앱 내용이 화면에 없다', async () => {
    setDesktop();
    render(app);
    await screen.findByRole('button', { name: '구글로 로그인' });
    expect(screen.queryByText('앱 내용')).toBeNull();
  });

  it('main에 로그인이 남아 있으면(화면만 다시 불러옴) 바로 이어서 쓴다', async () => {
    setDesktop({ email: 'a@b.c' });
    render(app);
    expect(await screen.findByText('앱 내용')).toBeTruthy();
  });

  it('로그인 중에는 [취소]가 나오고 누르면 main에 알린다', async () => {
    let finish: (r: Login) => void = () => undefined;
    const api = setDesktop({ login: () => new Promise<Login>((r) => (finish = r)) });
    render(app);
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }));
    fireEvent.click(await screen.findByRole('button', { name: '취소' }));
    expect(api.authCancel).toHaveBeenCalledTimes(1);
    finish({ error: '로그인을 취소했습니다.' });
    expect((await screen.findByRole('alert')).textContent).toContain('로그인을 취소했습니다.');
    expect(screen.getByRole('button', { name: '구글로 로그인' })).toBeTruthy(); // 다시 시도 가능
  });

  it('로그인이 실패하면 사유를 보여 주고 앱은 열리지 않는다', async () => {
    setDesktop({ login: async () => ({ error: '인터넷에 연결할 수 없습니다.' }) });
    render(app);
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('인터넷에 연결할 수 없습니다.'));
    expect(screen.queryByText('앱 내용')).toBeNull();
  });

  it('로그인 설정이 없으면 안내하고 [구글로 로그인]을 막는다', async () => {
    setDesktop({ configured: false });
    render(app);
    const btn = (await screen.findByRole('button', { name: '구글로 로그인' })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('클라이언트 ID');
  });
});
