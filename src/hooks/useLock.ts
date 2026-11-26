import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CurrentUser } from '../services/auth/currentUser';
import type { DesktopApi } from '../services/desktopBridge';
import type { AuthPhase } from './useAuthGate';
import { useIdleLock } from './useIdleLock';

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Deps {
  api: DesktopApi | undefined;
  phase: AuthPhase;
  setPhase: Dispatch<SetStateAction<AuthPhase>>;
  me: MutableRefObject<CurrentUser | null>;
  signOut(why?: string): Promise<void>;
  prepare(who: CurrentUser): Promise<void>;
  setHasPin: Dispatch<SetStateAction<boolean>>;
}

/** 자동 잠금과 잠금 해제(PIN·구글 재로그인)·PIN 만들기. 로그인·준비·로그아웃은 useAuthGate가 맡습니다. */
export function useLock({ api, phase, setPhase, me, signOut, prepare, setHasPin }: Deps) {
  const lock = useCallback(() => setPhase((p) => (p === 'ready' ? 'locked' : p)), [setPhase]);
  useIdleLock(!!api && phase === 'ready', lock); // 로그인이 없는 브라우저(시연) 모드는 잠그지 않습니다(풀 방법이 없음).

  // 풀기 직전에 main의 최신 계정 상태를 확인합니다: 그 사이 사용 중지됐거나 역할이 바뀌었으면 풀지 않고 다시 로그인하게 합니다.
  const resume = useCallback(async (): Promise<string | null> => {
    const s = await api?.authStatus();
    if (!s?.email) await signOut('사용이 중지되었거나 등록이 취소된 계정입니다. 관리자에게 문의하세요.');
    else if (s.role !== me.current?.role) await signOut('역할이 바뀌었습니다. 다시 로그인하세요.');
    else if (phase === 'reloaded' && me.current) await prepare(me.current); // 다시 불러온 뒤라 앱 데이터가 아직 없음
    else setPhase('ready');
    return null;
  }, [api, signOut, phase, prepare]);

  /** 잠금 해제: PIN. 오류 문구를 돌려줍니다(성공이면 null). 5회 실패하면 로그아웃됩니다. */
  const unlockWithPin = useCallback(
    async (pin: string): Promise<string | null> => {
      if (!api) return null;
      const r = await api.authVerifyPin(pin);
      if ('error' in r) {
        // main이 계정이 중지됐다며 로그아웃시킨 경우에도 여기로 오므로, 로그인이 남아 있는지 보고 아니면 로그인 화면으로 보냅니다.
        if (!(await api.authStatus()).email) await signOut(r.error);
        return r.error;
      }
      if (r.ok) return resume();
      if ('disabled' in r) {
        await signOut('사용이 중지된 계정입니다. 관리자에게 문의하세요.');
        return null;
      }
      if ('locked' in r) {
        await signOut('PIN을 5번 틀려 로그아웃했습니다. 구글로 다시 로그인하세요.');
        return null;
      }
      if ('noPin' in r) {
        setHasPin(false);
        return 'PIN이 없습니다. 구글로 다시 로그인하세요.';
      }
      return `PIN이 맞지 않습니다. (남은 시도 ${r.left}회)`;
    },
    [api, signOut, resume],
  );
  /** 잠금 해제: 구글 재로그인(PIN이 없을 때). 처음 로그인한 계정이 아니면 로그아웃합니다. */
  const unlockWithGoogle = useCallback(async (): Promise<string | null> => {
    if (!api) return null;
    const r = await api.authLogin({ reauth: true }).catch((e: unknown) => ({ error: messageOf(e) }));
    if ('error' in r) return r.error;
    if (r.email !== me.current?.email) {
      await signOut('잠기기 전과 다른 계정입니다. 다시 로그인하세요.');
      return null;
    }
    // 방금 로그인했으니 사용 중지는 아니고, 역할이 바뀌었으면 다시 로그인시키지 않고 새 역할로 앱을 다시 엽니다.
    if (r.role !== me.current?.role || phase === 'reloaded') await prepare({ email: r.email, role: r.role });
    else setPhase('ready');
    return null;
  }, [api, signOut, prepare, phase]);
  const setPin = useCallback(
    async (pin: string): Promise<string | null> => {
      const r = await api?.authSetPin(pin);
      if (r && 'error' in r) return r.error;
      setHasPin(true);
      return null;
    },
    [api],
  );

  return { lock, unlockWithPin, unlockWithGoogle, setPin };
}
