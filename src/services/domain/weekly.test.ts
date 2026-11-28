import { describe, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { buildWeeklyMatrix, withoutInactiveMembers } from './weekly';

const d = (id: string, memberId: string | null, amount: number): Donation =>
  ({ id, memberId, date: '2026-11-22', donorDisplayName: memberId ?? '무명1', offeringTypeId: 't', amount, createdAt: id, updatedAt: id }) as Donation;

describe('withoutInactiveMembers', () => {
  const donations = [d('1', 'a', 1000), d('2', 'b', 2000), d('3', null, 500)];
  const members = [
    { id: 'a', isActive: true },
    { id: 'b', isActive: false },
  ];

  it('removes only inactive members\' donations and keeps anonymous ones, so rows and totals shrink', () => {
    const kept = withoutInactiveMembers(donations, members);
    expect(kept.map((x) => x.id)).toEqual(['1', '3']);
    const m = buildWeeklyMatrix(kept, [{ id: 't', name: '십일조', displayArea: 'MAIN', quickAmounts: [], sortOrder: 1, isActive: true }] as never, { start: '2026-11-22', end: '2026-11-28' });
    expect(m.rows).toHaveLength(2);
    expect(m.total).toBe(1500);
  });

  it('이름을 바꾼 성도는 지금 이름으로, 무명은 그대로 보인다', () => {
    const types = [{ id: 't', name: '십일조', displayArea: 'MAIN', quickAmounts: [], sortOrder: 1, isActive: true }] as never;
    const m = buildWeeklyMatrix(donations, types, { start: '2026-11-22', end: '2026-11-28' }, undefined, (id) => (id === 'a' ? '새이름' : undefined));
    expect(m.rows.map((r) => r.name)).toEqual(['새이름', 'b', '무명1 (일)']);
  });

  it('returns the same list when every member is active', () => {
    expect(withoutInactiveMembers(donations, [{ id: 'a', isActive: true }, { id: 'b', isActive: true }])).toBe(donations);
  });
});
