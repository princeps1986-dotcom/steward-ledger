import { useEffect, useMemo, useState } from 'react';
import { useReportExport, useReportFilters, useTypeToggleOptions, type ReportTab } from '../../../hooks/useReports';
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
  const f = useReportFilters();
  const [tab, setTab] = useState<ReportTab>('SUMMARY');
  // 표시할 헌금 종류(종합 보고서 전용). 기본값은 헌금 종류의 활성 여부(활성=체크, 비활성=해제)이고,
  // 사용자가 바꾼 종류만 flippedIds에 기억합니다. 다른 보고서·다른 탭으로 가거나 이 화면을 떠나면 기본값으로 돌아갑니다.
  const typeOptions = useTypeToggleOptions(f);
  const [flippedIds, setFlippedIds] = useState<string[]>([]);
  const hidden = useMemo(() => {
    const flipped = new Set(flippedIds);
    return new Set(typeOptions.filter((o) => o.isActive === flipped.has(o.id)).map((o) => o.id));
  }, [typeOptions, flippedIds]);
  const ex = useReportExport(f, hidden);
  // 보고서(기간 종류·연도·분기/월·주)가 바뀌면 항상 [종합 보고서] 탭부터 보여 줍니다.
  const reportKey = f.isWeek ? `W:${f.week.start}` : `${f.periodType}:${f.year}:${f.periodValue}`;
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
        {f.sel.isWeek ? null : (
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
        {f.sel.isWeek ? (
          <>
            <div className="w-52">
              <span className="label">주 선택 (해당 날짜가 속한 주)</span>
              <DatePicker value={f.weekDate} onChange={f.setWeekDate} ariaLabel="주별 보고서 날짜" pickOnly />
            </div>
            <button className="btn" onClick={f.prevWeek}>
              ‹ 이전 주
            </button>
            <button className="btn" onClick={f.nextWeek}>
              다음 주 ›
            </button>
            <button className="btn" onClick={f.goLastSunday}>
              지난 주일
            </button>
          </>
        ) : null}
        {/* 세대 집계 기준은 분기·연도 요약과 개인별·세대별 탭에만 쓰이므로 주별·월별 종합 보고서에서는 숨깁니다. */}
        {!(f.personKind !== null && tab === 'SUMMARY') ? (
          <div>
            <span className="label">세대 집계 기준</span>
            <div className="flex overflow-hidden rounded border border-gray-300">
              <button className={`px-3 py-1.5 text-sm ${f.basis === 'CURRENT' ? 'bg-blue-600 text-white' : 'bg-white'}`} aria-pressed={f.basis === 'CURRENT'} onClick={() => f.setBasis('CURRENT')}>
                현재 세대 기준
              </button>
              <button className={`px-3 py-1.5 text-sm ${f.basis === 'SNAPSHOT' ? 'bg-blue-600 text-white' : 'bg-white'}`} aria-pressed={f.basis === 'SNAPSHOT'} onClick={() => f.setBasis('SNAPSHOT')}>
                납부 당시 세대 기준
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex-1" />
        {/* 인쇄·엑셀·메일 저장은 종합 보고서 탭에서만 보이고 동작합니다(다른 탭은 해당 없음). */}
        {tab === 'SUMMARY' ? (
          <>
            <button className="btn-accent" onClick={ex.print} disabled={f.pending}>
              보고서 인쇄
            </button>
            <button className="btn-accent" onClick={() => void ex.saveExcel()} disabled={ex.busy || f.pending}>
              엑셀저장
            </button>
            <button className="btn-accent" onClick={() => void ex.mailSave()} disabled={ex.busy || f.pending}>
              메일 저장
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
      </nav>

      {tab === 'SUMMARY' ? (
        <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="group" aria-label="표시할 헌금 종류">
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
      ) : null}
      {tab === 'SUMMARY' ? <SummaryTab f={f} hidden={hidden} /> : null}
      {tab === 'LIST' ? <ListTab f={f} /> : null}
      {tab === 'PERSONAL' ? <PersonalTab f={f} /> : null}
      {tab === 'AUDIT' ? <AuditTab f={f} /> : null}

    </div>
  );
}
