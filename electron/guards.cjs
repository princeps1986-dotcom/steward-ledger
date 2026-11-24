// main 프로세스가 실제로 막는 로그인·역할 검사. Electron 없이 시험할 수 있도록 main.cjs에서 떼어 냈습니다(src/services/guards.test.ts).
// 헌금 저장·복원·초기화는 화면(렌더러)의 저장소 작업이라 main이 막을 수 없고 화면 규칙으로 막습니다(src/services/auth/access.ts).

/**
 * auth: electron/auth.cjs의 createAuth 결과(session·logout) · users: userStore(current) · notAllowed: 역할이 모자랄 때의 문구
 * - freshSession: 로그인할 때 복사해 둔 역할이 낡았을 수 있으므로(그 사이 관리자가 역할을 바꾸거나 계정을 중지) 호출마다 계정 목록에서 다시 읽습니다.
 *   목록에서 빠졌거나 사용 중지된 계정이면 바로 로그아웃시키고 null을 돌려줍니다.
 */
function createGuards({ auth, users, notAllowed }) {
  const freshSession = async () => {
    const me = auth.session();
    if (!me) return null;
    const now = await users.current(me.sub).catch(() => null);
    if (!now || now.disabled) {
      auth.logout();
      return null;
    }
    return { ...me, email: now.email, role: now.role };
  };
  /** IPC 처리기를 감쌉니다: 로그인이 없으면 거절하고, 있으면 (me, ...args)로 부르며 오류는 { error }로 바꿉니다. */
  const withSession = (fn) => async (_event, ...args) => {
    const me = await freshSession();
    if (!me) return { error: '로그인이 필요합니다.' };
    try {
      return await fn(me, ...args);
    } catch (err) {
      return { error: String((err && err.message) || err) };
    }
  };
  const roleIs = async (...roles) => roles.includes((await freshSession())?.role);
  const adminOnly = (fn) => withSession(async (me, ...args) => (me.role === 'admin' ? fn(me, ...args) : { error: notAllowed }));
  return { freshSession, withSession, roleIs, adminOnly };
}

/**
 * 화면이 두 번째로 불러와질 때(Ctrl+R·충돌 뒤 다시 불러오기) onReload를 부릅니다.
 * main의 로그인이 그대로 남아 있으면 다시 불러오는 것만으로 잠금 화면을 건너뛸 수 있으므로, 이때 로그인을 지웁니다.
 */
function createReloadGuard(onReload) {
  let loads = 0;
  return () => {
    if (++loads > 1) onReload();
  };
}

module.exports = { createGuards, createReloadGuard };
