import { memo } from 'react';
import { useDailyTotals } from '../../../hooks/useDailyTotals';
import { formatNumber, formatWon } from '../../../services/domain/amount';
import { DateText } from '../../shared/DateText';

/** 선택일 합계 대조 (입력 칸 변경에는 리렌더되지 않도록 별도 컴포넌트로 분리) */
export const DailyTotalsBar = memo(function DailyTotalsBar({ date, flashKey = 0 }: { date: string; flashKey?: number }) {
  const t = useDailyTotals(date);
  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      {/* flashKey가 바뀔 때(저장 성공) 합계 영역이 잠깐 강조됩니다. */}
      <div key={flashKey} className={`rounded px-1 ${flashKey > 0 ? 'flash-save' : ''}`}>
        <div className="text-xs text-gray-500"><DateText date={date} /> 입력 합계</div>
        {t.failed ? (
          <div role="alert" className="flex items-center gap-2 text-sm font-semibold text-red-700">
            이 달 내역을 불러오지 못했습니다.
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={t.retry}>
              다시 불러오기
            </button>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold">{formatWon(t.total)}</span>
            <span className="text-xs text-gray-500">{formatNumber(t.count)}건</span>
          </div>
        )}
      </div>
      <div className="ml-auto flex items-end gap-2">
        <label>
          <span className="label">현금 계수 금액</span>
          <input
            className="input w-40 text-right"
            inputMode="numeric"
            id="cash-count-input"
            value={t.cashInput}
            onChange={(e) => t.onCashChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter: 계수 입력을 마치고 성도 검색으로 돌아갑니다.
              if (e.key === 'Enter') document.getElementById('member-search-input')?.focus();
            }}
            placeholder="직접 세어본 금액 입력 (F4)"
          />
        </label>
        {t.diff === null ? null : t.matched ? (
          <span className="mb-1.5 rounded bg-emerald-100 px-2 py-1 text-sm font-semibold text-emerald-700">일치</span>
        ) : (
          <span className="mb-1.5 rounded bg-red-100 px-2 py-1 text-sm font-semibold text-red-700">
            차액 {t.diff > 0 ? '+' : ''}
            {formatNumber(t.diff)}원
          </span>
        )}
      </div>
      </div>
      {t.rows.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {t.rows.map((r) => (
            <span key={r.id} className="rounded bg-gray-100 px-2 py-1 text-xs">
              {r.name} <b>{formatNumber(r.amount)}</b>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
});
