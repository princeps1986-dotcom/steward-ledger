import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuthGate } from '../../hooks/useAuthGate';
import { SessionContext, type Session } from '../../hooks/useSession';
import { useClosingNotice } from '../../services/auth/closing';
import { can } from '../../services/auth/roles';
import { desktop } from '../../services/desktopBridge';
import { Notice } from '../shared/Notice';

function Card({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-[26rem] max-w-full space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow">
        <h1 className="text-center text-xl font-bold">청지기 장부</h1>
        {children}
      </div>
    </main>
  );
}

/** 자동 잠금 화면: PIN(6자리)으로 풀고, PIN이 없으면 구글 재로그인으로 풉니다. 아래 앱은 지우지 않고 가려만 두어 입력 중이던 내용이 남습니다. */
function LockScreen({ email, hasPin, unlockWithPin, unlockWithGoogle, logout }: { email: string | null; hasPin: boolean; unlockWithPin(pin: string): Promise<string | null>; unlockWithGoogle(): Promise<string | null>; logout(): void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closing = useClosingNotice();
  // 열려 있던 대화상자(Radix)는 body 쪽에 따로 붙어 포커스를 붙잡으므로, 잠금 화면 말고 body의 다른 요소는 모두 inert로 막았다가 풀 때 되돌립니다.
  useEffect(() => {
    const others = [...document.body.children].filter((el) => !el.hasAttribute('data-lock-screen') && !el.hasAttribute('inert'));
    for (const el of others) el.setAttribute('inert', '');
    return () => {
      for (const el of others) el.removeAttribute('inert');
    };
  }, []);
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(await fn());
    setBusy(false);
    setPin('');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => unlockWithPin(pin));
  };
  return createPortal(
    <div data-lock-screen className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center bg-white p-4" role="dialog" aria-modal="true" aria-label="잠금">
      <div className="w-[26rem] max-w-full space-y-4 rounded-lg border border-gray-200 p-6 shadow">
        <h1 className="text-center text-xl font-bold">잠겨 있습니다</h1>
        <p className="text-center text-sm text-gray-600">{email ?? ''} 계정이 한동안 쓰이지 않아 화면을 잠갔습니다. 입력하던 내용은 그대로입니다.</p>
        <Notice message={error ? { kind: 'error', text: error } : null} />
        {closing ? (
          <div className="space-y-2 text-center" role="status">
            <p className="text-sm font-semibold">종료 전에 데이터를 백업하고 있습니다. 끝나면 앱이 자동으로 종료됩니다.</p>
            <button type="button" className="btn" onClick={() => void desktop()?.skipBackup()}>
              백업 없이 종료
            </button>
          </div>
        ) : hasPin ? (
          <form onSubmit={submit} className="flex justify-center gap-2">
            <input type="password" inputMode="numeric" autoFocus maxLength={6} className="input w-32 text-center tracking-widest" aria-label="PIN 6자리" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <button type="submit" className="btn-primary" disabled={busy || pin.length !== 6}>
              잠금 풀기
            </button>
          </form>
        ) : (
          <div className="flex justify-center">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(unlockWithGoogle)}>
              구글로 다시 로그인
            </button>
          </div>
        )}
        <div className="text-center">
          <button type="button" className="text-xs text-gray-500 underline" onClick={logout}>
            로그아웃
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** PC앱은 구글 로그인을 마치고 저장 데이터 준비(열쇠·암호화 이전)가 끝나야 앱을 그립니다. 브라우저(시연) 모드는 그대로 통과합니다. */
export function AuthGate({ children }: { children: ReactNode }) {
  const g = useAuthGate();
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const session = useMemo<Session | null>(() => (g.email && g.role ? { email: g.email, role: g.role, hasPin: g.hasPin, lock: g.lock, logout: () => void g.logout(), setPin: g.setPin } : null), [g.email, g.role, g.hasPin, g.lock, g.logout, g.setPin]);
  if (g.phase === 'ready' && !g.email) return <>{children}</>; // 로그인이 없는 브라우저(시연) 모드: 래퍼 없이 예전 그대로
  if (g.phase === 'ready' || g.phase === 'locked') {
    const locked = g.phase === 'locked';
    return (
      <SessionContext.Provider value={session}>
        <div className="contents" inert={locked}>
          {children}
        </div>
        {locked ? <LockScreen email={g.email} hasPin={g.hasPin} unlockWithPin={g.unlockWithPin} unlockWithGoogle={g.unlockWithGoogle} logout={() => void g.logout()} /> : null}
      </SessionContext.Provider>
    );
  }
  // 화면을 다시 불러와 잠김: 앱은 아직 열지 않고 잠금 화면만(풀면 데이터를 준비해 엶)
  if (g.phase === 'reloaded') return <LockScreen email={g.email} hasPin={g.hasPin} unlockWithPin={g.unlockWithPin} unlockWithGoogle={g.unlockWithGoogle} logout={() => void g.logout()} />;
  if (g.phase === 'checking') return null; // 몇 십 밀리초 안에 끝나므로 깜빡임을 피해 비워 둡니다.

  if (g.phase === 'preparing') {
    return (
      <Card>
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" aria-hidden="true" />
        <p role="status" className="text-center text-sm leading-relaxed text-gray-600">
          {g.progress && g.progress.total > 1
            ? `저장된 데이터를 안전하게 암호화하고 있습니다 (${g.progress.done}/${g.progress.total}). 창을 닫거나 전원을 끄지 말고 잠시만 기다려 주세요.`
            : '저장된 데이터를 준비하고 있습니다.'}
        </p>
      </Card>
    );
  }

  if (g.phase === 'failed') {
    return (
      <Card>
        <Notice message={{ kind: 'error', text: g.error ?? '데이터를 준비하지 못했습니다.' }} />
        <p className="text-center text-xs text-gray-500">데이터는 지워지지 않았습니다. 다시 시도해도 같으면 앱을 닫았다가 다시 실행하세요.</p>
        <div className="flex justify-center">
          <button type="button" className="btn-primary" onClick={() => void g.retry()}>
            다시 시도
          </button>
        </div>
      </Card>
    );
  }

  if (g.phase === 'keyLost') {
    return (
      <Card>
        <Notice message={{ kind: 'error', text: g.error ?? '데이터 열쇠를 풀 수 없습니다.' }} />
        <p className="text-sm leading-relaxed text-gray-600">
          이 PC나 Windows 계정이 바뀌어 저장된 데이터를 열 수 없습니다. 수동 백업 파일(백업 암호로 만든 파일)이 있으면 새로 시작한 뒤 [설정]에서 복원할 수 있습니다.
        </p>
        {!can(g.role, 'data:reset') ? (
          <p className="text-center text-sm font-semibold text-gray-700">모든 데이터를 지우는 일은 관리자만 할 수 있습니다. 관리자에게 문의하세요.</p>
        ) : confirmingRestart ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-semibold text-red-700">
              이 PC에 저장된 모든 데이터가 지워지고 되돌릴 수 없습니다. 정말 새로 시작할까요?
            </p>
            <div className="flex justify-center gap-2">
              <button type="button" className="btn-danger" onClick={() => void g.restart()}>
                모두 지우고 새로 시작
              </button>
              <button type="button" className="btn" onClick={() => setConfirmingRestart(false)}>
                돌아가기
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <button type="button" className="btn" onClick={() => setConfirmingRestart(true)}>
              새로 시작…
            </button>
          </div>
        )}
      </Card>
    );
  }

  const pending = g.phase === 'pending';
  return (
    <Card>
      <p className="text-center text-sm leading-relaxed text-gray-600">
        {pending ? '열린 브라우저에서 구글 로그인을 마치세요. 끝나면 이 창으로 자동으로 돌아옵니다.' : '앱을 쓰려면 구글 계정으로 로그인하세요. 로그인할 때만 인터넷이 필요하고, 헌금 자료는 밖으로 나가지 않습니다.'}
      </p>
      {!g.configured ? <Notice message={{ kind: 'error', text: '로그인 설정(구글 클라이언트 ID)이 없어 로그인할 수 없습니다. 관리자에게 문의하세요.' }} /> : null}
      <Notice message={g.error ? { kind: 'error', text: g.error } : null} />
      <div className="flex justify-center gap-2">
        {pending ? (
          <button type="button" className="btn" onClick={g.cancel}>
            취소
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={!g.configured} onClick={() => void g.login()}>
            구글로 로그인
          </button>
        )}
      </div>
    </Card>
  );
}
