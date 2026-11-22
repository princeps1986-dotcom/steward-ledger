import { usePaging } from '../../../hooks/usePaging';
import { useWeeklyMatrix, type ReportFilters } from '../../../hooks/useReports';
import { useIsPrinting } from '../../../hooks/useIsPrinting';
import { useNameTag } from '../../../hooks/useNameTag';
import { formatNumber } from '../../../services/domain/amount';
import { Pager } from '../../shared/Pager';
import { NameWithTag } from './NameWithTag';
import { PrintHeader } from './PrintHeader';
import { PAGER_RESERVE, REPORT_SCROLL, useFitHeight } from './reportScroll';
import { SpacerRow } from './SpacerRow';

const PAGE_SIZE = 100;

/** 종합 보고서 · 기간 '주별': 가로 = 헌금 종류, 세로 = 성도명 */
export function WeeklySummary({ f, hidden, includeInactive }: { f: ReportFilters; hidden: ReadonlySet<string>; includeInactive: boolean }) {
  const { matrix: m, rangeLabel, hasData } = useWeeklyMatrix(f, hidden, includeInactive);
  const tagOf = useNameTag();
  const isMonth = f.personKind === 'MONTH';
  const isDay = f.personKind === 'DAY';
  const kindLabel = isMonth ? '월별' : isDay ? '일별' : '주별';
  const periodWord = isMonth ? '월간' : isDay ? '당일' : '주간';
  // 보고서·표시 조건이 바뀌면 1쪽·맨 위로 돌아갑니다.
  const paging = usePaging(m.rows.length, PAGE_SIZE, `${f.label}|${f.personKind}|${includeInactive}|${[...hidden].sort().join(',')}`);
  const fit = useFitHeight(paging.scrollRef, PAGER_RESERVE);
  const printing = useIsPrinting();
  // 화면에서는 현재 쪽의 행만 그리고, 인쇄·PDF 저장은 모든 행을 그립니다(번호는 전체 기준으로 이어짐).
  const visible = printing ? m.rows.map((_, i) => i) : Array.from({ length: paging.to - paging.from }, (_, k) => paging.from + k);
  return (
    <section className="card space-y-3">
      <PrintHeader
        title={`${kindLabel} 헌금 보고서 (${rangeLabel})`}
        stats={[
          { label: `${periodWord} 총 헌금`, value: `${formatNumber(m.total)}원` },
          { label: '건수', value: formatNumber(m.count) },
          { label: '인원', value: formatNumber(m.rows.length) },
        ]}
      />
      <h2 className="no-print text-lg font-bold">{kindLabel} 헌금 보고서 ({rangeLabel})</h2>
      <div className="no-print flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-500">{periodWord} 총 헌금</div>
          <div className="text-2xl font-bold tabular-nums">{formatNumber(m.total)}원</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">건수</div>
          <div className="text-2xl font-bold tabular-nums">{formatNumber(m.count)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">인원</div>
          <div className="text-2xl font-bold tabular-nums">{formatNumber(m.rows.length)}</div>
        </div>
      </div>

      {hasData ? (
        // 화면에서는 표 안에서 스크롤하며 머리글 행·성도명 열을 고정합니다. 인쇄할 때는 제한을 풀고 페이지마다 머리글을 반복합니다.
        <>
        <div ref={paging.scrollRef} style={fit} className={`${REPORT_SCROLL} print:-mt-4`}>
          <table className="rpt-table w-full">
            <thead>
              <SpacerRow cols={m.columns.length + 3} />
              <tr>
                <th className="th sticky left-0 top-0 z-20 w-10 min-w-10 max-w-10 px-1 text-center print:static">No</th>
                <th className="th rpt-name-col sticky left-10 top-0 z-20 w-[9rem] min-w-[9rem] max-w-[9rem] print:static">성도명</th>
                {m.columns.map((c) => (
                  <th key={c.id} className="th sticky top-0 z-10 px-1.5 text-right print:static">
                    {c.name}
                  </th>
                ))}
                <th className="th sticky top-0 z-10 px-1.5 text-right print:static">합계</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const r = m.rows[i];
                return (
                <tr key={r.key} data-index={i} className={(i + 1) % 10 === 0 ? 'row-sep' : ''}>
                  <td className="rpt-num td sticky left-0 w-10 min-w-10 max-w-10 bg-white px-1 text-center text-xs text-gray-500 print:static">{i + 1}</td>
                  <td className="rpt-name td sticky left-10 w-[9rem] min-w-[9rem] max-w-[9rem] bg-white whitespace-nowrap font-medium leading-tight print:static">
                    <NameWithTag name={r.name} tag={r.isAnonymous ? null : tagOf(r.key)} />
                  </td>
                  {r.cells.map((v, i) => (
                    <td key={i} className="td whitespace-nowrap px-1.5 text-right tabular-nums">
                      {v ? formatNumber(v) : '-'}
                    </td>
                  ))}
                  <td className="rpt-total td whitespace-nowrap px-1.5 text-right font-semibold tabular-nums">{formatNumber(r.total)}</td>
                </tr>
                );
              })}
              {/* 합계 행은 스크롤·쪽과 상관없이 표 아래쪽에 고정해 항상 보이게 합니다(전체 합계, 머리글은 위쪽 고정). */}
              <tr className="rpt-total-row font-semibold">
                <td className="td sticky left-0 bottom-0 z-20 bg-gray-50 shadow-[0_-1px_0_0_var(--color-gray-300)] print:static print:shadow-none" />
                <td className="td sticky left-10 bottom-0 z-20 bg-gray-50 shadow-[0_-1px_0_0_var(--color-gray-300)] print:static print:shadow-none">합계</td>
                {m.columnTotals.map((v, i) => (
                  <td key={i} className="td whitespace-nowrap px-1.5 text-right tabular-nums sticky bottom-0 z-10 bg-gray-50 shadow-[0_-1px_0_0_var(--color-gray-300)] print:static print:shadow-none">
                    {formatNumber(v)}
                  </td>
                ))}
                <td className="td whitespace-nowrap px-1.5 text-right tabular-nums sticky bottom-0 z-10 bg-gray-50 shadow-[0_-1px_0_0_var(--color-gray-300)] print:static print:shadow-none">{formatNumber(m.total)}</td>
              </tr>
            </tbody>
            <tfoot className="print-foot">
              <SpacerRow cols={m.columns.length + 3} />
            </tfoot>
          </table>
        </div>
        <div className="no-print">
          <Pager paging={paging} unit="명" />
        </div>
        </>
      ) : (
        <p className="py-6 text-center text-sm text-gray-500">{isMonth ? '이 달에' : isDay ? '이 날에' : '이 주에'} 저장된 헌금 내역이 없습니다.</p>
      )}
    </section>
  );
}
