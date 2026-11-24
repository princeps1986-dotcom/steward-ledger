// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Me = { sub: string; email: string; role: string };
type Now = { email: string; role: string; disabled: boolean } | null;
const req = createRequire(import.meta.url);
const { createGuards, createReloadGuard } = req('../../electron/guards.cjs') as {
  createGuards(o: { auth: { session(): Me | null; logout(): void }; users: { current(sub: string): Promise<Now> }; notAllowed: string }): {
    freshSession(): Promise<Me | null>;
    withSession<T>(fn: (me: Me, ...a: unknown[]) => Promise<T>): (e: unknown, ...a: unknown[]) => Promise<T | { error: string }>;
    roleIs(...roles: string[]): Promise<boolean>;
    adminOnly<T>(fn: (me: Me, ...a: unknown[]) => Promise<T>): (e: unknown, ...a: unknown[]) => Promise<T | { error: string }>;
  };
  createReloadGuard(onReload: () => void): () => void;
};

const NOT_ALLOWED = '이 작업을 할 권한이 없습니다.';
function setup(session: Me | null, now: () => Now) {
  const state = { session };
  const auth = { session: () => state.session, logout: vi.fn(() => void (state.session = null)) };
  const users = { current: vi.fn(async () => now()) };
  return { state, auth, users, g: createGuards({ auth, users, notAllowed: NOT_ALLOWED }) };
}
const fin: Me = { sub: 's1', email: 'a@b.c', role: 'finance' }; // 로그인할 때 복사해 둔 값
const ok = async (me: Me) => me.role;

describe('로그인·역할 검사(electron/guards.cjs)', () => {
  it('로그인이 없으면 모두 거절한다', async () => {
    const { g } = setup(null, () => null);
    expect(await g.freshSession()).toBeNull();
    expect(await g.withSession(ok)(null)).toEqual({ error: '로그인이 필요합니다.' });
    expect(await g.adminOnly(ok)(null)).toEqual({ error: '로그인이 필요합니다.' });
    expect(await g.roleIs('admin', 'finance')).toBe(false);
  });

  it('계정 목록의 현재 역할을 쓴다(로그인 때 복사해 둔 낡은 역할이 아님)', async () => {
    const { g } = setup({ ...fin, role: 'admin' }, () => ({ email: 'a@b.c', role: 'viewer', disabled: false }));
    expect(await g.withSession(ok)(null)).toBe('viewer');
    expect(await g.adminOnly(ok)(null)).toEqual({ error: NOT_ALLOWED }); // 강등된 관리자는 관리자 전용 호출이 거절됨
    expect(await g.roleIs('admin', 'finance')).toBe(false);
  });

  it('재정담당은 계정 관리(관리자 전용)는 거절되고, 직접 백업·업데이트(관리자·재정담당)는 허용된다', async () => {
    const { g } = setup(fin, () => ({ email: 'a@b.c', role: 'finance', disabled: false }));
    expect(await g.adminOnly(ok)(null)).toEqual({ error: NOT_ALLOWED });
    expect(await g.roleIs('admin', 'finance')).toBe(true);
  });

  it('관리자는 관리자 전용 호출을 통과하고 인자가 그대로 넘어간다', async () => {
    const { g } = setup({ ...fin, role: 'admin' }, () => ({ email: 'a@b.c', role: 'admin', disabled: false }));
    expect(await g.adminOnly(async (_me, x) => x)(null, 'arg')).toBe('arg');
  });

  it('사용 중지됐거나 목록에서 빠진 계정은 그 자리에서 로그아웃시킨다', async () => {
    for (const now of [{ email: 'a@b.c', role: 'admin', disabled: true }, null] as Now[]) {
      const { g, auth } = setup({ ...fin, role: 'admin' }, () => now);
      expect(await g.adminOnly(ok)(null)).toEqual({ error: '로그인이 필요합니다.' });
      expect(auth.logout).toHaveBeenCalled();
    }
  });

  it('처리기가 던진 오류는 { error }로 바뀐다', async () => {
    const { g } = setup(fin, () => ({ email: 'a@b.c', role: 'finance', disabled: false }));
    expect(await g.withSession(async () => Promise.reject(new Error('깨짐')))(null)).toEqual({ error: '깨짐' });
  });
});

describe('화면 다시 불러오기 가드', () => {
  it('처음 불러올 때는 가만히 있고, 두 번째부터 로그인을 지운다(Ctrl+R로 잠금을 건너뛰지 못하게)', () => {
    const logout = vi.fn();
    const onLoad = createReloadGuard(logout);
    onLoad();
    expect(logout).not.toHaveBeenCalled();
    onLoad();
    expect(logout).toHaveBeenCalledTimes(1);
    onLoad();
    expect(logout).toHaveBeenCalledTimes(2);
  });
});
