import type { Donation } from '../../contexts/types';

const ANONYMOUS_PREFIX = '무명';
const ANON_RE = /^무명(\d+)$/;

/**
 * 무명/방문자 자동 표기명. 해당 날짜에 저장된 `무명N` 중 가장 큰 번호 + 1 (없으면 `무명1`).
 * 별도 카운터를 저장하지 않으므로 삭제·되돌리기·날짜 변경 시에도 저장 내역과 항상 일치합니다.
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
