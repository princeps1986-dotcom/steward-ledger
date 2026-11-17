import { useEffect, useState } from 'react';
import { describeUnhandled } from '../../services/errorMessage';

/**
 * 처리되지 않은 오류·Promise 거부를 화면 위쪽 안내로 보여 줍니다(저장 도중 비동기 오류가 나도 조용히 사라지지 않도록).
 * 화면 그리기 중 오류는 ErrorBoundary가 맡습니다.
 */
export function GlobalErrorBanner() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const show = (reason: unknown): void => {
      const text = describeUnhandled(reason);
      if (text) setMessage(text);
    };
    const onRejection = (e: PromiseRejectionEvent): void => show(e.reason);
    const onError = (e: ErrorEvent): void => show(e.error ?? e.message);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);
  if (!message) return null;
  return (
    <div role="alert" className="no-print flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
      <span className="flex-1">{message}</span>
      <button className="btn" onClick={() => setMessage(null)}>
        닫기
      </button>
    </div>
  );
}
