import { addDays, addWeeks, endOfWeek, format, parseISO, startOfWeek } from 'date-fns';

/** 요일 머리글 (일요일 시작) */
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export interface CalendarCell {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  /** 표시 중인 달에 속하는지 */
  inMonth: boolean;
  isSunday: boolean;
}

const fmt = (d: Date): string => format(d, 'yyyy-MM-dd');

/** 달력 그리드: 일요일 시작, 항상 6주(42칸)로 높이를 고정합니다. month는 1~12. */
export function buildMonthGrid(year: number, month: number): CalendarCell[][] {
  const first = new Date(year, month - 1, 1);
  const start = startOfWeek(first, { weekStartsOn: 0 });
  const weeks: CalendarCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      row.push({ date: fmt(d), day: d.getDate(), inMonth: d.getMonth() === month - 1, isSunday: i === 0 });
    }
    weeks.push(row);
  }
  return weeks;
}

/** 월 이동 (delta개월). month는 1~12. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (((idx % 12) + 12) % 12) + 1 };
}

/** 입력 중인 날짜 문자열을 YYYY-MM-DD 형태로 정리합니다. (숫자만 남기고 하이픈 자동 삽입) */
export function formatDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export interface WeekRange {
  /** 해당 주의 일요일 */
  start: string;
  /** 해당 주의 토요일 */
  end: string;
}

/** 주 범위(일요일~토요일). date는 유효한 YYYY-MM-DD여야 합니다. */
export function weekRangeOf(date: string): WeekRange {
  const d = parseISO(date);
  return { start: fmt(startOfWeek(d, { weekStartsOn: 0 })), end: fmt(endOfWeek(d, { weekStartsOn: 0 })) };
}

/** 날짜(YYYY-MM-DD)의 요일 글자(일~토). 유효하지 않으면 null. */
export function weekdayLabelOf(date: string): { label: string; isSunday: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = parseISO(date);
  if (Number.isNaN(d.getTime())) return null;
  return { label: WEEKDAY_LABELS[d.getDay()], isSunday: d.getDay() === 0 };
}

/** n주 앞/뒤 날짜 */
export function shiftWeek(date: string, n: number): string {
  return fmt(addWeeks(parseISO(date), n));
}
