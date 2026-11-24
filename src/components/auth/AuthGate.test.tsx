// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, setCurrentUser } from '../../services/auth/currentUser';
import { prepareData, startOver, type PrepareOutcome } from '../../services/auth/prepareData';
import type { Role } from '../../services/auth/roles';
import type { DesktopApi } from '../../services/desktopBridge';
import { AuthGate } from './AuthGate';

vi.mock('../../services/auth/prepareData', () => ({ prepareData: vi.fn(), startOver: vi.fn() }));
const prepare = vi.mocked(prepareData);
const restart = vi.mocked(startOver);

type Login = { email: string; role: Role } | { error: string };
function setDesktop(o: { configured?: boolean; email?: string | null; login?: () => Promise<Login> } = {}) {
  const api = {
    authStatus: vi.fn(async () => ({ configured: o.configured ?? true, email: o.email ?? null, role: o.email ? ('admin' as const) : null, hasPin: false })),
    authLogin: vi.fn(o.login ?? (async () => ({ email: 'a@b.c', role: 'finance' as const }))),
    authCancel: vi.fn(async () => undefined),
    onBackupRequest: vi.fn((_handler: () => Promise<unknown>) => () => undefined),
  };
  window.desktop = api as unknown as DesktopApi;
  return api;
}
const app = <AuthGate>앱 내용</AuthGate>;
const okOutcome: PrepareOutcome = { ok: true };

describe('AuthGate', () => {
  beforeEach(() => {
    prepare.mockReset().mockResolvedValue(okOutcome);
    restart.mockReset().mockResolvedValue(okOutcome);
    setCurrentUser(null);
  });
  afterEach(() => {
    cleanup();
    delete window.desktop;
  });

  it('브라우저(시연) 모드는 로그인 없이 바로 앱을 보여 준다', () => {
    render(app);
    expect(screen.getByText('앱 내용')).toBeTruthy();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('PC앱: 로그인하면 데이터를 준비한 뒤 앱을 보여 주고, 지금 사용자를 기록해 둔다', async () => {
    const api = setDesktop();
    render(app);
    fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }));
    expect(api.authLogin).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('앱 내용')).toBeTruthy();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(currentUser()).toEqual({ email: 'a@b.c', role: 'finance' });
  });

  it('로그인 전에는 앱 내용이 화면에 없다', async () => {
    setDesktop();
    render(app);
    await screen.findByRole('button', { name: '구글로 로그인' });
    expect(screen.queryByText('앱 내용')).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('main에 로그인이 남아 있으면(화면만 다시 불러옴) 바로 데이터를 준비해 이어서 쓴다', async () => {
    setDesktop({ email: 'a@b.c' });
    render(app);
    expect(await screen.findByText('앱 내용')).toBeTruthy();
    expect(currentUser()).toEqual({ email: 'a@b.c', role: 'admin' });
  });

  it('데이터 준비 중에는 앱을 그리지 않고 진행 상황을 보여 준다', async () => {
    setDesktop({ email: 'a@b.c' });
    let done: (r: PrepareOutcome) => void = () => undefined;
    prepare.mockImplementation((_api, onProgress) => {
      onProgress?.(2, 5);
      return new Promise<PrepareOutcome>((r) => (done = r));
    });
    render(app);
    expect((await screen.findByRole('status')).textContent).toContain('(2/5)');
    expect(screen.queryByText('앱 내용')).toBeNull();
    done(okOutcome);
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
    expect(prepare).not.toHaveBeenCalled();
  });

  it('로그인 설정이 없으면 안내하고 [구글로 로그인]을 막는다', async () => {
    setDesktop({ configured: false });
    render(app);
    const btn = (await screen.findByRole('button', { name: '구글로 로그인' })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('클라이언트 ID');
  });

  it('데이터 준비가 실패하면 사유와 [다시 시도]를 보여 주고, 다시 시도해 성공하면 앱을 연다', async () => {
    setDesktop({ email: 'a@b.c' });
    prepare.mockResolvedValueOnce({ ok: false, keyLost: false, error: '암호화하기 전 백업에 실패했습니다: 디스크 가득' });
    render(app);
    expect((await screen.findByRole('alert')).textContent).toContain('디스크 가득');
    expect(screen.queryByText('앱 내용')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('앱 내용')).toBeTruthy();
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('열쇠를 잃었으면 안내하고, 두 번 확인한 뒤에만 모두 지우고 새로 시작한다', async () => {
    setDesktop({ email: 'a@b.c' });
    prepare.mockResolvedValueOnce({ ok: false, keyLost: true, error: '데이터 열쇠를 풀 수 없습니다' });
    render(app);
    expect((await screen.findByRole('alert')).textContent).toContain('데이터 열쇠를 풀 수 없습니다');
    expect(restart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '새로 시작…' }));
    expect(restart).not.toHaveBeenCalled(); // 첫 클릭은 확인 문구만
    expect(screen.getByText(/되돌릴 수 없습니다/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '돌아가기' }));
    expect(screen.queryByText(/되돌릴 수 없습니다/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '새로 시작…' }));
    fireEvent.click(screen.getByRole('button', { name: '모두 지우고 새로 시작' }));
    expect(await screen.findByText('앱 내용')).toBeTruthy();
    expect(restart).toHaveBeenCalledTimes(1);
    expect(restart.mock.calls[0][1]).toBe('admin'); // 관리자 역할로 호출
  });

  it('열쇠를 잃었어도 관리자가 아니면 [새로 시작]을 보여 주지 않고 관리자에게 문의하라고 안내한다', async () => {
    const api = setDesktop({ email: 'a@b.c' });
    api.authStatus.mockResolvedValue({ configured: true, email: 'a@b.c', role: 'finance' as never, hasPin: false });
    prepare.mockResolvedValueOnce({ ok: false, keyLost: true, error: '데이터 열쇠를 풀 수 없습니다' });
    render(app);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /새로 시작/ })).toBeNull();
    expect(screen.getByText(/관리자만 할 수 있습니다/)).toBeTruthy();
  });

  it('앱이 열리기 전에 창을 닫으면 백업할 것이 없다고 답하고, 앱이 열리면 이 처리기를 뺀다', async () => {
    const api = setDesktop();
    const off = vi.fn();
    api.onBackupRequest.mockReturnValue(off);
    render(app);
    await screen.findByRole('button', { name: '구글로 로그인' });
    const handler = api.onBackupRequest.mock.calls[0][0];
    expect(await handler()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '구글로 로그인' }));
    await screen.findByText('앱 내용');
    expect(off).toHaveBeenCalled();
  });
});
