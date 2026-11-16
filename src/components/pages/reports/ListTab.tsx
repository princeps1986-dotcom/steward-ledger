import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { useDonationEditor } from '../../../hooks/useDonationEditor';
import { useIsPrinting } from '../../../hooks/useIsPrinting';
import { useDonationListReport, type ReportFilters } from '../../../hooks/useReports';
import { formatNumber, formatWon } from '../../../services/domain/amount';
import { DonationEditModal } from './DonationEditModal';
import { NameWithTag } from './NameWithTag';
import { REPORT_SCROLL, useFitHeight } from './reportScroll';

const HEAD_HEIGHT = 30;
const ROW_HEIGHT = 30;
// 번호 · 날짜 · 표기명 · 종류 · 금액 · 메모(남는 폭) · 관리 — 날짜·표기명·종류·금액은 여유 있게, 메모는 남는 폭만
const GRID = 'grid grid-cols-[2.75rem_8rem_10rem_8.5rem_9rem_minmax(8rem,1fr)_7.5rem] items-center print:grid-cols-[2.75rem_8rem_10rem_8.5rem_9rem_minmax(8rem,1fr)]';

type Row = ReturnType<ReturnType<typeof useDonationListReport>['rowAt']>;

/**
 * 전체 입력 내역: 지금 보고 있는 기간의 모든 헌금 내역(무명/방문자 포함)을 한 줄씩 보여 주고 바로 수정·삭제합니다.
 * 보고서 표에서는 같은 이름의 무명 내역이 한 줄로 합쳐 보이므로, 낱개 내역은 여기서 확인합니다.
 * 종합 보고서 표와 같은 스크롤 영역(머리글 고정)을 쓰고, 번호와 10행 단위 구분선이 있습니다.
 */
export function ListTab({ f }: { f: ReportFilters }) {
  const r = useDonationListReport(f);
  const editor = useDonationEditor();
  const printing = useIsPrinting();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const fit = useFitHeight(parentRef);
  const virtualizer = useVirtualizer({
    count: r.count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    scrollMargin: HEAD_HEIGHT, // 머리글이 같은 스크롤 영역 안(맨 위)에 있으므로 그만큼 시작 위치를 뺍니다.
  });

  const cells = (row: Row, no: number) => (
    <>
      <span className="rpt-num text-center text-xs text-gray-500">{no}</span>
      <span>{row.donation.date}</span>
      <span className="truncate">
        <NameWithTag name={row.donation.donorDisplayName} tag={row.tag} />
      </span>
      <span className="truncate">{row.typeName}</span>
      <span className="text-right tabular-nums">{row.amountLabel}</span>
      <span className="truncate pl-3 text-gray-600">{row.donation.memo}</span>
      <span className="no-print flex justify-end gap-1">
        <button className="btn px-2 py-0.5 text-xs" onClick={() => editor.open(row.donation, 'EDIT')}>
          수정
        </button>
        <button className="btn px-2 py-0.5 text-xs" onClick={() => editor.open(row.donation, 'DELETE')}>
          삭제
        </button>
      </span>
    </>
  );
  const rowClass = (no: number) => `${GRID} w-full border-b border-gray-100 px-2 text-sm ${no % 10 === 0 ? 'row-sep' : ''}`;

  return (
    <section className="card space-y-3">
      <div className="no-print flex flex-wrap items-end gap-3">
        <input
          className="input w-72"
          value={r.query}
          onChange={(e) => r.setQuery(e.target.value)}
          placeholder="이름 또는 초성 (예: 김철수, ㄱㅊㅅ, 무명)"
          aria-label="이름 또는 초성으로 거르기"
        />
        <p className="pb-2 text-sm text-gray-600">
          <b>{f.label}</b> · {formatNumber(r.count)}건 · 합계 <b>{formatWon(r.total)}</b>
        </p>
      </div>

      <div ref={parentRef} style={fit} className={`rounded border ${REPORT_SCROLL}`}>
        <div
          className={`${GRID} rpt-grid-head sticky top-0 z-10 border-b bg-gray-50 px-2 text-xs font-semibold text-gray-600 print:static`}
          style={{ height: `${HEAD_HEIGHT}px` }}
        >
          <span className="text-center">No</span>
          <span>날짜</span>
          <span>표기명</span>
          <span>헌금 종류</span>
          <span className="text-right">금액</span>
          <span className="pl-3">메모</span>
          <span className="no-print text-right">관리</span>
        </div>
        {printing ? (
          // 인쇄할 때는 가상 스크롤 대신 모든 행을 그대로 그려 목록이 잘리지 않게 합니다.
          Array.from({ length: r.count }, (_, i) => {
            const row = r.rowAt(i);
            return (
              <div key={row.donation.id} className={rowClass(i + 1)} style={{ height: `${ROW_HEIGHT}px` }}>
                {cells(row, i + 1)}
              </div>
            );
          })
        ) : (
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = r.rowAt(vi.index);
              return (
                <div
                  key={row.donation.id}
                  className={`${rowClass(vi.index + 1)} absolute left-0 top-0`}
                  style={{ height: `${vi.size}px`, transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)` }}
                >
                  {cells(row, vi.index + 1)}
                </div>
              );
            })}
          </div>
        )}
        {r.count === 0 ? <p className="px-3 py-4 text-center text-sm text-gray-500">이 기간에 저장된 헌금 내역이 없습니다.</p> : null}
      </div>
      <DonationEditModal editor={editor} />
    </section>
  );
}
