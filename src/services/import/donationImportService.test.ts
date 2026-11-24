import { describe, expect, it } from 'vitest';
import type { Donation, Member, OfferingType } from '../../contexts/types';
import { batchLabel, fileDateError, matchDonationRows, normalizeDonationRows } from './donationImportService';

const member = (over: Partial<Member>) => ({ id: 'm1', name: '김철수', isActive: true, phoneLast4: '1234', familyGroupId: 'g1', ...over }) as Member;
const type = (name: string, over: Partial<OfferingType> = {}) =>
  ({ id: `t-${name}`, name, isActive: true, displayArea: 'PRIMARY', quickAmounts: [], sortOrder: 0, ...over }) as OfferingType;

const members = [member({}), member({ id: 'm2', name: '이영희', phoneLast4: '5678' }), member({ id: 'm3', name: '홍길동', phoneLast4: '1111' }), member({ id: 'm4', name: '홍길동', phoneLast4: '2222' })];
const types = [type('십일조'), type('감사헌금'), type('구제헌금', { isActive: false })];
const base = { members, types, defaultDate: null, largeAmountThreshold: 10_000_000 };

const csv = (rows: Record<string, string>[]) => normalizeDonationRows(rows);
const row = (over: Record<string, string>) => ({ 날짜: '2026-11-22', 성도이름: '김철수', 연락처뒷4자리: '1234', 헌금종류: '십일조', 금액: '1000', 메모: '', ...over });

describe('헌금 CSV 불러오기 판정', () => {
  it('정상 줄은 저장 대상이 되고 금액의 쉼표·원을 뗀다', () => {
    const { rows, hasDateColumn } = csv([row({ 금액: '1,000원' })]);
    expect(hasDateColumn).toBe(true);
    const [r] = matchDonationRows(rows, base);
    expect(r.status).toBe('OK');
    expect(r.draft).toMatchObject({ date: '2026-11-22', memberId: 'm1', offeringTypeId: 't-십일조', amount: 1000, familyGroupIdSnapshot: 'g1' });
  });

  it('성도가 명단에 없으면 오류이고 행 번호와 이유를 알려 준다', () => {
    const [r] = matchDonationRows(csv([row({ 성도이름: '김길동' })]).rows, base);
    expect(r.status).toBe('ERROR');
    expect(r.draft).toBeUndefined();
    expect(r.messages[0]).toContain("'김길동'");
    expect(r.rowNo).toBe(2);
  });

  it('헌금 종류가 없거나 꺼져 있으면 오류', () => {
    const [none, off] = matchDonationRows(csv([row({ 헌금종류: '감사' }), row({ 헌금종류: '구제헌금' })]).rows, base);
    expect(none.status).toBe('ERROR');
    expect(off.status).toBe('ERROR');
  });

  it('동명이인은 연락처 뒷4자리가 없으면 오류, 있으면 그 사람으로 정해진다', () => {
    const [noPhone, withPhone] = matchDonationRows(
      csv([row({ 성도이름: '홍길동', 연락처뒷4자리: '' }), row({ 성도이름: '홍길동', 연락처뒷4자리: '2222' })]).rows,
      base,
    );
    expect(noPhone.status).toBe('ERROR');
    expect(withPhone.draft?.memberId).toBe('m4');
  });

  it('금액 상한을 넘으면 오류', () => {
    const [r] = matchDonationRows(csv([row({ 금액: '99999999999999999999' })]).rows, base);
    expect(r.status).toBe('ERROR');
  });

  it('금액이 0이거나 숫자가 아니면 오류, 날짜가 없고 기본 날짜도 없으면 오류', () => {
    const rs = matchDonationRows(csv([row({ 금액: '0' }), row({ 금액: 'abc' }), row({ 날짜: '' })]).rows, base);
    expect(rs.map((r) => r.status)).toEqual(['ERROR', 'ERROR', 'ERROR']);
  });

  it('날짜 열이 없으면 고른 날짜를 쓴다', () => {
    const { rows, hasDateColumn } = csv([{ 성도이름: '김철수', 헌금종류: '십일조', 금액: '500' }]);
    expect(hasDateColumn).toBe(false);
    const [r] = matchDonationRows(rows, { ...base, defaultDate: '2026-11-15' });
    expect(r.draft?.date).toBe('2026-11-15');
  });

  it('이미 같은 헌금이 있으면 건너뜀, 금액이 다르면 확인(별도 추가)', () => {
    const existing = [{ amount: 1000 } as Donation, { amount: 2000 } as Donation];
    const rs = matchDonationRows(
      csv([row({ 금액: '1000' }), row({ 헌금종류: '감사헌금', 금액: '1000' })]).rows,
      { ...base, existing: [existing[0], existing[1]] },
    );
    expect(rs[0].status).toBe('SAVED');
    expect(rs[1].status).toBe('WARN');
    expect(rs[1].draft).toBeDefined();
  });

  it('큰 금액은 확인 표시(WARN)로 남긴다', () => {
    const [r] = matchDonationRows(csv([row({ 금액: '10000001' })]).rows, base);
    expect(r.status).toBe('WARN');
    expect(r.large).toBe(true);
  });

  it('파일 안에 같은 줄이 두 번 있으면 두 번째 줄은 오류', () => {
    const rs = matchDonationRows(csv([row({}), row({})]).rows, base);
    expect(rs.map((r) => r.status)).toEqual(['OK', 'ERROR']);
  });
});

describe('파일 단위 규칙', () => {
  it('날짜가 두 개 이상이면 저장을 막는 이유를 돌려준다', () => {
    const rs = matchDonationRows(csv([row({ 날짜: '2026-11-22' }), row({ 날짜: '2026-11-29' })]).rows, base);
    expect(fileDateError(rs)).toContain('한 날짜');
  });

  it('날짜가 하나면 통과한다', () => {
    const rs = matchDonationRows(csv([row({}), row({ 헌금종류: '감사헌금' })]).rows, base);
    expect(fileDateError(rs)).toBeNull();
  });

  it('여러 명이면 묶음 이름은 "첫 이름 외 N명"', () => {
    const rs = matchDonationRows(csv([row({}), row({ 성도이름: '이영희', 연락처뒷4자리: '5678' })]).rows, base);
    const drafts = rs.flatMap((r) => (r.draft ? [r.draft] : []));
    expect(batchLabel(drafts, members)).toBe('김철수 외 1명');
    expect(batchLabel([drafts[0]], members)).toBe('김철수');
  });

  it('비활성 성도는 비활성 안내를 준다', () => {
    const rs = matchDonationRows(csv([row({ 성도이름: '박비활' })]).rows, { ...base, members: [...members, member({ id: 'm9', name: '박비활', isActive: false })] });
    expect(rs[0].messages[0]).toContain('비활성');
  });
});
