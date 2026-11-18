import { weekdayLabelOf } from '../../services/domain/calendar';
import { withWeekday } from '../../services/domain/dates';

/** 날짜를 요일과 붙여 `2026-11-15 (일)`로 보여 줍니다(일요일은 빨간색). */
export function DateText({ date }: { date: string }) {
  return <span className={weekdayLabelOf(date)?.isSunday ? 'text-red-600' : undefined}>{withWeekday(date)}</span>;
}
