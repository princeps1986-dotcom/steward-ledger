import { useCallback, useEffect, useRef, useState } from 'react';
import { setCurrentUser, type CurrentUser } from '../services/auth/currentUser';
import { can } from '../services/auth/roles';
import { prepareData, startOver, type PrepareOutcome } from '../services/auth/prepareData';
import { desktop } from '../services/desktopBridge';
import { setDataKey } from '../services/storage/cipher';
import { useIdleLock } from './useIdleLock';

/**
 * checking = 로그인 상태 확인 중 · signedOut = 로그인 필요 · pending = 브라우저에서 로그인하는 중
 * preparing = 저장 데이터 열쇠를 받고(필요하면 암호화로 옮기는) 준비 중 · failed = 준비 실패(다시 시도) · keyLost = 열쇠를 풀 수 없는데 데이터가 있음
 * ready = 앱을 열어도 됨 · locked = 자동 잠금(앱은 그대로 두고 가려서, 입력 중이던 내용이 남음. PIN이나 구글 재로그인으로 풂)
 */
export type AuthPhase = 'checking' | 'signedOut' | 'pending' | 'preparing' | 'failed' | 'keyLost' | 'ready' | 'locked';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** PC앱의 구글 로그인 상태. 브라우저(시연) 모드에서는 로그인 없이 바로 ready. 로그인 방식은 electron/auth.cjs, 데이터 준비는 services/auth/prepareData.ts. */
export function useAuthGate() {
  const api = desktop();
  const [phase, setPhase] = useState<AuthPhase>(api ? 'checking' : 'ready');
  const [configured, setConfigured] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<CurrentUser['role'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const me = useRef<CurrentUser | null>(null);

  // 로그인 화면·준비 중에 창을 닫으면 백업할 데이터가 아직 화면에 없으므로 '백업 생략'으로 답해 종료가 멈추지 않게 합니다.
  // (앱이 열리면 App이 자기 처리기를 등록하므로 ready 때는 빼 둡니다.)
  useEffect(() => {
    if (!api || phase === 'ready' || phase === 'locked') return;
    return api.onBackupRequest(async () => null);
  }, [api, phase]);

  const finish = useCallback((r: PrepareOutcome) => {
    const api = desktop();
    if (r.ok) {
      setCurrentUser(me.current);
      setPhase('ready');
      void api?.authStatus().then((s) => setHasPin(s.hasPin), () => undefined);
    } else {
      setError(r.error);
      setPhase(r.keyLost ? 'keyLost' : 'failed');
    }
  }, []);

  const prepare = useCallback(
    async (who: CurrentUser) => {
      if (!api) return;
      me.current = who;
      setEmail(who.email);
      setRole(who.role);
      setError(null);
      setProgress(null);
      setPhase('preparing');
      finish(await prepareData(api, (done, total) => setProgress({ done, total })));
    },
    [api, finish],
  );

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.authStatus().then(
      (s) => {
        if (!live) return;
        setConfigured(s.configured);
        if (s.email && s.role) void prepare({ email: s.email, role: s.role }); // 화면만 다시 불러온 경우 main에 로그인이 남아 있으면 이어서 씁니다.
        else setPhase('signedOut');
      },
      (e) => {
        if (!live) return;
        setError(messageOf(e));
        setPhase('signedOut');
      },
    );
    return () => {
      live = false;
    };
  }, [api, prepare]);

  const login = useCallback(async () => {
    if (!api) return;
    setError(null);
    setPhase('pending');
    try {
      const r = await api.authLogin();
      if ('error' in r) {
        setError(r.error);
        setPhase('signedOut');
      } else await prepare({ email: r.email, role: r.role });
    } catch (e) {
      setError(messageOf(e));
      setPhase('signedOut');
    }
  }, [api, prepare]);

  // 로그아웃·PIN 5회 실패: main의 로그인과 화면의 열쇠·사용자를 모두 버리고 로그인 화면으로 돌아갑니다(앱 화면은 사라짐).
  const signOut = useCallback(
    async (why?: string) => {
      await api?.authLogout().catch(() => undefined);
      await setDataKey(null);
      setCurrentUser(null);
      me.current = null;
      setEmail(null);
      setRole(null);
      setHasPin(false);
      setError(why ?? null);
      setPhase('signedOut');
    },
    [api],
  );
  const lock = useCallback(() => setPhase((p) => (p === 'ready' ? 'locked' : p)), []);
  useIdleLock(!!api && phase === 'ready', lock); // 로그인이 없는 브라우저(시연) 모드는 잠그지 않습니다(풀 방법이 없음).

  // 풀기 직전에 main의 최신 계정 상태를 확인합니다: 그 사이 사용 중지됐거나 역할이 바뀌었으면 풀지 않고 다시 로그인하게 합니다.
  const resume = useCallback(async (): Promise<string | null> => {
    const s = await api?.authStatus();
    if (!s?.email) await signOut('사용이 중지되었거나 등록이 취소된 계정입니다. 관리자에게 문의하세요.');
    else if (s.role !== me.current?.role) await signOut('역할이 바뀌었습니다. 다시 로그인하세요.');
    else setPhase('ready');
    return null;
  }, [api, signOut]);

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
    const r = await api.authLogin().catch((e: unknown) => ({ error: messageOf(e) }));
    if ('error' in r) return r.error;
    if (r.email !== me.current?.email) {
      await signOut('잠기기 전과 다른 계정입니다. 다시 로그인하세요.');
      return null;
    }
    return resume();
  }, [api, signOut, resume]);
  const setPin = useCallback(
    async (pin: string): Promise<string | null> => {
      const r = await api?.authSetPin(pin);
      if (r && 'error' in r) return r.error;
      setHasPin(true);
      return null;
    },
    [api],
  );

  const cancel = useCallback(() => void api?.authCancel(), [api]);
  const retry = useCallback(() => (me.current ? prepare(me.current) : undefined), [prepare]);
  /** 열쇠를 잃은 데이터를 모두 지우고 새로 시작(화면이 확인을 받은 뒤에만 부름) */
  const restart = useCallback(async () => {
    if (!api || !can(me.current?.role, 'data:reset')) return; // 관리자만(startOver·main도 한 번 더 확인)
    setError(null);
    setProgress(null);
    setPhase('preparing');
    finish(await startOver(api, me.current?.role, (done, total) => setProgress({ done, total })));
  }, [api, finish]);

  return { phase, configured, email, role, hasPin, error, progress, login, cancel, retry, restart, lock, logout: signOut, unlockWithPin, unlockWithGoogle, setPin };
}
