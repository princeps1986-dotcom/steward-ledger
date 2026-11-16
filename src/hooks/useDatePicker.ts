import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildMonthGrid, formatDateInput, shiftMonth, weekdayLabelOf, WEEKDAY_LABELS } from '../services/domain/calendar';
import { isValidDateString, todayString } from '../services/domain/dates';

const CELL_BASE = 'h-8 w-full rounded text-sm';
const POPUP_BASE = 'no-print mt-1 rounded-lg border border-gray-200 bg-white p-2';
/** 달력은 항상 입력 칸 아래에 겹쳐 띄웁니다(창·화면 높이를 늘리지 않고 아래 내용을 덮음). 모달 안에서는 Modal의 overflowVisible과 함께 씁니다. */
const POPUP = `${POPUP_BASE} absolute left-0 top-full z-[60] w-[17.5rem] shadow-lg`;

/** 달력 선택기 상태·이벤트 (일요일 빨간색 표시 포함). 입력 칸은 YYYY-MM-DD 직접 입력도 지원합니다. */
export function useDatePicker({ value, onChange }: { value: string; onChange(v: string): void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ year: 0, month: 1 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const today = todayString();

  const openCalendar = useCallback(() => {
    const base = isValidDateString(value) ? value : today;
    setView({ year: Number(base.slice(0, 4)), month: Number(base.slice(5, 7)) });
    setOpen(true);
  }, [value, today]);

  const toggle = useCallback(() => (open ? setOpen(false) : openCalendar()), [open, openCalendar]);

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onRootKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
        inputRef.current?.focus();
      }
    },
    [open],
  );

  const pick = useCallback(
    (date: string) => {
      onChange(date);
      setOpen(false);
      inputRef.current?.focus();
    },
    [onChange],
  );

  const onInputChange = useCallback((raw: string) => onChange(formatDateInput(raw)), [onChange]);

  const prevMonth = useCallback(() => setView((v) => shiftMonth(v.year, v.month, -1)), []);
  const nextMonth = useCallback(() => setView((v) => shiftMonth(v.year, v.month, 1)), []);
  const setYear = useCallback((year: number) => setView((v) => ({ ...v, year })), []);
  const setMonth = useCallback((month: number) => setView((v) => ({ ...v, month })), []);

  const cells = useMemo(() => {
    if (!open) return [];
    return buildMonthGrid(view.year, view.month).map((week) =>
      week.map((c) => {
        const selected = c.date === value;
        const color = selected ? 'text-white' : c.isSunday ? (c.inMonth ? 'text-red-600' : 'text-red-300') : c.inMonth ? 'text-gray-800' : 'text-gray-300';
        const bg = selected ? 'bg-blue-600 hover:bg-blue-700' : 'hover:bg-gray-100';
        const ring = c.date === today && !selected ? 'ring-1 ring-blue-400' : '';
        return { ...c, label: String(c.day), selected, className: `${CELL_BASE} ${color} ${bg} ${ring}` };
      }),
    );
  }, [open, view, value, today]);

  const yearOptions = useMemo(() => {
    if (!open) return [];
    const thisYear = new Date().getFullYear();
    const from = Math.min(thisYear - 100, view.year);
    const to = Math.max(thisYear + 1, view.year);
    return Array.from({ length: to - from + 1 }, (_, i) => to - i);
  }, [open, view.year]);

  const weekdays = WEEKDAY_LABELS.map((label, i) => ({ label, className: `h-7 w-full text-center text-xs font-medium leading-7 ${i === 0 ? 'text-red-600' : 'text-gray-500'}` }));

  const weekday = weekdayLabelOf(value);

  return {
    open,
    openCalendar,
    weekday,
    popupClassName: POPUP,
    toggle,
    rootRef,
    inputRef,
    onRootKeyDown,
    onInputChange,
    pick,
    pickToday: () => pick(today),
    view,
    prevMonth,
    nextMonth,
    setYear,
    setMonth,
    yearOptions,
    weekdays,
    cells,
  };
}

export type DatePickerController = ReturnType<typeof useDatePicker>;
