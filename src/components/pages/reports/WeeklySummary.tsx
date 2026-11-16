import { useWeeklyMatrix, type ReportFilters } from '../../../hooks/useReports';
import { useNameTag } from '../../../hooks/useNameTag';
import { formatNumber } from '../../../services/domain/amount';
import { NameWithTag } from './NameWithTag';
import { PrintHeader } from './PrintHeader';
import { REPORT_SCROLL } from './reportScroll';
import { SpacerRow } from './SpacerRow';

/** 종합 보고서 · 기간 '주별': 가로 = 헌금 종류, 세로 = 성도명 */
export function WeeklySummary({ f }: { f: ReportFilters }) {
  const { matrix: m, rangeLabel, hasData } = useWeeklyMatrix(f);
  const tagOf = useNameTag();
  return (
    <section className="card space-y-3">
      <PrintHeader
        title={`주별 헌금 보고서 (${rangeLabel})`}
        stats={[
          { label: '주간 총 헌금', value: `${formatNumber(m.total)}원` },
          { label: '건수', value: formatNumber(m.count) },
          { label: '인원', value: formatNumber(m.rows.length) },
        ]}
      />
      <h2 className="no-print text-lg font-bold">주별 헌금 보고서 ({rangeLabel})</h2>
      <div className="no-print flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-500">주간 총 헌금</div>
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
        <div className={`${REPORT_SCROLL} print:-mt-4`}>
          <table className="rpt-table w-full">
            <thead>
              <SpacerRow cols={m.columns.length + 3} />
              <tr>
                <th className="th sticky left-0 top-0 z-20 w-10 min-w-10 max-w-10 px-1 text-center print:static">No</th>
                <th className="th rpt-name-col sticky left-10 top-0 z-20 w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem] print:static">성도명</th>
                {m.columns.map((c) => (
                  <th key={c.id} className="th sticky top-0 z-10 text-right print:static">
                    {c.name}
                  </th>
                ))}
                <th className="th sticky top-0 z-10 text-right print:static">합계</th>
              </tr>
            </thead>
            <tbody>
              {m.rows.map((r, i) => (
                <tr key={r.key} className={(i + 1) % 10 === 0 ? 'row-sep' : ''}>
                  <td className="rpt-num td sticky left-0 w-10 min-w-10 max-w-10 bg-white px-1 text-center text-xs text-gray-500 print:static">{i + 1}</td>
                  <td className="rpt-name td sticky left-10 w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem] bg-white font-medium leading-tight print:static">
                    <NameWithTag name={r.name} tag={r.isAnonymous ? null : tagOf(r.key)} />
                  </td>
                  {r.cells.map((v, i) => (
                    <td key={i} className="td text-right tabular-nums">
                      {v ? formatNumber(v) : '-'}
                    </td>
                  ))}
                  <td className="rpt-total td text-right font-semibold tabular-nums">{formatNumber(r.total)}</td>
                </tr>
              ))}
              {/* 합계 행은 스크롤과 상관없이 표 아래쪽에 고정해 항상 보이게 합니다(머리글은 위쪽 고정). */}
              <tr className="rpt-total-row font-semibold">
                <td className="td sticky left-0 bottom-0 z-20 bg-gray-50 shadow-[0_-1px_0_0_var(--color-gray-300)] print:static print:shadow-none" />
                <td className="td sticky left-10 bottom-0 z-20 bg-gray-50 shadow-[0_-1px_0_0_var(--color-gray-300)] print:static print:shadow-none">합계</td>
                {m.columnTotals.map((v, i) => (
                  <td key={i} className="td text-right tabular-nums sticky bottom-0 z-10 bg-gray-50 shadow-[0_-1px_0_0_var(--color-gray-300)] print:static print:shadow-none">
                    {formatNumber(v)}
                  </td>
                ))}
                <td className="td text-right tabular-nums sticky bottom-0 z-10 bg-gray-50 shadow-[0_-1px_0_0_var(--color-gray-300)] print:static print:shadow-none">{formatNumber(m.total)}</td>
              </tr>
            </tbody>
            <tfoot className="print-foot">
              <SpacerRow cols={m.columns.length + 3} />
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-gray-500">이 주에 저장된 헌금 내역이 없습니다.</p>
      )}
    </section>
  );
}
