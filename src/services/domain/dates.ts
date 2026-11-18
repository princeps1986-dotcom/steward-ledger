import { format, isSunday, previousSunday, parseISO, isValid } from 'date-fns';
import { WEEKDAY_LABELS } from './calendar';

/** 가장 가까운 지난 주일. 오늘이 주일이면 오늘. */
export function lastSunday(today: Date = new Date()): string {
  const d = isSunday(today) ? today : previousSunday(today);
  return format(d, 'yyyy-MM-dd');
}

export const todayString = (): string => format(new Date(), 'yyyy-MM-dd');

export const yearOf =(date: string): string => date.slice(0, 4);
export const monthOf = (date: string): number => Number(date.slice(5, 7));

export function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(s));
}

export type PeriodType = 'YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY';

/** 기간 필터에 포함되는 월 목록 (주별은 월 단위가 아니므로 빈 목록) */
export function monthsOfPeriod(type: PeriodType, value: number): number[] {
  if (type === 'WEEK' || type === 'DAY') return [];
  if (type === 'MONTH') return [value];
  if (type === 'QUARTER') return [1, 2, 3].map((i) => (value - 1) * 3 + i);
  return Array.from({ length: 12 }, (_, i) => i + 1);
}

export function periodLabel(year: string, type: PeriodType, value: number): string {
  if (type === 'DAY') return `${year}년 일별`;
  if (type === 'WEEK') return `${year}년 주별`; // 실제 표시는 주 범위(시작~종료)를 사용
  if (type === 'MONTH') return `${year}년 ${value}월`;
  if (type === 'QUARTER') return `${year}년 ${value}분기`;
  return `${year}년 전체`;
}

/** 인쇄 출력일시: 2026-11-16 (월) 08:47 */
export const formatPrintStamp = (d: Date): string => `${format(d, 'yyyy-MM-dd')} (${WEEKDAY_LABELS[d.getDay()]}) ${format(d, 'HH:mm')}`;

export const nowStamp = (): string => format(new Date(), 'yyyyMMdd_HHmmss');
export const formatDateTime = (iso: string): string => format(parseISO(iso), 'yyyy-MM-dd HH:mm:ss');
