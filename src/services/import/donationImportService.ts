import type { Donation, DonationDraft, Member, OfferingType } from '../../contexts/types';
import { isDateInRange, isValidDateString } from '../domain/dates';

/** 헌금 CSV 한 줄(긴 형식: 한 줄 = 헌금 1건). 값은 모두 문자열입니다. */
export interface DonationImportRow {
  /** 파일의 줄 번호(1행은 헤더이므로 첫 데이터는 2) */
  rowNo: number;
  date: string;
  name: string;
  phoneLast4: string;
  typeName: string;
  amountRaw: string;
  memo: string;
}

/**
 * OK: 저장 대상 · WARN: 저장되지만 확인이 필요(큰 금액, 기존 기록과 금액이 다름)
 * ERROR: 저장을 막음 · SAVED: 이미 같은 헌금이 있어 건너뜀
 */
export type DonationImportStatus = 'OK' | 'WARN' | 'ERROR' | 'SAVED';

export interface MatchedDonationRow extends DonationImportRow {
  status: DonationImportStatus;
  messages: string[];
  /** 저장할 헌금(ERROR·SAVED는 없음) */
  draft?: DonationDraft;
  /** 큰 금액 확인이 필요한 줄 */
  large: boolean;
}

const ALIASES: Record<keyof Omit<DonationImportRow, 'rowNo'>, string[]> = {
  date: ['날짜', '헌금날짜', '일자'],
  name: ['성도이름', '성도 이름', '이름', '성명'],
  phoneLast4: ['연락처뒷4자리', '연락처 뒷4자리', '연락처뒷자리', '전화뒷자리'],
  typeName: ['헌금종류', '헌금 종류', '종류'],
  amountRaw: ['금액'],
  memo: ['메모'],
};

const TEMPLATE_HEADERS = ['날짜', '성도이름', '연락처뒷4자리', '헌금종류', '금액', '메모'];

export function donationTemplateCsv(): string {
  const rows = [
    TEMPLATE_HEADERS,
    ['2026-11-22', '김철수', '1234', '십일조', '100000', ''],
    ['2026-11-22', '이영희', '', '감사헌금', '50000', '감사'],
  ];
  return '﻿' + rows.map((r) => r.join(',')).join('\r\n');
}

const pick = (rec: Record<string, string>, aliases: string[]): string => {
  for (const a of aliases) if (rec[a] !== undefined) return String(rec[a]).trim();
  return '';
};

/** 헤더 기준으로 행을 읽습니다. 날짜 열이 파일에 있는지도 알려 줍니다. */
export function normalizeDonationRows(raw: Record<string, string>[]): { rows: DonationImportRow[]; hasDateColumn: boolean } {
  const hasDateColumn = raw.length > 0 && ALIASES.date.some((a) => raw[0][a] !== undefined);
  const rows = raw.map((rec, i) => ({
    rowNo: i + 2,
    date: pick(rec, ALIASES.date).replace(/[./]/g, '-'),
    name: pick(rec, ALIASES.name),
    phoneLast4: pick(rec, ALIASES.phoneLast4).replace(/[^0-9]/g, ''),
    typeName: pick(rec, ALIASES.typeName),
    amountRaw: pick(rec, ALIASES.amountRaw).replace(/[,\s원]/g, ''),
    memo: pick(rec, ALIASES.memo),
  }));
  return { rows, hasDateColumn };
}

export interface DonationMatchContext {
  members: Member[];
  types: OfferingType[];
  /** 날짜 열이 없을 때 화면에서 고른 날짜 */
  defaultDate: string | null;
  largeAmountThreshold: number;
  /** 같은 날짜·성도·종류로 이미 저장된 헌금(줄마다, 없으면 undefined). findDuplicates 결과 */
  existing?: (Donation | undefined)[];
}

const compact = (s: string) => s.replace(/\s/g, '');

