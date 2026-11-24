import { useCallback, useEffect, useState } from 'react';
import { currentUser } from '../services/auth/currentUser';
import type { Role } from '../services/auth/roles';
import { desktop, type AccountLogEntry, type UserEntry } from '../services/desktopBridge';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 관리자 탭: 계정·역할 관리와 로그인·변경 기록. 실제 규칙(관리자 1~2명, 최대 10명 등)은 main의 userStore가 지키고, 여기서는 오류 문구만 보여 줍니다. */
export function useAdminPage() {
  const api = desktop();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [log, setLog] = useState<AccountLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const [u, l] = await Promise.all([api.usersList(), api.usersLog()]);
      if ('error' in u) return setError(u.error);
      if ('error' in l) return setError(l.error);
      setUsers(u.users);
      setLog([...l.log].reverse()); // 최근 것이 위로
    } catch (e) {
      setError(messageOf(e));
    }
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);

  /** 한 가지 변경을 하고 목록을 새로 읽습니다. 성공하면 true */
  const change = useCallback(
    async (fn: () => Promise<{ ok: true } | { error: string }> | undefined): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        if (r && 'error' in r) setError(r.error);
        await reload();
        return !r || !('error' in r);
      } catch (e) {
        setError(messageOf(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return {
    users,
    log,
    error,
    busy,
    me: currentUser()?.email ?? null,
    add: (email: string, role: Role) => change(() => api?.usersAdd({ email, role })),
    setRole: (email: string, role: Role) => change(() => api?.usersSetRole(email, role)),
    setDisabled: (email: string, disabled: boolean) => change(() => api?.usersSetDisabled(email, disabled)),
  };
}
