import type { Member } from '../../contexts/types';
import { normalizePosition, POSITIONS } from './positions';

/** 이름이 같은 성도가 둘 이상인(동명이인) 이름의 집합. 비활성 성도도 포함합니다(과거 내역에 나타날 수 있으므로). */
export function duplicateNames(members: readonly Member[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const m of members) {
    const n = m.name.trim();
    if (seen.has(n)) dup.add(n);
    else seen.add(n);
  }
  return dup;
}

/**
 * 동명이인을 구분하는 짧은 표기: 연락처 뒷4자리가 있으면 그것을, 없으면 직분을 씁니다. (괄호는 화면에서 붙입니다)
 * 동명이인이 아니거나 구분할 값이 없으면 null.
 */
export function nameDisambiguator(member: Member | undefined, dup: ReadonlySet<string>): string | null {
  if (!member || !dup.has(member.name.trim())) return null;
  return member.phoneLast4?.trim() || normalizePosition(member.position) || null;
}

/**
 * 같은 이름의 성도끼리 정렬하는 보조 키: 연락처 뒷4자리가 있는 사람이 먼저(숫자 오름차순),
 * 없는 사람은 뒤에서 직분 순(목사 → … → 성도), 마지막으로 id.
 */
export function memberOrderKey(member: Member | undefined): string {
  if (!member) return 'zzzzz';
  // 연락처가 없으면 5자리 '99999'로 4자리 연락처보다 뒤에 오게 합니다(로캘 비교에서도 숫자는 문자보다 앞).
  const phone = member.phoneLast4?.trim() || '99999';
  const rank = (POSITIONS as readonly string[]).indexOf(member.position);
  return `${phone}|${String(rank < 0 ? POSITIONS.length : rank).padStart(2, '0')}|${member.id}`;
}
