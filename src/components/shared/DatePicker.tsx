import { useDatePicker } from '../../hooks/useDatePicker';

interface Props {
  value: string;
  onChange(v: string): void;
  ariaLabel: string;
  /** true면 직접 입력을 막고 달력에서만 고를 수 있습니다(입력 칸을 누르면 달력이 열림). */
  pickOnly?: boolean;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** 일요일이 빨간색으로 표시되는 달력 선택기. 직접 입력(YYYY-MM-DD)도 가능합니다. */
export function DatePicker({ value, onChange, ariaLabel, pickOnly }: Props) {
  const p = useDatePicker({ value, onChange });
  return (
    <div className="relative" ref={p.rootRef} onKeyDown={p.onRootKeyDown}>
      <div className="flex gap-1">
        <input
          ref={p.inputRef}
          className={pickOnly ? 'input cursor-pointer' : 'input'}
          inputMode="numeric"
          maxLength={10}
          placeholder={pickOnly ? '달력에서 선택' : 'YYYY-MM-DD'}
          value={value}
          readOnly={pickOnly}
          onChange={(e) => p.onInputChange(e.target.value)}
          onClick={pickOnly ? p.openCalendar : undefined}
          onKeyDown={
            pickOnly
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    p.openCalendar();
                  }
                }
              : undefined
          }
          aria-label={ariaLabel}
        />
        <span
          className={`flex w-9 shrink-0 items-center justify-center text-sm font-medium ${p.weekday?.isSunday ? 'text-red-600' : 'text-gray-600'}`}
          aria-label={p.weekday ? `${p.weekday.label}요일` : undefined}
        >
          {p.weekday ? `(${p.weekday.label})` : ''}
        </span>
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
