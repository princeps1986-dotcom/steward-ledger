import { describe, expect, it } from 'vitest';
import type { Donation, DonationDraft, Member } from '../../contexts/types';
import { formatAmountInput, parseAmount } from './amount';
import { lastSunday, monthsOfPeriod } from './dates';
import { buildDonation, makeAudit, mergeDonation, validateReason } from './donationOps';
import { familyKeyOf } from './family';
import { applyMemberSave, canDeactivate, EMPTY_MEMBER_DRAFT } from './memberRules';
import { matchMember, memberLabel } from './search';

const member = (p: Partial<Member>): Member => ({
  id: p.id ?? 'm1',
  name: p.name ?? '김철수',
  position: p.position ?? '집사',
  isFamilyHead: false,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  ...p,
});

const draft = (p: Partial<DonationDraft> = {}): DonationDraft => ({
  date: '2026-11-15',
  memberId: 'm1',
  donorDisplayName: '김철수',
  familyGroupIdSnapshot: null,
  offeringTypeId: 't1',
  amount: 10000,
  ...p,
});

describe('amount', () => {
  it('formats digits with commas and strips other characters', () => {
    expect(formatAmountInput('1234567')).toBe('1,234,567');
    expect(formatAmountInput('00-12a3')).toBe('123');
    expect(formatAmountInput('')).toBe('');
  });
  it('parses and validates', () => {
    expect(parseAmount('')).toEqual({ kind: 'empty' });
    expect(parseAmount('0')).toEqual({ kind: 'empty' });
    expect(parseAmount('10,000')).toEqual({ kind: 'ok', value: 10000 });
    expect(parseAmount('-5').kind).toBe('invalid');
    expect(parseAmount('1.5').kind).toBe('invalid');
    expect(parseAmount('abc').kind).toBe('invalid');
    expect(parseAmount('99999999999999999').kind).toBe('invalid');
  });
});

describe('dates', () => {
  it('returns today on Sunday, previous Sunday otherwise', () => {
    expect(lastSunday(new Date(2026, 10, 15))).toBe('2026-11-15'); // 일요일
    expect(lastSunday(new Date(2026, 10, 16))).toBe('2026-11-15'); // 월요일
    expect(lastSunday(new Date(2026, 0, 3))).toBe('2025-12-28'); // 연도 경계
  });
  it('months of period', () => {
    expect(monthsOfPeriod('QUARTER', 4)).toEqual([10, 11, 12]);
    expect(monthsOfPeriod('MONTH', 3)).toEqual([3]);
    expect(monthsOfPeriod('YEAR', 1)).toHaveLength(12);
  });
});

describe('search', () => {
  it('name and phone search, no initial-consonant search', () => {
    const m = member({ phoneLast4: '1234' });
    expect(matchMember(m, 'ㄱㅊ')).toBe(false);
    expect(matchMember(m, '철수')).toBe(true);
    expect(matchMember(m, '1234')).toBe(true);
    expect(matchMember(m, 'ㅇㅇ')).toBe(false);
  });
  it('label shows only the position and phone that exist, without dashes or empty parentheses', () => {
    expect(memberLabel(member({ phoneLast4: '1234' }))).toBe('김철수 (집사 / 1234)');
    expect(memberLabel(member({}))).toBe('김철수 (집사)');
    expect(memberLabel(member({ position: '', phoneLast4: '1234' }))).toBe('김철수 (1234)');
    expect(memberLabel(member({ position: '' }))).toBe('김철수');
  });
});

describe('donationOps', () => {
  const existing: Donation = buildDonation(draft({ memo: '첫 봉투' }), 'd1', '2026-11-15T00:00:00Z');
  it('merges amount and memo', () => {
    const merged = mergeDonation(existing, draft({ amount: 5000, memo: '생일' }));
    expect(merged.amount).toBe(15000);
    expect(merged.memo).toBe('첫 봉투 / 생일');
    expect(merged.id).toBe('d1');
  });
  it('requires an audit reason', () => {
    expect(() => makeAudit('DELETE', existing, null, '   ')).toThrow();
    expect(makeAudit('DELETE', existing, null, '오기입').reason).toBe('오기입');
  });
});

describe('validateReason', () => {
  it('requires 4+ Hangul syllables after trimming', () => {
    expect(validateReason('   ')).toContain('필수');
    expect(validateReason(' 오기입 ')).toContain('4글자');
    expect(validateReason('abcd 1234 오기')).toContain('4글자');
    expect(validateReason('  금액 오기입  ')).toBeNull();
  });
});

describe('memberRules', () => {
  it('new head gets own id as group; member links to head group', () => {
    const r1 = applyMemberSave([], { ...EMPTY_MEMBER_DRAFT, name: '김철수', isFamilyHead: true });
    if (!r1.ok) throw new Error(r1.error);
    expect(r1.saved.familyGroupId).toBe(r1.saved.id);
    const r2 = applyMemberSave(r1.members, { ...EMPTY_MEMBER_DRAFT, name: '이영희', headMemberId: r1.saved.id });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.saved.familyGroupId).toBe(r1.saved.id);
  });

  it('transfers head flag while keeping group id', () => {
    const head = member({ id: 'h', name: '김철수', isFamilyHead: true, familyGroupId: 'h' });
    const wife = member({ id: 'w', name: '이영희', familyGroupId: 'h' });
    const r = applyMemberSave([head, wife], { ...EMPTY_MEMBER_DRAFT, name: '이영희', isFamilyHead: true }, 'w');
    if (!r.ok) throw new Error(r.error);
    const h = r.members.find((m) => m.id === 'h')!;
    const w = r.members.find((m) => m.id === 'w')!;
    expect(w.isFamilyHead).toBe(true);
    expect(w.familyGroupId).toBe('h');
    expect(h.isFamilyHead).toBe(false);
    expect(h.familyGroupId).toBe('h');
  });

  it('blocks removing head flag or deactivating while members remain', () => {
    const head = member({ id: 'h', isFamilyHead: true, familyGroupId: 'h' });
    const wife = member({ id: 'w', name: '이영희', familyGroupId: 'h' });
    const r = applyMemberSave([head, wife], { ...EMPTY_MEMBER_DRAFT, name: '김철수', isFamilyHead: false }, 'h');
    expect(r.ok).toBe(false);
    expect(canDeactivate([head, wife], head)).not.toBeNull();
    expect(canDeactivate([head, wife], wife)).toBeNull();
  });

  it('validates draft fields', () => {
    expect(applyMemberSave([], { ...EMPTY_MEMBER_DRAFT, name: '' }).ok).toBe(false);
    expect(applyMemberSave([], { ...EMPTY_MEMBER_DRAFT, name: 'a', phoneLast4: '12' }).ok).toBe(false);
  });
});

describe('family', () => {
  const head = member({ id: 'h', isFamilyHead: true, familyGroupId: 'h' });
  const wife = member({ id: 'w', name: '이영희', familyGroupId: 'h' });
  const byId = new Map([head, wife].map((m) => [m.id, m]));
  it('current vs snapshot basis', () => {
    const d = buildDonation(draft({ memberId: 'w', familyGroupIdSnapshot: null }));
    expect(familyKeyOf(d, 'CURRENT', byId)).toBe('h');
    expect(familyKeyOf(d, 'SNAPSHOT', byId)).toBe('solo:w');
    expect(familyKeyOf({ ...d, memberId: null }, 'CURRENT', byId)).toBeNull();
  });
});
