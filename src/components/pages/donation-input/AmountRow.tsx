import { memo, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { amountToKorean, formatNumber, parseAmount } from '../../../services/domain/amount';

/** 함수 props는 모두 고정 참조(typeId를 받아 호출)라서 값이 바뀐 행만 다시 렌더됩니다. */
interface Props {
  typeId: string;
  label: string;
  value: string;
  quickAmounts: number[];
  bindField(id: string): Ref<HTMLInputElement>;
  onFieldKeyDown(id: string): (e: KeyboardEvent<HTMLInputElement>) => void;
  onAmountChange(typeId: string, v: string): void;
  onQuickAmount(typeId: string, n: number): void;
  onClearAmount(typeId: string): void;
  keepFocus(e: MouseEvent): void;
}

/** 입력한 금액을 한글로 읽어 보여 주는 보조 문구 (자릿수 실수 확인용) */
export function KoreanAmount({ value }: { value: string }) {
  const p = parseAmount(value);
  if (p.kind !== 'ok') return null;
  return <p className="mt-0.5 text-right text-xs font-medium text-blue-700">{amountToKorean(p.value)}</p>;
}

export const AmountRow = memo(function AmountRow({ typeId, label, value, quickAmounts, bindField, onFieldKeyDown, onAmountChange, onQuickAmount, onClearAmount, keepFocus }: Props) {
  return (
    <div className="grid grid-cols-[140px_140px_1fr] items-start gap-x-5 gap-y-2">
      <span className="pt-1.5 text-sm font-medium">{label}</span>
      <div>
        <input
          ref={bindField(typeId)}
          className="input text-right"
          inputMode="numeric"
          placeholder="0"
          value={value}
          onChange={(e) => onAmountChange(typeId, e.target.value)}
          onKeyDown={onFieldKeyDown(typeId)}
          aria-label={`${label} 금액`}
        />
        <KoreanAmount value={value} />
      </div>
      <div className="flex flex-wrap gap-1 pt-1">
        {quickAmounts.map((n) => (
          <button key={n} type="button" tabIndex={-1} className="btn-quick" onMouseDown={keepFocus} onClick={() => onQuickAmount(typeId, n)}>
            {formatNumber(n)}
          </button>
        ))}
        {value ? (
          <button type="button" tabIndex={-1} className="btn px-2 py-1 text-xs text-red-600" onMouseDown={keepFocus} onClick={() => onClearAmount(typeId)}aria-label={`${label} 금액 지우기`}>
            지움
          </button>
        ) : null}
      </div>
    </div>
  );
});
