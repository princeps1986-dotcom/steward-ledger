import { useDatePicker } from '../../hooks/useDatePicker';
import { withWeekday } from '../../services/domain/dates';
import { DateText } from './DateText';

interface Props {
  value: string;
  onChange(v: string): void;
  ariaLabel: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** 일요일이 빨간색으로 표시되는 달력 선택기. 직접 입력은 할 수 없고 입력 칸을 누르면 달력이 열려 달력에서만 고릅니다. */
export function DatePicker({ value, onChange, ariaLabel }: Props) {
  const p = useDatePicker({ value, onChange });
  return (
    <div className="relative" ref={p.rootRef} onKeyDown={p.onRootKeyDown}>
      <div className="flex gap-1">
        {/* 입력 칸 글자는 투명하게 두고, 같은 자리에 요일만 빨갛게 칠한 글자를 겹쳐 보여 줍니다(읽기 전용이라 값·접근성은 입력 칸이 그대로 가짐). */}
        <div className="relative min-w-0 flex-1">
          <input
            ref={p.inputRef}
            className="input cursor-pointer text-transparent"
            placeholder="달력에서 선택"
            value={withWeekday(value)}
            readOnly
            onClick={p.openCalendar}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                p.openCalendar();
              }
            }}
            aria-label={ariaLabel}
            spellCheck={false}
          />
          {value ? (
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-[9px] flex items-center text-sm">
              <DateText date={value} />
            </span>
          ) : null}
        </div>
        <button type="button" tabIndex={-1} className="btn px-2" onClick={p.toggle} aria-label={`${ariaLabel} 달력 열기`} aria-expanded={p.open}>
          📅
        </button>
      </div>
      {p.open ? (
        <div className={p.popupClassName} role="dialog" aria-label="달력">
          <div className="mb-1 flex items-center gap-1">
            <button type="button" className="btn shrink-0 px-2 py-1" onClick={p.prevMonth} aria-label="이전 달">
              ‹
            </button>
            <select className="input min-w-0 py-1" value={p.view.year} onChange={(e) => p.setYear(Number(e.target.value))} aria-label="연도">
              {p.yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select className="input min-w-0 py-1" value={p.view.month} onChange={(e) => p.setMonth(Number(e.target.value))} aria-label="월">
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>
            <button type="button" className="btn shrink-0 px-2 py-1" onClick={p.nextMonth} aria-label="다음 달">
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {p.weekdays.map((w) => (
              <span key={w.label} className={w.className}>
                {w.label}
              </span>
            ))}
            {p.cells.flat().map((c) => (
              <button key={c.date} type="button" className={c.className} onClick={() => p.pick(c.date)} aria-label={c.date} aria-pressed={c.selected}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-end">
            <button type="button" className="btn px-2 py-1 text-xs" onClick={p.pickToday}>
              오늘
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
