import { format, isSunday, previousSunday, parseISO, isValid } from 'date-fns';
import { WEEKDAY_LABELS, weekdayLabelOf } from './calendar';

/**
 * 시각 d(기본: 지금)의 서울(Asia/Seoul) 벽시계를 PC 시간대의 Date 구성요소로 담아 돌려줍니다.
 * PC 시간대와 상관없이 getFullYear/getDay 등과 date-fns format이 서울 기준 값을 내도록 앱의 모든 "지금/오늘"은 이 함수를 거칩니다.
 */
export function seoulNow(d: Date = new Date()): Date {
  const p: Record<string, number> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(d)) p[x.type] = Number(x.value);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** 가장 가까운 지난 주일. 오늘이 주일이면 오늘. */
export function lastSunday(today: Date = seoulNow()): string {
  const d = isSunday(today) ? today : previousSunday(today);
  return format(d, 'yyyy-MM-dd');
}

export const todayString = (): string => format(seoulNow(), 'yyyy-MM-dd');

export const yearOf =(date: string): string => date.slice(0, 4);
export const monthOf = (date: string): number => Number(date.slice(5, 7));

export function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(s));
}

/** 날짜의 연도가 달력에서 고를 수 있는 범위(올해 100년 전 ~ 내년)인지. 날짜 칸은 읽기 전용이지만 주 이동 단추·달력의 월 이동을 계속 누르면 범위를 벗어날 수 있어 막습니다. */
export function isDateInRange(date: string, today: Date = seoulNow()): boolean {
  const y = Number(date.slice(0, 4));
  return y >= today.getFullYear() - 100 && y <= today.getFullYear() + 1;
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

/** 날짜에 요일을 붙입니다: 2026-11-15 (일). 날짜 형식이 아니면 그대로 돌려줍니다. */
export const withWeekday = (date: string): string => {
  const w = weekdayLabelOf(date);
  return w ? `${date} (${w.label})` : date;
};

/** 인쇄 출력일시: 2026-11-16 (월) 08:47 */
export const formatPrintStamp = (d: Date): string => `${format(d, 'yyyy-MM-dd')} (${WEEKDAY_LABELS[d.getDay()]}) ${format(d, 'HH:mm')}`;

export const nowStamp = (): string => format(seoulNow(), 'yyyyMMdd_HHmmss');
export const formatDateTime = (iso: string): string => format(seoulNow(parseISO(iso)), 'yyyy-MM-dd HH:mm:ss');

/** 'YYYY-MM' 두 달 사이(양 끝 포함)의 달 목록. 형식이 틀리거나 끝이 시작보다 앞서면 오류 */
export function monthsBetween(fromYm: string, toYm: string): string[] {
  const re = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!re.test(fromYm) || !re.test(toYm)) throw new Error('달은 YYYY-MM 형식이어야 합니다.');
  if (fromYm > toYm) throw new Error('끝 달이 시작 달보다 앞설 수 없습니다.');
  const out: string[] = [];
  let [y, m] = fromYm.split('-').map(Number);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym === toYm) return out;
    if (++m > 12) [y, m] = [y + 1, 1];
  }
}
