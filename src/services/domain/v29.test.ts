import { describe, expect, it } from 'vitest';
import type { Member } from '../../contexts/types';
import { duplicateNames, nameDisambiguator } from './memberName';

const m = (id: string, name: string, extra: Partial<Member> = {}): Member =>
  ({ id, name, position: '성도', isFamilyHead: false, isActive: true, ...extra }) as Member;

describe('duplicateNames / nameDisambiguator', () => {
  const members = [m('a', '김철수', { phoneLast4: '1234', position: '집사' }), m('b', '김철수', { position: '권사' }), m('c', '이영희', { phoneLast4: '9999' })];
  const dup = duplicateNames(members);

  it('finds only names shared by two or more members', () => {
    expect([...dup]).toEqual(['김철수']);
  });
  it('uses the last 4 phone digits when present, otherwise the position', () => {
    expect(nameDisambiguator(members[0], dup)).toBe('1234');
    expect(nameDisambiguator(members[1], dup)).toBe('권사');
  });
  it('returns null for unique names and missing members', () => {
    expect(nameDisambiguator(members[2], dup)).toBeNull();
    expect(nameDisambiguator(undefined, dup)).toBeNull();
  });
  it('counts inactive members too (past donations may reference them)', () => {
    const withInactive = [m('a', '박민수'), m('b', '박민수', { isActive: false })];
    expect(duplicateNames(withInactive).has('박민수')).toBe(true);
  });
});
