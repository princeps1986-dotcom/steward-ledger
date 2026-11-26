import { describe, expect, it } from 'vitest';
import type { Donation, Member, OfferingType } from '../../contexts/types';
import { batchLabel, fileDateError, matchDonationRows, normalizeDonationRows, parsePastedDonations } from './donationImportService';

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

  it('엑셀이 지운 연락처 앞자리 0을 되돌려 동명이인을 찾는다', () => {
    const withZero = [...members, member({ id: 'm5', name: '홍길동', phoneLast4: '0123' })];
    const [r] = matchDonationRows(csv([row({ 성도이름: '홍길동', 연락처뒷4자리: '123' })]).rows, { ...base, members: withZero });
    expect(r.draft?.memberId).toBe('m5');
    expect(csv([row({ 연락처뒷4자리: '' })]).rows[0].phoneLast4).toBe('');
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

describe('붙여넣은 표 읽기', () => {
  it('성도 × 헌금종류 표는 금액 칸마다 한 줄이 되고 빈 칸은 건너뛴다', () => {
    const { rows, hasDateColumn } = csv(parsePastedDonations('\t십일조\t감사헌금\t구제헌금\r\n돌고래\t1,000\t2000\t\r\n홍길동\t\t-\t3000\r\n'));
    expect(hasDateColumn).toBe(false);
    expect(rows.map((r) => [r.name, r.typeName, r.amountRaw])).toEqual([
      ['돌고래', '십일조', '1000'],
      ['돌고래', '감사헌금', '2000'],
      ['홍길동', '구제헌금', '3000'],
    ]);
  });

  it('연락처·날짜 열은 헌금 종류로 보지 않고 각 줄에 붙인다', () => {
    const { rows, hasDateColumn } = csv(parsePastedDonations('날짜\t이름\t연락처뒷4자리\t십일조\r\n2026-11-22\t홍길동\t1111\t500'));
    expect(hasDateColumn).toBe(true);
    expect(rows).toMatchObject([{ date: '2026-11-22', name: '홍길동', phoneLast4: '1111', typeName: '십일조', amountRaw: '500' }]);
  });

  it('양식(한 줄 = 1건) 표는 CSV처럼 그대로 읽는다', () => {
    const [r] = csv(parsePastedDonations('성도이름\t헌금종류\t금액\r\n김철수\t십일조\t1000')).rows;
    expect(r).toMatchObject({ name: '김철수', typeName: '십일조', amountRaw: '1000' });
  });

  it('이름(뒷4자리)는 나눠 읽고, 열의 값과 다르면 나누지 않는다', () => {
    const rows = csv([
      row({ 성도이름: '홍길동(1111)', 연락처뒷4자리: '' }),
      row({ 성도이름: '홍길동（0123）', 연락처뒷4자리: '123' }),
      row({ 성도이름: '홍길동(1111)', 연락처뒷4자리: '2222' }),
      row({ 성도이름: '김철수(청년)', 연락처뒷4자리: '' }),
      row({ 성도이름: '홍길동 (1111)', 연락처뒷4자리: '' }),
      row({ 성도이름: '홍길동( 1111)', 연락처뒷4자리: '' }),
    ]).rows;
    expect(rows.map((r) => [r.name, r.phoneLast4])).toEqual([
      ['홍길동', '1111'],
      ['홍길동', '0123'],
      ['홍길동(1111)', '2222'],
      ['김철수(청년)', ''],
      ['홍길동 (1111)', ''],
      ['홍길동( 1111)', ''],
    ]);
  });

  it('첫 칸의 날짜는 모든 줄에 적용하고, 날짜 열이 있으면 열이 우선한다', () => {
    const { rows, hasDateColumn } = csv(parsePastedDonations('2026.11.22\t십일조\t감사헌금\r\n강민수\t1000\t2000\r\n강요한(7285)\t\t4000'));
    expect(hasDateColumn).toBe(true);
    expect(rows.map((r) => [r.date, r.name, r.phoneLast4, r.amountRaw])).toEqual([
      ['2026-11-22', '강민수', '', '1000'],
      ['2026-11-22', '강민수', '', '2000'],
      ['2026-11-22', '강요한', '7285', '4000'],
    ]);
    expect(csv(parsePastedDonations('2026-11-22\t일자\t십일조\n강민수\t2026-11-15\t1')).rows[0].date).toBe('2026-11-15');
  });

  it('날짜는 yyyy-mm-dd, yyyy.mm.dd, yyyy/mm/dd만 받는다', () => {
    for (const 날짜 of ['2026-11-22', '2026.11.22', '2026/11/22']) {
      const [r] = matchDonationRows(csv([row({ 날짜 })]).rows, base);
      expect(r.draft?.date).toBe('2026-11-22');
    }
    for (const 날짜 of ['2026-1-4', '2026. 11. 22.', '2026-11.22', '20261122', '11/22/2026']) {
      const [r] = matchDonationRows(csv([row({ 날짜 })]).rows, base);
      expect(r.status).toBe('ERROR');
    }
    const [corner] = matchDonationRows(csv(parsePastedDonations('2026.1.4\t십일조\n김철수\t1')).rows, base);
    expect(corner.messages.join()).toContain('날짜 형식');
  });

  it('날짜 열이 모두 비어 있으면 날짜가 없는 것으로 본다', () => {
    expect(csv([row({ 날짜: '' })]).hasDateColumn).toBe(false);
  });

  it('제목 줄이 없거나 표가 아니면 오류', () => {
    expect(() => parsePastedDonations('돌고래\t1000')).toThrow('제목 줄');
    expect(() => parsePastedDonations('안녕')).toThrow('표를 읽지 못했습니다');
  });
});

