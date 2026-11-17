import type { Member } from '../../contexts/types';
import { normalizePosition } from './positions';

/** 자동 완성. 연락처 뒷4자리로도 찾을 수 있습니다. */
export function matchMember(m: Member, query: string): boolean {
  const q = query.replace(/\s/g, '');
  if (q === '') return false;
  if (/^\d{2,4}$/.test(q) && m.phoneLast4?.includes(q)) return true;
  return m.name.includes(q);
}

/** includeInactive: 비활성 성도도 찾습니다(과거 내역 조회용). */
export function searchMembers(members: Member[], query: string, limit = 20, includeInactive = false): Member[] {
  const q = query.replace(/\s/g, '');
  return members
    .filter((m) => (includeInactive || m.isActive) && matchMember(m, query))
    .sort((a, b) => {
      // 이름이 쿼리로 시작하는 항목 우선
      const as = a.name.startsWith(q) ? 0 : 1;
      const bs = b.name.startsWith(q) ? 0 : 1;
      return as - bs || a.name.localeCompare(b.name, 'ko');
    })
    .slice(0, limit);
}

/** 동명이인 식별 표기: 이름 (직분 / 연락처 뒷4자리 또는 생년) */
export function memberLabel(m: Member): string {
  const ident = m.phoneLast4 || (m.birthDate ? `${m.birthDate.slice(0, 4)}년생` : '-');
  return `${m.name} (${normalizePosition(m.position) || '-'} / ${ident})`;
}
