import type { Donation, DonationDraft, Member, OfferingType } from '../../contexts/types';
import { isDateInRange, isValidDateString } from '../domain/dates';
import { LINE_KEY } from './memberImportService';

/** 헌금 CSV 한 줄(긴 형식: 한 줄 = 헌금 1건). 값은 모두 문자열입니다. */
export interface DonationImportRow {
  /** 목록에서 줄을 구별하는 번호(첫 데이터는 2) */
  rowNo: number;
  /** 화면에 보이는 원본의 줄 번호(1행은 제목). 성도 × 헌금종류 표는 한 줄이 여러 건이 되어 rowNo와 다릅니다. */
  line: number;
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

const ALIASES: Record<keyof Omit<DonationImportRow, 'rowNo' | 'line'>, string[]> = {
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

/** 쉼표·공백·'원'과 맨 앞의 원화 기호를 뗍니다. 역슬래시는 CP949 CSV에서 ₩가 바뀌는 글자입니다. */
const cleanAmount = (s: string) => s.replace(/[,\s원]/g, '').replace(/^[₩￦\\]/, '');

/** 표의 빈 칸: 비었거나 '-'·0(원화 기호나 '원' 서식 포함, 예: ₩ -, 0원). '원'·쉼표만 있는 칸은 잘못 적은 값이라 오류로 남깁니다. */
const isBlankAmount = (s: string) => /^(?:[-0]원?)?$/.test(s.replace(/\s/g, '').replace(/^[₩￦\\]/, ''));

/**
 * 표 계산 프로그램에서 복사한 글(탭 구분)을 CSV를 읽은 것과 같은 행 목록으로 바꿉니다.
 * 첫 줄에 금액 열이 있으면 양식(한 줄 = 1건) 그대로, 없으면 성도 × 헌금종류 표로 보고 금액 칸마다 한 줄을 만듭니다.
 */
export function parsePastedDonations(text: string): Record<string, string>[] {
  // 첫 칸이 빈 제목 줄은 탭으로 시작하므로, 나누기 전에 trim하지 않습니다.
  const lines = text.split(/\r?\n/);
  // 줄 번호는 제목 줄을 1행으로 셉니다(중간의 빈 줄도 번호는 차지).
  const first = lines.findIndex((l) => l.trim());
  const table = lines.flatMap((l, i) => (l.trim() ? [{ line: i - first + 1, cells: l.split('\t').map((c) => c.trim()) }] : []));
  const header = table[0]?.cells;
  const body = table.slice(1);
  if (!header || header.length < 2) throw new Error('표를 읽지 못했습니다. 표 계산 프로그램에서 제목 줄까지 선택해 복사한 뒤 붙여넣으세요.');
  const toRecord = (cells: string[]) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  if (header.some((h) => ALIASES.amountRaw.includes(h))) return body.map(({ line, cells }) => ({ ...toRecord(cells), [LINE_KEY]: String(line) }));

  // 첫 칸에 날짜(연도로 시작)를 적은 표는 그 날짜를 모든 줄에 적용하고, 첫 열을 이름으로 봅니다. 형식 검사는 줄마다 합니다.
  const cornerDate = /^\d{4}\s*[./-]/.test(header[0]) ? header[0] : null;
  const nameCol = Math.max(header.findIndex((h) => ALIASES.name.includes(h)), header[0] === '' || cornerDate ? 0 : -1);
  if (nameCol < 0) throw new Error('첫 줄은 제목 줄이어야 합니다. 첫 칸은 비우거나 "이름"으로 두고, 오른쪽에 헌금 종류 이름을 적으세요.');
  const extra = [...ALIASES.date, ...ALIASES.phoneLast4, ...ALIASES.memo];
  return body.flatMap(({ line, cells }) => {
    const rec = toRecord(cells);
    // 날짜 열이 따로 있으면 그 값이 첫 칸의 날짜보다 우선합니다.
    const common = Object.fromEntries(extra.filter((k) => k in rec).map((k) => [k, rec[k]]));
    if (cornerDate && !ALIASES.date.some((k) => k in rec)) common['날짜'] = cornerDate;
    // 제목보다 칸이 많은 줄도 버리지 않고 '헌금종류 없음' 오류로 보이게 합니다.
    return Array.from({ length: Math.max(header.length, cells.length) }, (_, i) => i).flatMap((i) => {
      const typeName = header[i] ?? '';
      const amount = cells[i] ?? '';
      if (i === nameCol || extra.includes(typeName) || isBlankAmount(amount)) return [];
      return [{ ...common, [LINE_KEY]: String(line), 성도이름: cells[nameCol] ?? '', 헌금종류: typeName, 금액: amount }];
    });
  });
}

/** 헤더 기준으로 행을 읽습니다. 날짜 열이 파일에 있는지도 알려 줍니다. */
export function normalizeDonationRows(raw: Record<string, string>[]): { rows: DonationImportRow[]; hasDateColumn: boolean } {
  const rows = raw.map((rec, i) => {
    const rawName = pick(rec, ALIASES.name);
    // 엑셀이 앞자리 0을 지운 값(0123 → 123)을 성도 명단 불러오기처럼 4자리로 되돌립니다. 빈 값은 그대로 둡니다.
    const column = pick(rec, ALIASES.phoneLast4).replace(/[^0-9]/g, '').replace(/^\d{1,3}$/, (d) => d.padStart(4, '0'));
    // 띄어쓰기 없는 "이름(1234)"만 이름과 뒷4자리로 나눕니다. 연락처 열의 값과 다르면 나누지 않아 오류로 보이게 합니다.
    const paren = /^(\S+?)[(（](\d{4})[)）]$/.exec(rawName);
    const split = paren && (!column || column === paren[2]);
    return {
      rowNo: i + 2,
      line: Number(rec[LINE_KEY]) || i + 2,
      // yyyy-mm-dd, yyyy.mm.dd, yyyy/mm/dd만 받아 yyyy-mm-dd로 바꿉니다. 그 밖의 값은 그대로 두어 형식 오류가 되게 합니다.
      date: pick(rec, ALIASES.date).replace(/^(\d{4})([-./])(\d{2})\2(\d{2})$/, '$1-$3-$4'),
      name: split ? paren[1] : rawName,
      phoneLast4: split ? paren[2] : column,
      typeName: pick(rec, ALIASES.typeName),
      amountRaw: cleanAmount(pick(rec, ALIASES.amountRaw)),
      memo: pick(rec, ALIASES.memo),
    };
  });
  // 날짜 열이 있어도 모두 비어 있으면 날짜가 없는 것으로 보고 화면에서 고르게 합니다.
  return { rows, hasDateColumn: rows.some((r) => r.date) };
}

export interface DonationMatchContext {
  members: Member[];
  types: OfferingType[];
  /** 날짜 열이 없을 때 화면에서 고른 날짜 */
  defaultDate: string | null;
  largeAmountThreshold: number;
  /** 같은 날짜·성도·종류로 이미 저장된 헌금(줄마다, 없으면 undefined). 금액까지 같은 기록을 먼저 짝지어 줌(useDonationImport의 classify) */
  existing?: (Donation | undefined)[];
}

const compact = (s: string) => s.replace(/\s/g, '');
/** 한 줄 금액 상한(1조 원). 이보다 큰 값은 입력 실수로 보고 막습니다. */
const MAX_AMOUNT = 1_000_000_000_000;

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
    else if (!isValidDateString(date)) fail(`날짜 형식이 올바르지 않습니다: ${date} (2026-11-22, 2026.11.22, 2026/11/22 중 하나로 적으세요)`);
    else if (!isDateInRange(date)) fail(`날짜의 연도를 확인하세요: ${date}`);

    // 성도
    let member: Member | undefined;
    if (!r.name) fail('성도이름이 없습니다.');
    else {
      const sameName = activeMembers.filter((m) => compact(m.name) === compact(r.name));
      let candidates = sameName;
      if (r.phoneLast4) candidates = sameName.filter((m) => m.phoneLast4 === r.phoneLast4);
      const inactiveSame = ctx.members.some((m) => !m.isActive && compact(m.name) === compact(r.name));
      if (sameName.length === 0 && inactiveSame) fail(`성도 '${r.name}'은(는) 비활성 상태입니다. 성도 정보에서 다시 활성화한 뒤 불러오세요.`);
      else if (sameName.length === 0 && /[(（]\s*\d+\s*[)）]/.test(r.name))
        fail(`성도 '${r.name}'을(를) 읽을 수 없습니다. 홍길동(1234)처럼 띄어쓰기 없이 적고, 연락처 열이 있으면 같은 번호인지 확인하세요.`);
      else if (sameName.length === 0) fail(`성도 '${r.name}'이(가) 명단에 없습니다. 성도 정보에서 먼저 등록하세요.`);
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
    else if (!Number.isSafeInteger(amount) || amount > MAX_AMOUNT) fail(`금액이 너무 큽니다: '${r.amountRaw}'`);

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
      const repeated = seen.has(key);
      seen.add(key);

      const found = ctx.existing?.[idx];
      // 반복된 줄은 저장된 기록이 있어도 '이미 저장'으로 덮지 않고 오류로 남깁니다.
      if (repeated) fail('파일 안에 같은 줄이 두 번 있습니다. 한 줄을 지우세요.');
      else if (found && found.amount === amount) {
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

/**
 * 한 파일은 한 날짜만 담습니다. 한 번의 저장이 한 날짜 달에만 기록되므로, 날짜가 섞이면 저장을 막고 이유를 알려 줍니다.
 * (저장이 한 번에 원자적으로 끝나야 실패해도 반쯤 저장되지 않고, [복구하기]가 파일 전체를 되돌릴 수 있습니다.)
 */
export function fileDateError(matched: MatchedDonationRow[]): string | null {
  const dates = [...new Set(matched.flatMap((r) => (r.draft ? [r.draft.date] : [])))].sort();
  if (dates.length <= 1) return null;
  return `파일에 날짜가 ${dates.length}개(${dates.slice(0, 3).join(', ')}${dates.length > 3 ? ' …' : ''}) 있습니다. 한 파일에는 한 날짜만 넣어 주세요. 날짜별로 파일을 나눠 불러오세요.`;
}

/** 저장 묶음의 이름표: 한 사람이면 이름, 여러 명이면 "첫 이름 외 N명". */
export function batchLabel(drafts: DonationDraft[], members: Member[]): string {
  const ids = [...new Set(drafts.map((d) => d.memberId))];
  const first = members.find((m) => m.id === ids[0]);
  const name = first?.name ?? drafts[0]?.donorDisplayName ?? '';
  return ids.length > 1 ? `${name} 외 ${ids.length - 1}명` : name;
}
