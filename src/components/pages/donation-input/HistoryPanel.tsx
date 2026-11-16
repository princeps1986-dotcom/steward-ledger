import type { Donation } from '../../../contexts/types';
import { useHistoryItems } from '../../../hooks/useHistoryItems';
import { formatNumber } from '../../../services/domain/amount';

interface Props {
  canUndo: boolean;
  onUndo(): void;
  onEdit(d: Donation): void;
}

export function HistoryPanel({ canUndo, onUndo, onEdit }: Props) {
  const items = useHistoryItems();
  return (
    <aside className="card h-fit space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">최근 입력 (이번 실행)</h3>
        <button className="btn px-2 py-1 text-xs" onClick={onUndo} disabled={!canUndo}>
          직전 입력 되돌리기
        </button>
      </div>
      {items.length === 0 ? <p className="text-xs text-gray-500">아직 저장한 내역이 없습니다.</p> : null}
      <ul className="space-y-2">
        {items.map((b, i) => (
          <li key={b.batchId} className={`rounded border px-2 py-1.5 text-xs ${i === 0 ? 'border-blue-200 bg-blue-50' : 'border-gray-100'}`}>
            <div className="flex justify-between">
              <b>{b.donorDisplayName}</b>
              <span className="text-gray-500">{new Date(b.savedAt).toLocaleTimeString('ko-KR')}</span>
            </div>
            {b.lines.map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-2 py-0.5 text-gray-600">
                <span>
                  {l.typeName}
                  {l.merged ? (l.donation ? ' (합산 후 금액)' : ' (합산)') : ''}
                </span>
                <span className="flex items-center gap-1.5">
                  {formatNumber(l.amount)}
                  {l.donation ? (
                    <button type="button" className="btn px-1.5 py-0 text-[11px]" onClick={() => onEdit(l.donation!)} aria-label={`${b.donorDisplayName} ${l.typeName} 수정`}>
                      수정
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-400">[수정]으로 금액·종류·날짜를 바로 고칠 수 있습니다(사유 필수). 앱을 다시 시작하면 이 목록은 비워지며, 이후 정정은 보고서 화면에서 하세요.</p>
    </aside>
  );
}
