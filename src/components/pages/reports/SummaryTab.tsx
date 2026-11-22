import { useSummaryReport, type ReportFilters } from '../../../hooks/useReports';
import { formatNumber, formatWon } from '../../../services/domain/amount';
import { PrintHeader } from './PrintHeader';
import { SpacerRow } from './SpacerRow';
import { WeeklySummary } from './WeeklySummary';

/** 기간이 '주별'·'월별'이면 성도명 × 헌금 종류 교차표(월별은 그 달의 모든 주를 개인별로 합산), 그 외(분기·연)는 헌금 종류 × 월 매트릭스 */
export function SummaryTab({ f, hidden, includeInactive }: { f: ReportFilters; hidden: ReadonlySet<string>; includeInactive: boolean }) {
  return f.personRange ? <WeeklySummary f={f} hidden={hidden} includeInactive={includeInactive} /> : <PeriodSummary f={f} hidden={hidden} />;
}

function PeriodSummary({ f, hidden }: { f: ReportFilters; hidden: ReadonlySet<string> }) {
  const r = useSummaryReport(f, hidden);
  return (
    <section className="card space-y-3">
      <PrintHeader
        title={`${f.label} 헌금 결산 보고서`}
        stats={[
          { label: '총 헌금', value: formatWon(r.total) },
          { label: '건수', value: formatNumber(r.count) },
          { label: '무명/방문자', value: formatWon(r.anonymousTotal) },
        ]}
      />
      <div className="no-print flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-500">{f.label} 총 헌금</div>
          <div className="text-2xl font-bold">{formatWon(r.total)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">건수</div>
          <div className="text-2xl font-bold">{formatNumber(r.count)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">무명/방문자 헌금</div>
          <div className="text-2xl font-bold">{formatWon(r.anonymousTotal)}</div>
        </div>
      </div>
      <div className="overflow-x-auto print:-mt-4">
        <table className="rpt-table w-full">
          <thead>
            <SpacerRow cols={r.months.length + 2} />
            <tr>
              <th className="th">헌금 종류</th>
              {r.months.map((m) => (
                <th key={m} className="th text-right">
                  {m}월
                </th>
              ))}
              <th className="th text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.id}>
                <td className="rpt-name td font-medium">{row.name}</td>
                {row.cells.map((v, i) => (
                  <td key={i} className="td text-right tabular-nums">
                    {v ? formatNumber(v) : '-'}
                  </td>
                ))}
                <td className="rpt-total td text-right font-semibold tabular-nums">{formatNumber(row.total)}</td>
              </tr>
            ))}
            <tr className="rpt-total-row bg-gray-50 font-semibold">
              <td className="td">합계</td>
              {r.monthTotals.map((v, i) => (
                <td key={i} className="td text-right tabular-nums">
                  {formatNumber(v)}
                </td>
              ))}
              <td className="td text-right tabular-nums">{formatNumber(r.total)}</td>
            </tr>
          </tbody>
          <tfoot className="print-foot">
            <SpacerRow cols={r.months.length + 2} />
          </tfoot>
        </table>
      </div>
    </section>
  );
}
