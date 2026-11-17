import { describe, expect, it } from 'vitest';
import type { Member } from '../../contexts/types';
import { weekdayLabelOf } from './calendar';
import { memberComparator } from './memberSort';

const m = (name: string, position: string, extra: Partial<Member> = {}): { member: Member; familyLabel: string } => ({
  member: { id: name, name, position, isFamilyHead: false, isActive: true, ...extra } as Member,
  familyLabel: '-',
});

describe('weekdayLabelOf', () => {
  it('returns the weekday and flags Sundays', () => {
    expect(weekdayLabelOf('2026-11-15')).toEqual({ label: '일', isSunday: true });
    expect(weekdayLabelOf('2026-11-18')).toEqual({ label: '수', isSunday: false });
  });
  it('returns null for incomplete or invalid dates', () => {
    expect(weekdayLabelOf('2026-11-1')).toBeNull();
    expect(weekdayLabelOf('2026-13-40')).toBeNull();
    expect(weekdayLabelOf('')).toBeNull();
  });
});

describe('memberComparator', () => {
  const names = (rows: ReturnType<typeof m>[]) => rows.map((r) => r.member.name);
  it('sorts by name in Korean order, both directions', () => {
    const rows = [m('최', '성도'), m('가', '성도'), m('나', '성도')];
    expect(names([...rows].sort(memberComparator('name', 'asc')))).toEqual(['가', '나', '최']);
    expect(names([...rows].sort(memberComparator('name', 'desc')))).toEqual(['최', '나', '가']);
  });
  it('sorts positions by church rank, then name', () => {
    const rows = [m('다', '성도'), m('가', '목사'), m('나', '집사'), m('라', '장로'), m('마', '목사')];
    expect(names([...rows].sort(memberComparator('position', 'asc')))).toEqual(['가', '마', '나', '다', '라']);
  });
  it('keeps empty values last regardless of direction', () => {
    const rows = [m('가', '성도'), m('나', '성도', { phoneLast4: '2222' }), m('다', '성도', { phoneLast4: '1111' })];
    expect(names([...rows].sort(memberComparator('phoneLast4', 'asc')))).toEqual(['다', '나', '가']);
    expect(names([...rows].sort(memberComparator('phoneLast4', 'desc')))).toEqual(['나', '다', '가']);
  });
  it('puts active members first when sorting by state ascending', () => {
    const rows = [m('가', '성도', { isActive: false }), m('나', '성도')];
    expect(names([...rows].sort(memberComparator('state', 'asc')))).toEqual(['나', '가']);
  });
});
