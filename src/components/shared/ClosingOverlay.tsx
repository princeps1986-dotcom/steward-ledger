import { useEffect, useState } from 'react';

/**
 * 앱을 닫는 중 자동 백업이 끝나길 기다리는 동안 화면을 덮는 안내.
 * 백업이 금방 끝나면(0.4초 안) 깜빡이지 않도록 늦게 보여 주고, 오래 걸릴 때만 [백업 없이 종료]를 내놓습니다.
 */
export function ClosingOverlay({ onSkip }: { onSkip(): void }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSec((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 400);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="종료 전 백업 중"
      className={`no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/60 ${visible ? '' : 'invisible'}`}
    >
      <div className="w-[26rem] max-w-[90vw] space-y-3 rounded-lg bg-white p-6 text-center shadow-xl">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" aria-hidden="true" />
        <h2 className="text-base font-bold">종료 전에 데이터를 백업하고 있습니다</h2>
        <p className="text-sm leading-relaxed text-gray-600">
          백업이 끝나면 앱이 자동으로 종료됩니다. 컴퓨터를 끄거나 전원을 뽑지 말고 잠시만 기다려 주세요. ({sec}초 경과)
        </p>
        {sec >= 8 ? (
          <div className="space-y-1">
            <p className="text-xs text-gray-500">너무 오래 걸리면 백업 없이 종료할 수 있습니다. 데이터는 그대로 저장되어 있습니다.</p>
            <button className="btn" onClick={onSkip}>
              백업 없이 종료
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
