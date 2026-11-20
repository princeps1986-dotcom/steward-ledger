import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import { useWeeklyMatrix, type ReportFilters } from '../../../hooks/useReports';
import { useIsPrinting } from '../../../hooks/useIsPrinting';
import { useNameTag } from '../../../hooks/useNameTag';
import { formatNumber } from '../../../services/domain/amount';
import { NameWithTag } from './NameWithTag';
import { PrintHeader } from './PrintHeader';
import { REPORT_SCROLL, useFitHeight } from './reportScroll';
import { SpacerRow } from './SpacerRow';

// 가상 스크롤용 행 높이 추정값(실제 높이는 글자 크기 설정에 따라 달라지므로 그려진 행을 직접 재서 보정)과 머리글 높이
const ROW_HEIGHT = 34;
const HEAD_HEIGHT = 30;

/** 종합 보고서 · 기간 '주별': 가로 = 헌금 종류, 세로 = 성도명 */
export function WeeklySummary({ f, hidden }: { f: ReportFilters; hidden: ReadonlySet<string> }) {
  const { matrix: m, rangeLabel, hasData } = useWeeklyMatrix(f, hidden);
  const tagOf = useNameTag();
  const isMonth = f.personKind === 'MONTH';
  const isDay = f.personKind === 'DAY';
  const kindLabel = isMonth ? '월별' : isDay ? '일별' : '주별';
  const periodWord = isMonth ? '월간' : isDay ? '당일' : '주간';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fit = useFitHeight(scrollRef);
  // 보고서(기간·날짜)가 바뀌면 표를 맨 위로 되돌립니다.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [f.label, f.personKind]);
  const printing = useIsPrinting();
  // 화면에서는 보이는 행(약 40행)만 그리고 위아래는 빈 행으로 높이만 채웁니다. 인쇄할 때는 모든 행을 그립니다.
  const virtualizer = useVirtualizer({
    count: m.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
    scrollMargin: HEAD_HEIGHT, // 머리글이 같은 스크롤 영역 안(맨 위)에 있습니다.
  });
  const items = printing ? null : virtualizer.getVirtualItems();
  const first = items && items.length ? items[0] : null;
  const last = items && items.length ? items[items.length - 1] : null;
  const padTop = first ? first.start - virtualizer.options.scrollMargin : 0;
  const padBottom = last ? virtualizer.getTotalSize() - (last.end - virtualizer.options.scrollMargin) : 0;
  const visible = items ? items.map((vi) => vi.index) : m.rows.map((_, i) => i);
  const colSpan = m.columns.length + 3;
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
        <div ref={scrollRef} style={fit} className={`${REPORT_SCROLL} print:-mt-4`}>
          <table className="rpt-table w-full">
            <thead>
              <SpacerRow cols={m.columns.length + 3} />
              <tr>
                <th className="th sticky left-0 top-0 z-20 w-10 min-w-10 max-w-10 px-1 text-center print:static">No</th>
                <th className="th rpt-name-col sticky left-10 top-0 z-20 w-[14rem] min-w-[14rem] max-w-[14rem] print:static">성도명</th>
                {m.columns.map((c) => (
                  <th key={c.id} className="th sticky top-0 z-10 px-1.5 text-right print:static">
                    {c.name}
                  </th>
                ))}
                <th className="th sticky top-0 z-10 px-1.5 text-right print:static">합계</th>
              </tr>
            </thead>
            <tbody>
              {padTop > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: `${padTop}px`, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {visible.map((i) => {
                const r = m.rows[i];
                return (
                <tr key={r.key} data-index={i} ref={printing ? undefined : virtualizer.measureElement} className={(i + 1) % 10 === 0 ? 'row-sep' : ''}>
                  <td className="rpt-num td sticky left-0 w-10 min-w-10 max-w-10 bg-white px-1 text-center text-xs text-gray-500 print:static">{i + 1}</td>
                  <td className="rpt-name td sticky left-10 w-[14rem] min-w-[14rem] max-w-[14rem] bg-white whitespace-nowrap font-medium leading-tight print:static">
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
              {padBottom > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: `${padBottom}px`, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {/* 합계 행은 스크롤과 상관없이 표 아래쪽에 고정해 항상 보이게 합니다(머리글은 위쪽 고정). */}
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
      ) : (
        <p className="py-6 text-center text-sm text-gray-500">이 주에 저장된 헌금 내역이 없습니다.</p>
      )}
    </section>
  );
}
