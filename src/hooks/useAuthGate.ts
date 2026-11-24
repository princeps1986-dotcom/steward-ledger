import { useCallback, useEffect, useState } from 'react';
import { desktop } from '../services/desktopBridge';

/** checking = 로그인 상태 확인 중 · signedOut = 로그인 필요 · pending = 브라우저에서 로그인하는 중 · ready = 앱을 열어도 됨 */
export type AuthPhase = 'checking' | 'signedOut' | 'pending' | 'ready';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** PC앱의 구글 로그인 상태. 브라우저(시연) 모드에서는 로그인 없이 바로 ready. 로그인 방식은 electron/auth.cjs. */
export function useAuthGate() {
  const api = desktop();
  const [phase, setPhase] = useState<AuthPhase>(api ? 'checking' : 'ready');
  const [configured, setConfigured] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.authStatus().then(
      (s) => {
        if (!live) return;
        setConfigured(s.configured);
        setEmail(s.email);
        setPhase(s.email ? 'ready' : 'signedOut'); // 화면만 다시 불러온 경우 main에 로그인이 남아 있으면 그대로 이어서 씁니다.
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
  }, [api]);

  const login = useCallback(async () => {
    if (!api) return;
    setError(null);
    setPhase('pending');
    try {
      const r = await api.authLogin();
      if ('error' in r) {
        setError(r.error);
        setPhase('signedOut');
      } else {
        setEmail(r.email);
        setPhase('ready');
      }
    } catch (e) {
      setError(messageOf(e));
      setPhase('signedOut');
    }
  }, [api]);

  const cancel = useCallback(() => void api?.authCancel(), [api]);

  return { phase, configured, email, error, login, cancel };
}
