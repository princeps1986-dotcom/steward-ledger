import { describe, expect, it } from 'vitest';
import type { Donation, Member, OfferingType } from '../../contexts/types';
import { memberOrderKey } from './memberName';
import { buildWeeklyMatrix } from './weekly';

const types: OfferingType[] = [{ id: 't', name: '십일조', displayArea: 'PRIMARY', quickAmounts: [], sortOrder: 1, isActive: true }];
const range = { start: '2026-11-15', end: '2026-11-21' };
const don = (memberId: string | null, name: string): Donation =>
  ({ id: `${memberId}-${name}`, date: '2026-11-15', memberId, donorDisplayName: name, offeringTypeId: 't', amount: 1000, createdAt: '' }) as Donation;
const mem = (id: string, extra: Partial<Member>): Member => ({ id, name: '김철수', position: '성도', isFamilyHead: false, isActive: true, ...extra }) as Member;

describe('memberOrderKey', () => {
  it('puts members with a phone first (ascending), then position order', () => {
    const list = [mem('c', { position: '성도' }), mem('b', { phoneLast4: '5678' }), mem('a', { phoneLast4: '1234' }), mem('d', { position: '집사' })];
    const sorted = [...list].sort((x, y) => memberOrderKey(x).localeCompare(memberOrderKey(y)));
    expect(sorted.map((m) => m.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('buildWeeklyMatrix ordering', () => {
  const byId = new Map([mem('c', { position: '성도' }), mem('b', { phoneLast4: '5678' }), mem('a', { phoneLast4: '1234' })].map((m) => [m.id, m]));
  const donations = [don('c', '김철수'), don('b', '김철수'), don('a', '김철수'), don('z', '가나다'), don(null, '무명2'), don(null, '무명10'), don(null, '무명1')];

  it('sorts members by name in Korean order and keeps anonymous rows last in numeric order', () => {
    const m = buildWeeklyMatrix(donations, types, range, (id) => (byId.has(id) ? [...byId.keys()].join('') + id : id));
    expect(m.rows.map((r) => r.name)).toEqual(['가나다', '김철수', '김철수', '김철수', '무명1', '무명2', '무명10']);
  });
  it('orders same-named members by the tie-break key', () => {
    const m = buildWeeklyMatrix(donations, types, range, (id) => memberOrderKey(byId.get(id)));
    expect(m.rows.filter((r) => r.name === '김철수').map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });
});
