import type { Donation, Member } from '../../contexts/types';
import { currentHeadOf } from './memberRules';

export type FamilyBasis = 'CURRENT' | 'SNAPSHOT';

/** 세대 집계 키. 그룹이 없는 성도는 1인 세대(`solo:{memberId}`)로 취급합니다. */
export function familyKeyOf(d: Donation, basis: FamilyBasis, memberById: Map<string, Member>): string | null {
  if (d.memberId === null) return null;
  if (basis === 'SNAPSHOT') return d.familyGroupIdSnapshot ?? `solo:${d.memberId}`;
  const m = memberById.get(d.memberId);
  return m?.familyGroupId ?? `solo:${d.memberId}`;
}

export function familyKeyOfMember(m: Member): string {
  return m.familyGroupId ?? `solo:${m.id}`;
}

/** 세대 표시 이름. 같은 이름의 세대가 여러 개면 식별자를 붙여 고유하게 만듭니다. */
export function buildFamilyLabels(keys: string[], members: Member[]): Map<string, string> {
  const byId = new Map(members.map((m) => [m.id, m]));
  const raw = new Map<string, string>();
  for (const k of keys) {
    let head: Member | undefined;
    if (k.startsWith('solo:')) head = byId.get(k.slice(5));
    else head = currentHeadOf(members, k);
    raw.set(k, `${head?.name ?? '(알 수 없음)'} 세대`);
  }
  const count = new Map<string, number>();
  const out = new Map<string, string>();
  for (const k of keys) {
    const label = raw.get(k)!;
    const dupes = [...raw.values()].filter((v) => v === label).length;
    if (dupes === 1) {
      out.set(k, label);
    } else {
      const n = (count.get(label) ?? 0) + 1;
      count.set(label, n);
      out.set(k, `${label} (${n})`);
    }
  }
  return out;
}

/** 세대 구성원 이름 목록 (현재 명단 기준) */
export function familyMemberNames(key: string, members: Member[]): string {
  if (key.startsWith('solo:')) return members.find((m) => m.id === key.slice(5))?.name ?? '';
  return members
    .filter((m) => m.familyGroupId === key)
    .sort((a, b) => Number(b.isFamilyHead) - Number(a.isFamilyHead))
    .map((m) => m.name)
    .join(', ');
}
