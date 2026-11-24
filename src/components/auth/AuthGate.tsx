import { useState, type ReactNode } from 'react';
import { useAuthGate } from '../../hooks/useAuthGate';
import { can } from '../../services/auth/roles';
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

/** PC앱은 구글 로그인을 마치고 저장 데이터 준비(열쇠·암호화 이전)가 끝나야 앱을 그립니다. 브라우저(시연) 모드는 그대로 통과합니다. */
export function AuthGate({ children }: { children: ReactNode }) {
  const g = useAuthGate();
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  if (g.phase === 'ready') return <>{children}</>;
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
