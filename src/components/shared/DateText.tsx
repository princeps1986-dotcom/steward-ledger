import { weekdayLabelOf } from '../../services/domain/calendar';

/** 날짜를 요일과 붙여 `2026-11-15 (일)`로 보여 줍니다(일요일이면 요일만 빨간색, plain이면 항상 기본색). */
export function DateText({ date, plain = false }: { date: string; plain?: boolean }) {
  const w = weekdayLabelOf(date);
  if (!w) return <span>{date}</span>;
  return (
    <span>
      {date} <span className={w.isSunday && !plain ? 'text-red-600' : undefined}>({w.label})</span>
    </span>
  );
}
