import { memo, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { amountToKorean, formatNumber, parseAmount } from '../../../services/domain/amount';

interface Props {
  label: string;
  value: string;
  quickAmounts: number[];
  inputRef: Ref<HTMLInputElement>;
  onChange(v: string): void;
  onQuick(n: number): void;
  onClear(): void;
  onKeyDown(e: KeyboardEvent<HTMLInputElement>): void;
  keepFocus(e: MouseEvent): void;
}

/** 입력한 금액을 한글로 읽어 보여 주는 보조 문구 (자릿수 실수 확인용) */
export function KoreanAmount({ value }: { value: string }) {
  const p = parseAmount(value);
  if (p.kind !== 'ok') return null;
  return <p className="mt-0.5 text-right text-xs font-medium text-blue-700">{amountToKorean(p.value)}</p>;
}

export const AmountRow = memo(function AmountRow({ label, value, quickAmounts, inputRef, onChange, onQuick, onClear, onKeyDown, keepFocus }: Props) {
  return (
    <div className="grid grid-cols-[140px_200px_1fr] items-start gap-2">
      <span className="pt-1.5 text-sm font-medium">{label}</span>
      <div>
        <input
          ref={inputRef}
          className="input text-right"
          inputMode="numeric"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={`${label} 금액`}
        />
        <KoreanAmount value={value} />
      </div>
      <div className="flex flex-wrap gap-1 pt-1">
        {quickAmounts.map((n) => (
          <button key={n} type="button" tabIndex={-1} className="btn-quick" onMouseDown={keepFocus} onClick={() => onQuick(n)}>
            {formatNumber(n)}
          </button>
        ))}
        {value ? (
          <button type="button" tabIndex={-1} className="btn px-2 py-1 text-xs text-red-600" onMouseDown={keepFocus} onClick={onClear} aria-label={`${label} 금액 지우기`}>
            지움
          </button>
        ) : null}
      </div>
    </div>
  );
});
