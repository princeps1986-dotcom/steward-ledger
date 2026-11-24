import { useCallback, useEffect, useRef, useState } from 'react';
import { setCurrentUser, type CurrentUser } from '../services/auth/currentUser';
import { prepareData, startOver, type PrepareOutcome } from '../services/auth/prepareData';
import { desktop } from '../services/desktopBridge';

/**
 * checking = 로그인 상태 확인 중 · signedOut = 로그인 필요 · pending = 브라우저에서 로그인하는 중
 * preparing = 저장 데이터 열쇠를 받고(필요하면 암호화로 옮기는) 준비 중 · failed = 준비 실패(다시 시도) · keyLost = 열쇠를 풀 수 없는데 데이터가 있음
 * ready = 앱을 열어도 됨
 */
export type AuthPhase = 'checking' | 'signedOut' | 'pending' | 'preparing' | 'failed' | 'keyLost' | 'ready';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** PC앱의 구글 로그인 상태. 브라우저(시연) 모드에서는 로그인 없이 바로 ready. 로그인 방식은 electron/auth.cjs, 데이터 준비는 services/auth/prepareData.ts. */
export function useAuthGate() {
  const api = desktop();
  const [phase, setPhase] = useState<AuthPhase>(api ? 'checking' : 'ready');
  const [configured, setConfigured] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const me = useRef<CurrentUser | null>(null);

  // 로그인 화면·준비 중에 창을 닫으면 백업할 데이터가 아직 화면에 없으므로 '백업 생략'으로 답해 종료가 멈추지 않게 합니다.
  // (앱이 열리면 App이 자기 처리기를 등록하므로 ready 때는 빼 둡니다.)
  useEffect(() => {
    if (!api || phase === 'ready') return;
    return api.onBackupRequest(async () => null);
  }, [api, phase]);

  const finish = useCallback((r: PrepareOutcome) => {
    if (r.ok) {
      setCurrentUser(me.current);
      setPhase('ready');
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

  const cancel = useCallback(() => void api?.authCancel(), [api]);
  const retry = useCallback(() => (me.current ? prepare(me.current) : undefined), [prepare]);
  /** 열쇠를 잃은 데이터를 모두 지우고 새로 시작(화면이 확인을 받은 뒤에만 부름) */
  const restart = useCallback(async () => {
    if (!api) return;
    setError(null);
    setProgress(null);
    setPhase('preparing');
    finish(await startOver(api, (done, total) => setProgress({ done, total })));
  }, [api, finish]);

  return { phase, configured, email, error, progress, login, cancel, retry, restart };
}
