import { describe, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { filterByDonor, sortForList } from './donationList';

const d = (id: string, date: string, name: string, createdAt: string): Donation =>
  ({ id, date, donorDisplayName: name, memberId: null, offeringTypeId: 't', amount: 1000, createdAt }) as Donation;

const list = [d('a', '2026-11-15', '김철수', '2026-11-15T01:00'), d('b', '2026-11-15', '무명', '2026-11-15T03:00'), d('c', '2026-11-08', '무명1', '2026-11-08T02:00'), d('e', '2026-11-15', '무명', '2026-11-15T02:00')];

describe('sortForList', () => {
  it('newest date first, then most recently entered first', () => {
    expect(sortForList(list).map((x) => x.id)).toEqual(['b', 'e', 'a', 'c']);
  });
  it('does not mutate the input', () => {
    const copy = [...list];
    sortForList(list);
    expect(list).toEqual(copy);
  });
});

describe('filterByDonor', () => {
  it('returns everything for an empty query and keeps anonymous rows', () => {
    expect(filterByDonor(list, '  ')).toHaveLength(4);
  });
  it('matches by name substring, including 무명 variants', () => {
    expect(filterByDonor(list, '무명').map((x) => x.id)).toEqual(['b', 'c', 'e']);
    expect(filterByDonor(list, '철').map((x) => x.id)).toEqual(['a']);
  });
  it('ignores spaces in both the query and the name', () => {
    const spaced = [d('s', '2026-11-15', '김 철수', '2026-11-15T01:00'), d('j', '2026-11-15', 'John Smith', '2026-11-15T02:00')];
    expect(filterByDonor(spaced, '김철수').map((x) => x.id)).toEqual(['s']);
    expect(filterByDonor(spaced, 'John Smith').map((x) => x.id)).toEqual(['j']);
  });
  it('does not match by initial consonants', () => {
    expect(filterByDonor(list, 'ㄱㅊㅅ')).toEqual([]);
  });
});
