import { weekdayLabelOf } from '../../services/domain/calendar';

/** 날짜를 요일과 붙여 `2026-11-15 (일)`로 보여 줍니다(일요일이면 요일만 빨간색). */
export function DateText({ date }: { date: string }) {
  const w = weekdayLabelOf(date);
  if (!w) return <span>{date}</span>;
  return (
    <span>
      {date} <span className={w.isSunday ? 'text-red-600' : undefined}>({w.label})</span>
    </span>
  );
}
