import type { Donation } from '../../contexts/types';

const ANONYMOUS_PREFIX = '무명';
const ANON_RE = /^무명(\d+)$/;

/**
 * 무명/방문자 자동 표기명. 해당 날짜에 저장된 `무명N` 중 가장 큰 번호 + 1 (없으면 `무명1`).
 * 별도 카운터를 저장하지 않으므로 삭제·복구하기·날짜 변경 시에도 저장 내역과 항상 일치합니다.
 */
export function nextAnonymousName(donations: readonly Donation[], date: string): string {
  let max = 0;
  for (const d of donations) {
    if (d.date !== date || d.memberId !== null) continue;
    const m = ANON_RE.exec(d.donorDisplayName);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${ANONYMOUS_PREFIX}${max + 1}`;
}

/**
 * 저장 직전 확인: 자동 번호(`무명N`)가 그날 이미 있는 무명 내역과 겹치면 다음 번호를, 아니면 그대로 돌려줍니다.
 * 화면의 자동 번호는 메모리에 올라온 달로만 정하므로, 그 달을 읽는 중이거나 읽기에 실패했을 때 번호가 겹치는 것을 막습니다.
 */
export function uniqueAnonymousName(dayRows: readonly Donation[], date: string, name: string): string {
  if (!ANON_RE.test(name)) return name;
  const taken = dayRows.some((d) => d.date === date && d.memberId === null && d.donorDisplayName === name);
  return taken ? nextAnonymousName(dayRows, date) : name;
}
