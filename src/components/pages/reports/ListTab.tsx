import { useDonationEditor } from '../../../hooks/useDonationEditor';
import { usePaging } from '../../../hooks/usePaging';
import { useDonationListReport, type ReportFilters } from '../../../hooks/useReports';
import { formatNumber, formatWon } from '../../../services/domain/amount';
import { DateText } from '../../shared/DateText';
import { Pager } from '../../shared/Pager';
import { DonationEditModal } from './DonationEditModal';
import { NameWithTag } from './NameWithTag';
import { PAGER_RESERVE, REPORT_SCROLL, useFitHeight } from './reportScroll';

const PAGE_SIZE = 100;
const ROW_HEIGHT = 30;
// 번호 · 헌금일 · 입력일 · 표기명 · 종류 · 금액 · 메모(남는 폭) · 관리 — 날짜·표기명·종류·금액은 여유 있게, 메모는 남는 폭만
const GRID = 'grid grid-cols-[2.75rem_9rem_9rem_10rem_8.5rem_9rem_10rem_7.5rem] items-center';

type Row = ReturnType<ReturnType<typeof useDonationListReport>['rowAt']>;

/**
 * 전체 입력 내역: 지금 보고 있는 기간의 모든 헌금 내역(무명/방문자 포함)을 100건씩 나누어 보여 주고 바로 수정·삭제합니다.
 * 보고서 표에서는 같은 이름의 무명 내역이 한 줄로 합쳐 보이므로, 낱개 내역은 여기서 확인합니다.
 * 번호와 10행 단위 구분선이 있고, 페이지 번호로 이동합니다.
 */
export function ListTab({ f }: { f: ReportFilters }) {
  const r = useDonationListReport(f);
  const editor = useDonationEditor();
  const paging = usePaging(r.count, PAGE_SIZE, `${f.label}|${r.query}`);
  const fit = useFitHeight(paging.scrollRef, PAGER_RESERVE);

  const cells = (row: Row, no: number) =>
    !row.donation ? (
      // 그 달의 내역을 읽는 중(다른 달로 막 넘어온 페이지)
      <span className="col-span-full pl-3 text-xs text-gray-400">{no}번 불러오는 중…</span>
    ) : (
      <>
        <span className="text-center text-xs text-gray-500">{no}</span>
        <DateText date={row.donation.date} />
        <span title={row.enteredAt || undefined}>{row.enteredAt ? <DateText date={row.enteredAt.slice(0, 10)} /> : '-'}</span>
        <span className="sticky left-2 z-0 truncate bg-white">
          <NameWithTag name={row.donation.donorDisplayName} tag={row.tag} />
        </span>
        <span className="truncate">{row.typeName}</span>
        <span className="text-right tabular-nums">{row.amountLabel}</span>
        <span className="truncate pl-3 text-gray-600">{row.donation.memo}</span>
        <span className="flex justify-end gap-1">
          <button className="btn px-2 py-0.5 text-xs" onClick={() => editor.open(row.donation!, 'EDIT')}>
            수정
          </button>
          <button className="btn px-2 py-0.5 text-xs" onClick={() => editor.open(row.donation!, 'DELETE')}>
            삭제
          </button>
        </span>
      </>
    );

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <input className="input w-72" value={r.query} onChange={(e) => r.setQuery(e.target.value)} placeholder="이름 (예: 김철수, 무명)" aria-label="이름으로 거르기" />
        <p className="pb-2 text-sm text-gray-600">
          <b>{f.label}</b> · {formatNumber(r.count)}건 · 합계 <b>{formatWon(r.total)}</b>
          {r.loading ? <span className="ml-2 text-xs text-gray-400">불러오는 중…</span> : null}
        </p>
        {r.failed ? (
          <p role="alert" className="pb-2 text-sm text-red-600">
            일부 달의 내역을 불러오지 못해 건수·합계에서 빠졌을 수 있습니다. 다른 기간을 선택했다가 다시 열어 주세요.
          </p>
        ) : null}
      </div>

      <div ref={paging.scrollRef} style={fit} className={`rounded border ${REPORT_SCROLL}`}>
        <div className={`${GRID} w-max min-w-full sticky top-0 z-10 border-b bg-gray-50 px-2 text-xs font-semibold text-gray-600`} style={{ height: ROW_HEIGHT }}>
          <span className="text-center">No</span>
          <span>헌금일</span>
          <span>입력일</span>
          <span className="sticky left-2 z-20 bg-gray-50">표기명</span>
          <span>헌금 종류</span>
          <span className="text-right">금액</span>
          <span className="pl-3">메모</span>
          <span className="text-right">관리</span>
        </div>
        {Array.from({ length: paging.to - paging.from }, (_, k) => {
          const no = paging.from + k + 1;
          const row = r.rowAt(no - 1);
          return (
            <div key={row.donation?.id ?? no} className={`${GRID} w-max min-w-full border-b border-gray-100 px-2 text-sm row-hover ${no % 10 === 0 ? 'row-sep' : ''}`} style={{ height: ROW_HEIGHT }}>
              {cells(row, no)}
            </div>
          );
        })}
        {r.count === 0 ? <p className="px-3 py-4 text-center text-sm text-gray-500">이 기간에 저장된 헌금 내역이 없습니다.</p> : null}
      </div>
      <Pager paging={paging} />
      <DonationEditModal editor={editor} />
    </section>
  );
}