/** 줄마다 성도·종류·날짜·금액을 찾아 상태를 정합니다. 순수 함수. */
export function matchDonationRows(rows: DonationImportRow[], ctx: DonationMatchContext): MatchedDonationRow[] {
  const activeMembers = ctx.members.filter((m) => m.isActive);
  const seen = new Set<string>();

  return rows.map((r, idx) => {
    const messages: string[] = [];
    // 'as'로 좁히지 않게 합니다(아래 fail/warn 클로저가 바꾸는 값이라 TS가 'OK'로 좁혀 버림)
    let status = 'OK' as DonationImportStatus;
    const fail = (msg: string) => {
      messages.push(msg);
      status = 'ERROR';
    };
    const warn = (msg: string) => {
      messages.push(msg);
      if (status === 'OK') status = 'WARN';
    };
    const row: MatchedDonationRow = { ...r, status, messages, large: false };

    // 날짜
    const date = r.date || ctx.defaultDate || '';
    if (!date) fail('날짜가 없습니다.');
    else if (!isValidDateString(date)) fail(`날짜 형식이 올바르지 않습니다: ${date} (예: 2026-11-22)`);
    else if (!isDateInRange(date)) fail(`날짜의 연도를 확인하세요: ${date}`);

    // 성도
    let member: Member | undefined;
    if (!r.name) fail('성도이름이 없습니다.');
    else {
      const sameName = activeMembers.filter((m) => compact(m.name) === compact(r.name));
      let candidates = sameName;
      if (r.phoneLast4) candidates = sameName.filter((m) => m.phoneLast4 === r.phoneLast4);
      if (sameName.length === 0) fail(`성도 '${r.name}'이(가) 명단에 없습니다. 성도 정보에서 먼저 등록하세요.`);
      else if (candidates.length === 0) fail(`성도 '${r.name}'의 연락처 뒷4자리(${r.phoneLast4 || '없음'})가 명단과 맞지 않습니다.`);
      else if (candidates.length > 1) fail(`동명이인 '${r.name}'이(가) ${candidates.length}명 있습니다. 연락처 뒷4자리를 적어 주세요.`);
      else member = candidates[0];
    }

    // 헌금 종류
    let type: OfferingType | undefined;
    if (!r.typeName) fail('헌금종류가 없습니다.');
    else {
      type = ctx.types.find((t) => t.isActive && compact(t.name) === compact(r.typeName));
      if (!type) fail(`헌금 종류 '${r.typeName}'이(가) 없거나 꺼져 있습니다. 헌금 종류 화면에서 확인하세요.`);
    }

    // 금액
    const amount = Number(r.amountRaw);
    if (!r.amountRaw || !/^\d+$/.test(r.amountRaw) || amount <= 0) fail(`금액이 올바르지 않습니다: '${r.amountRaw}'`);

    if (status !== 'ERROR' && member && type) {
      const draft: DonationDraft = {
        date,
        memberId: member.id,
        donorDisplayName: member.name,
        familyGroupIdSnapshot: member.familyGroupId ?? null,
        offeringTypeId: type.id,
        amount,
        memo: r.memo || undefined,
      };
      // 파일 안에서 같은 줄이 두 번 나오면 실수일 수 있어 막습니다.
      const key = `${date}|${member.id}|${type.id}|${amount}`;
      if (seen.has(key)) fail('파일 안에 같은 줄이 두 번 있습니다. 한 줄을 지우세요.');
      seen.add(key);

      const found = ctx.existing?.[idx];
      if (found && found.amount === amount) {
        status = 'SAVED';
        messages.push('이미 같은 헌금이 저장되어 있어 건너뜁니다.');
      } else {
        if (found) warn(`같은 날짜·성도·종류의 기존 기록(${found.amount.toLocaleString('ko-KR')}원)이 있어 별도로 추가됩니다.`);
        if (amount > ctx.largeAmountThreshold) {
          row.large = true;
          warn(`큰 금액(${ctx.largeAmountThreshold.toLocaleString('ko-KR')}원 초과)입니다. 확인 후 저장하세요.`);
        }
      }
      row.draft = draft;
    }

    row.status = status;
    return row;
  });
}
