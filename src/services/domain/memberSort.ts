import type { Member } from '../../contexts/types';
import { POSITIONS } from './positions';
import { compareKo } from './compare';

export type MemberSortKey = 'name' | 'position' | 'phoneLast4' | 'family' | 'state';
export type SortDir = 'asc' | 'desc';

interface SortableRow {
  member: Member;
  familyLabel: string;
}

const byKo = compareKo;

/** 직분은 목사 → 전도사 → 집사 → 권사 → 성도 순, 목록에 없는 값은 뒤로 */
const positionRank = (p: string): number => {
  const i = (POSITIONS as readonly string[]).indexOf(p);
  return i < 0 ? POSITIONS.length : i;
};

/**
 * 성도 목록 정렬 비교 함수. 값이 없는 항목(연락처 '-')은 정렬 방향과 무관하게 항상 맨 뒤에 두고,
 * 같은 값은 이름 순으로 정렬합니다.
 */
export function memberComparator(key: MemberSortKey, dir: SortDir): (a: SortableRow, b: SortableRow) => number {
  const sign = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    let r = 0;
    switch (key) {
      case 'name':
        r = byKo(a.member.name, b.member.name);
        break;
      case 'position':
        r = positionRank(a.member.position) - positionRank(b.member.position);
        break;
      case 'phoneLast4': {
        const av = a.member.phoneLast4 ?? '';
        const bv = b.member.phoneLast4 ?? '';
        if (av === '' || bv === '') return av === bv ? byKo(a.member.name, b.member.name) : av === '' ? 1 : -1;
        r = compareKo(av, bv);
        break;
      }
      case 'family': {
        const av = a.familyLabel === '-' ? '' : a.familyLabel;
        const bv = b.familyLabel === '-' ? '' : b.familyLabel;
        if (av === '' || bv === '') return av === bv ? byKo(a.member.name, b.member.name) : av === '' ? 1 : -1;
        r = byKo(av, bv);
        break;
      }
      case 'state':
        r = Number(b.member.isActive) - Number(a.member.isActive); // 활성이 먼저
        break;
    }
    return r !== 0 ? r * sign : byKo(a.member.name, b.member.name);
  };
}
