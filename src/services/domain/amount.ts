type AmountParse =
  | { kind: 'empty' }
  | { kind: 'ok'; value: number }
  | { kind: 'invalid'; reason: string };

const MAX_DIGITS = 15; // Number.MAX_SAFE_INTEGER 이하 보장

/** 입력 중인 문자열에서 숫자만 남기고 천 단위 쉼표로 다시 표기합니다. 소수점 뒤는 버립니다('15,000.00'을 붙여넣어도 100배가 되지 않게). */
export function formatAmountInput(raw: string): string {
  const digits = raw.split('.')[0].replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS);
  if (digits === '') return '';
  return Number(digits).toLocaleString('ko-KR');
}

/** 쉼표가 포함될 수 있는 금액 문자열을 검증합니다. 빈 값과 0은 'empty'(저장하지 않음)입니다. */
export function parseAmount(raw: string): AmountParse {
  const trimmed = raw.replace(/,/g, '').trim();
  if (trimmed === '') return { kind: 'empty' };
  if (/^-/.test(trimmed)) return { kind: 'invalid', reason: '음수는 입력할 수 없습니다.' };
  if (/[.]/.test(trimmed)) return { kind: 'invalid', reason: '소수는 입력할 수 없습니다.' };
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid', reason: '숫자만 입력할 수 있습니다.' };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { kind: 'invalid', reason: '금액이 너무 큽니다.' };
  if (value === 0) return { kind: 'empty' };
  return { kind: 'ok', value };
}

/**
 * 금액 단추 누적: 현재 입력값에 단추 금액을 더한 표기를 반환합니다. (예: "100,000" + 100000 → "200,000")
 * 비었거나 올바르지 않은 입력은 0으로 보고, 표현 가능한 범위를 넘으면 현재 값을 그대로 둡니다.
 */
export function addQuickAmount(current: string, add: number): string {
  const p = parseAmount(current);
  const sum = (p.kind === 'ok' ? p.value : 0) + add;
  if (!Number.isSafeInteger(sum) || String(sum).length > MAX_DIGITS) return current;
  return formatAmountInput(String(sum));
}

const DIGIT_WORDS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL_UNITS = ['', '십', '백', '천'];
const BIG_UNITS = ['', '만', '억', '조'];

/** 4자리 묶음(0~9999)을 한글로 읽습니다. 십·백·천 앞의 '일'은 생략합니다. (예: 1250 → 천이백오십) */
function readGroup(n: number): string {
  let out = '';
  for (let pos = 3; pos >= 0; pos--) {
    const digit = Math.floor(n / 10 ** pos) % 10;
    if (digit === 0) continue;
    out += (digit === 1 && pos > 0 ? '' : DIGIT_WORDS[digit]) + SMALL_UNITS[pos];
  }
  return out;
}

/**
 * 금액을 한글로 읽어 줍니다. 0을 하나 더 친 입력 실수를 눈으로 잡기 위한 표시용입니다.
 * (예: 100000 → "십만 원", 1250000 → "백이십오만 원", 100000000 → "일억 원")
 */
export function amountToKorean(n: number): string {
  if (!Number.isSafeInteger(n) || n <= 0) return '';
  const parts: string[] = [];
  let rest = n;
  for (let i = 0; rest > 0 && i < BIG_UNITS.length; i++, rest = Math.floor(rest / 10000)) {
    const group = rest % 10000;
    if (group === 0) continue;
    // '만' 단독(1만)은 "만"으로, '억'·'조' 단독은 "일억"처럼 읽습니다.
    const text = i === 1 && group === 1 ? '' : readGroup(group) || '일';
    parts.unshift(text + BIG_UNITS[i]);
  }
  return `${parts.join(' ')} 원`;
}

export const formatWon =(n: number): string => `${n.toLocaleString('ko-KR')}원`;
export const formatNumber = (n: number): string => n.toLocaleString('ko-KR');
