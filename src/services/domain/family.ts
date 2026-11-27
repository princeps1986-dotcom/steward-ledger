import type { Donation, Member } from '../../contexts/types';

export type FamilyBasis = 'CURRENT' | 'SNAPSHOT';

/** 합산 묶음 키. 그룹이 없는 성도는 1인 묶음(`solo:{memberId}`)으로 취급합니다. */
export function familyKeyOf(d: Donation, basis: FamilyBasis, memberById: Map<string, Member>): string | null {
  if (d.memberId === null) return null;
  if (basis === 'SNAPSHOT') return d.familyGroupIdSnapshot ?? `solo:${d.memberId}`;
  const m = memberById.get(d.memberId);
  return m?.familyGroupId ?? `solo:${d.memberId}`;
}

export function familyKeyOfMember(m: Member): string {
  return m.familyGroupId ?? `solo:${m.id}`;
}
