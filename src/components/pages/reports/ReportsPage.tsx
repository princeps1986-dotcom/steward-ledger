import { useEffect, useMemo, useState } from 'react';
import { useHasExportableData, useReportExport, useReportFilters, useTypeToggleOptions, type ReportTab } from '../../../hooks/useReports';
import type { PeriodType } from '../../../services/domain/dates';
import { DatePicker } from '../../shared/DatePicker';
import { Notice } from '../../shared/Notice';
import { AuditTab } from './AuditTab';
import { ListTab } from './ListTab';
import { PersonalTab } from './PersonalTab';
import { PrintHeader } from './PrintHeader';
import { SummaryTab } from './SummaryTab';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'SUMMARY', label: '종합 보고서' },
  { key: 'LIST', label: '전체 입력 내역' },
  { key: 'PERSONAL', label: '개인별·세대별 내역' },
  { key: 'AUDIT', label: '수정·삭제 이력' },
];

export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('SUMMARY');
  // 전체 입력 내역 탭은 기간의 헌금을 메모리에 올리지 않고 달 단위로 직접 읽습니다(큰 연도에서도 메모리가 작음).
  const f = useReportFilters(tab !== 'LIST');
  // 표시할 헌금 종류(종합 보고서 전용). 기본값은 헌금 종류의 활성 여부(활성=체크, 비활성=해제)이고,
  // 사용자가 바꾼 종류만 flippedIds에 기억합니다. 다른 보고서·다른 탭으로 가거나 이 화면을 떠나면 기본값으로 돌아갑니다.
  const typeOptions = useTypeToggleOptions(f);
  const [flippedIds, setFlippedIds] = useState<string[]>([]);
  const hidden = useMemo(() => {
    const flipped = new Set(flippedIds);
    return new Set(typeOptions.filter((o) => o.isActive === flipped.has(o.id)).map((o) => o.id));
  }, [typeOptions, flippedIds]);
  const ex = useReportExport(f);
  // 노출할 내역이 없으면(모든 종류를 숨겼거나 기간에 내역이 없음) 인쇄·PDF 저장을 막습니다.
  const hasData = useHasExportableData(f, hidden);
  const exportDisabled = f.pending || f.loadFailed || !hasData;
  // 보고서(기간 종류·연도·분기/월·주)가 바뀌면 항상 [종합 보고서] 탭부터 보여 줍니다.
  const reportKey = f.isRange ? `${f.periodType}:${f.week.start}` : `${f.periodType}:${f.year}:${f.periodValue}`;
  useEffect(() => {
    setTab('SUMMARY');
    setFlippedIds([]);
  }, [reportKey]);
  const changeTab = (t: ReportTab) => {
    setTab(t);
    setFlippedIds([]);
  };
  const toggleType = (id: string) => setFlippedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  // 모두 표시: 활성 종류는 기본 그대로, 비활성 종류는 뒤집어 체크합니다.
  const showAll = () => setFlippedIds(typeOptions.filter((o) => !o.isActive).map((o) => o.id));
  // 종합 보고서는 본문(표 바로 위)에 제목·요약·출력일시가 있는 자체 인쇄 머리글을 가지므로 여기서는 나머지 탭만 처리합니다.
  const showPrintTitle = tab !== 'SUMMARY';
  return (
    <div className="space-y-4">
      <section className="card no-print flex flex-wrap items-end gap-3">
        {f.sel.isRange ? null : (
          <label>
            <span className="label">연도</span>
            <select className="input" value={f.sel.year} onChange={(e) => f.setYear(e.target.value)}>
              {f.yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span className="label">기간</span>
          <select className="input" value={f.sel.periodType} onChange={(e) => f.setPeriodType(e.target.value as PeriodType)}>
            <option value="YEAR">연도별</option>
            <option value="QUARTER">분기별</option>
            <option value="MONTH">월별</option>
            <option value="WEEK">주별</option>
            <option value="DAY">일별</option>
          </select>
        </label>
        {f.periodValueOptions.length ? (
          <label>
            <span className="label">&nbsp;</span>
            <select className="input" value={f.sel.periodValue} onChange={(e) => f.setPeriodValue(Number(e.target.value))}>
              {f.periodValueOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {f.sel.isRange ? (
          <>
            <div className="w-52">
              <span className="label">{f.sel.isDay ? '일 선택' : '주 선택 (해당 날짜가 속한 주)'}</span>
              <DatePicker value={f.weekDate} onChange={f.setWeekDate} ariaLabel={f.sel.isDay ? '일별 보고서 날짜' : '주별 보고서 날짜'} />
            </div>
            <div className="flex gap-3 whitespace-nowrap">
              <button className="btn" onClick={f.sel.isDay ? f.prevDay : f.prevWeek}>
                {f.sel.isDay ? '‹ 이전 일' : '‹ 이전 주'}
              </button>
              <button className="btn" onClick={f.sel.isDay ? f.nextDay : f.nextWeek}>
                {f.sel.isDay ? '다음 일 ›' : '다음 주 ›'}
              </button>
              <button className="btn" onClick={f.goLastSunday}>
                지난 주일
              </button>
            </div>
          </>
        ) : null}
        <div className="flex-1" />
        {/* 인쇄·PDF 저장은 종합 보고서 탭에서만 보이고 동작합니다(다른 탭은 해당 없음). */}
        {tab === 'SUMMARY' ? (
          <>
            <button className="btn-primary" onClick={ex.print} disabled={exportDisabled}>
              보고서 인쇄
            </button>
            <button className="btn-accent" onClick={() => void ex.savePdf()} disabled={ex.busy || exportDisabled}>
              PDF 저장
            </button>
          </>
        ) : null}
      </section>
      <div className="no-print">
        <Notice message={ex.message} actions={ex.fileActions} />
      </div>

      {showPrintTitle ? <PrintHeader title={`${f.label} 헌금 결산 보고서`} /> : null}

      <nav className="no-print flex gap-1 border-b border-gray-200" role="tablist" aria-label="보고서 종류">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.key ? 'border-blue-600 font-semibold text-blue-700' : 'border-transparent text-gray-600'}`}
            onClick={() => changeTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        {/* 선택이 바뀐 뒤 보고서가 새로 계산되기 전까지 표시합니다. 자리를 유지해 화면이 흔들리지 않게 합니다. */}
        <span className={`ml-auto flex items-center gap-1.5 self-center pr-1 text-xs text-gray-500 ${f.pending ? '' : 'invisible'}`} role="status" aria-live="polite">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" aria-hidden="true" />
          {f.pending ? '보고서를 불러오는 중…' : ''}
        </span>
        {f.loadFailed ? (
          <span role="alert" className="self-center pr-1 text-xs text-red-600">
            보고서를 불러오지 못했습니다. 다시 선택해 주세요.
          </span>
        ) : null}
      </nav>

      {tab === 'SUMMARY' ? (
        <div className="no-print space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="group" aria-label="표시할 헌금 종류">
          <span className="text-gray-600">표시할 헌금 종류</span>
          {typeOptions.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={!hidden.has(o.id)} onChange={() => toggleType(o.id)} />
              {o.name}
            </label>
          ))}
          {hidden.size > 0 ? (
            <button className="btn-quick" onClick={showAll}>
              모두 표시
            </button>
          ) : null}
        </div>
        <p className="text-xs text-gray-500">[헌금 종류]에서 활성 상태인 헌금만 기본으로 체크됩니다.</p>
        </div>
      ) : null}
      <div className={f.pending ? 'opacity-50 transition-opacity' : 'transition-opacity'} aria-busy={f.pending}>
        {tab === 'SUMMARY' ? <SummaryTab f={f} hidden={hidden} /> : null}
        {tab === 'LIST' ? <ListTab f={f} /> : null}
        {tab === 'PERSONAL' ? <PersonalTab f={f} /> : null}
        {tab === 'AUDIT' ? <AuditTab f={f} /> : null}
      </div>

    </div>
  );
}
