import { formatDateTime } from '../../services/domain/dates';
import type { AutoSaveStatus } from '../../hooks/useAppShell';

/** 사용 중 자동 백업(10분마다)이 도는 동안·끝난 직후 오른쪽 아래에 잠깐 보이는 작은 안내(인쇄에는 나오지 않음) */
export function AutoSaveToast({ status }: { status: AutoSaveStatus }) {
  if (!status) return null;
  return (
    <div role="status" aria-live="polite" className="no-print fixed bottom-3 right-3 z-40 rounded-md bg-slate-800 px-3 py-2 text-xs text-white shadow-lg">
      {status.state === 'saving' ? '자동 백업 중… (계속 입력하셔도 됩니다)' : `자동 백업 완료 (${formatDateTime(status.at).slice(11, 16)})`}
    </div>
  );
}
