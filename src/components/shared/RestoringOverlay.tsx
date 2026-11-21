import { useEffect, useState } from 'react';
import { useRestoreProgress, useRestoreStage } from '../../services/backup/backupBusy';

/**
 * 백업 파일 확인·복원 중 화면을 덮어 다른 조작(저장·이동)을 막는 안내.
 * 확인 중에는 확인한 달 수를, 줄 단위 복원은 저장한 달 수를, 그 외에는 경과 시간만 보여 줍니다.
 */
export function RestoringOverlay() {
  const progress = useRestoreProgress();
  const checking = useRestoreStage() === 'check';
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSec((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const pct = !checking && progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;
  return (
    <div role="alertdialog" aria-modal="true" aria-label={checking ? '백업 파일 확인 중' : '복원 중'} className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-[26rem] max-w-[90vw] space-y-3 rounded-lg bg-white p-6 text-center shadow-xl">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" aria-hidden="true" />
        <h2 className="text-base font-bold">{checking ? '백업 파일을 확인하고 있습니다' : '백업을 복원하고 있습니다'}</h2>
        {checking && progress ? <p className="text-sm tabular-nums text-gray-700">{progress.done}개 달 확인</p> : null}
        {pct !== null ? (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={progress!.total} aria-valuenow={progress!.done} aria-label="복원 진행">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm tabular-nums text-gray-700">
              {progress!.done} / {progress!.total}개 달 복원
            </p>
          </div>
        ) : null}
        <p className="text-sm leading-relaxed text-gray-600">끝날 때까지 앱을 닫거나 다른 작업을 하지 말고 잠시만 기다려 주세요. ({sec}초 경과)</p>
      </div>
    </div>
  );
}
