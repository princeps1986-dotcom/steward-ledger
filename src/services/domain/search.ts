import type { Member } from '../../contexts/types';
import { normalizePosition } from './positions';

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

export function toChosung(s: string): string {
  return [...s]
    .map((ch) => {
      const code = ch.charCodeAt(0) - 0xac00;
      return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : ch;
    })
    .join('');
}

const isChosungOnly = (q: string): boolean => /^[ㄱ-ㅎ]+$/.test(q);

/** 자동 완성·초성 검색. 연락처 뒷4자리로도 찾을 수 있습니다. */
export function matchMember(m: Member, query: string): boolean {
  const q = query.replace(/\s/g, '');
  if (q === '') return false;
  if (isChosungOnly(q)) return toChosung(m.name).includes(q);
  if (/^\d{2,4}$/.test(q) && m.phoneLast4?.includes(q)) return true;
  return m.name.includes(q);
}

export function searchMembers(members: Member[], query: string, limit = 20): Member[] {
  const q = query.replace(/\s/g, '');
  return members
    .filter((m) => m.isActive && matchMember(m, query))
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
