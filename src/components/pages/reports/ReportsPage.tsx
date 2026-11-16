import { useEffect, useState } from 'react';
import { useReportExport, useReportFilters, type ReportTab } from '../../../hooks/useReports';
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
  const ex = useReportExport(f);
  const [tab, setTab] = useState<ReportTab>('SUMMARY');
  // 보고서(기간 종류·연도·분기/월·주)가 바뀌면 항상 [종합 보고서] 탭부터 보여 줍니다.
  const reportKey = f.isWeek ? `W:${f.week.start}` : `${f.periodType}:${f.year}:${f.periodValue}`;
  useEffect(() => {
    setTab('SUMMARY');
  }, [reportKey]);
  // 종합 보고서는 본문(표 바로 위)에 제목·요약·출력일시가 있는 자체 인쇄 머리글을 가지므로 여기서는 나머지 탭만 처리합니다.
  const showPrintTitle = tab !== 'SUMMARY';
  return (
    <div className="space-y-4">
      <section className="card no-print flex flex-wrap items-end gap-3">
        {f.isWeek ? null : (
          <label>
            <span className="label">연도</span>
            <select className="input" value={f.year} onChange={(e) => f.setYear(e.target.value)}>
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
          <select className="input" value={f.periodType} onChange={(e) => f.setPeriodType(e.target.value as PeriodType)}>
            <option value="YEAR">연도별</option>
            <option value="QUARTER">분기별</option>
            <option value="MONTH">월별</option>
            <option value="WEEK">주별</option>
          </select>
        </label>
        {f.periodValueOptions.length ? (
          <label>
            <span className="label">&nbsp;</span>
            <select className="input" value={f.periodValue} onChange={(e) => f.setPeriodValue(Number(e.target.value))}>
              {f.periodValueOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {f.isWeek ? (
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
        <div className="flex-1" />
        <button className="btn-accent" onClick={ex.print}>
          보고서 인쇄
        </button>
        <button className="btn-accent" onClick={() => void ex.saveExcel()} disabled={ex.busy}>
          엑셀저장
        </button>
        <button className="btn-accent" onClick={() => void ex.mailSave()} disabled={ex.busy}>
          메일 저장
        </button>
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
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'SUMMARY' ? <SummaryTab f={f} /> : null}
      {tab === 'LIST' ? <ListTab f={f} /> : null}
      {tab === 'PERSONAL' ? <PersonalTab f={f} /> : null}
      {tab === 'AUDIT' ? <AuditTab f={f} /> : null}

    </div>
  );
}
