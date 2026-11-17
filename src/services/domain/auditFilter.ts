import type { AuditLog } from '../../contexts/types';
import type { WeekRange } from './calendar';
import { monthOf, yearOf } from './dates';
import { compareFixed } from './compare';

/** 보고서 기간: 주별이면 주 범위(양끝 포함), 그 외에는 연도 + 포함 월 목록 */
export interface ReportPeriod {
  isWeek: boolean;
  week: WeekRange;
  year: string;
  months: readonly number[];
}

export function isInReportPeriod(date: string | undefined, p: ReportPeriod): boolean {
  if (!date) return false;
  return p.isWeek ? date >= p.week.start && date <= p.week.end : yearOf(date) === p.year && p.months.includes(monthOf(date));
}

/**
 * 현재 보고서 기간에 해당하는 이력만 최신순으로 반환합니다.
 * 변경 전·후 내역 중 하나라도 기간에 속하면 포함합니다(날짜를 다른 기간으로 옮긴 수정은 양쪽 보고서에 보입니다).
 */
export function auditLogsForPeriod(logs: readonly AuditLog[], p: ReportPeriod): AuditLog[] {
  return logs
    .filter((l) => isInReportPeriod(l.beforeSnapshot?.date, p) || isInReportPeriod(l.afterSnapshot?.date, p))
    .sort((a, b) => compareFixed(b.timestamp, a.timestamp));
}
