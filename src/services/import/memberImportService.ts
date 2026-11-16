import type { Member } from '../../contexts/types';
import { isValidDateString } from '../domain/dates';
import { nowIso } from '../domain/ids';
import { applyMemberSave, EMPTY_MEMBER_DRAFT } from '../domain/memberRules';
import { normalizePosition } from '../domain/positions';

export interface ImportRow {
  rowNo: number;
  name: string;
  position: string;
  birthDate: string;
  phoneLast4: string;
  isHead: boolean;
  headName: string;
}

export type ImportStatus = 'OK' | 'WARN' | 'ERROR' | 'DUPLICATE';

export interface PreviewRow extends ImportRow {
  status: ImportStatus;
  messages: string[];
  duplicateOfId?: string;
  /** 세대주 연결 대상: 파일 내 행 번호 또는 기존 성도 id */
  headRef?: { kind: 'FILE'; rowNo: number } | { kind: 'EXISTING'; memberId: string };
}

export interface ImportStats {
  created: number;
  skipped: number;
  overwritten: number;
  errors: number;
}

const HEADER_ALIASES: Record<keyof Omit<ImportRow, 'rowNo'>, string[]> = {
  name: ['이름', '성명'],
  position: ['직분'],
  birthDate: ['생년월일', '생일'],
  phoneLast4: ['연락처뒷4자리', '연락처 뒷4자리', '연락처뒷자리', '전화뒷자리'],
  isHead: ['세대주여부', '세대주 여부'],
  headName: ['세대주이름', '세대주 이름', '세대주'],
};

export const TEMPLATE_HEADERS = ['이름', '직분', '생년월일', '연락처뒷4자리', '세대주여부', '세대주이름'];

export function templateCsv(): string {
  const rows = [TEMPLATE_HEADERS, ['김철수', '집사', '1975-03-02', '1234', 'Y', ''], ['이영희', '권사', '1977-08-15', '5678', 'N', '김철수']];
  return '﻿' + rows.map((r) => r.join(',')).join('\r\n');
}

/** UTF-8(BOM 유무 무관) 또는 CP949(EUC-KR) 자동 감지 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // exceljs는 날짜를 UTC 자정 기준 Date로 돌려줍니다.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if ('result' in o) return cellToString(o.result);
    if (o.text) return String(o.text);
    return '';
  }
  return String(v);
}

/** 파일에서 헤더 기준 행 목록을 읽습니다. 값은 모두 문자열이며 수식은 평가하지 않습니다. */
export async function readImportFile(file: File): Promise<Record<string, string>[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const Papa = (await import('papaparse')).default;
    const parsed = Papa.parse<Record<string, string>>(decodeCsvBytes(bytes), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    });
    return parsed.data;
  }
  if (lower.endsWith('.xlsx')) {
    const wb = new (await import('exceljs')).default.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => (headers[col] = cellToString(c.value).trim()));
    const out: Record<string, string>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
      if (rowNo === 1) return;
      const rec: Record<string, string> = {};
      headers.forEach((h, col) => {
        if (h) rec[h] = cellToString(row.getCell(col).value).trim();
      });
      if (Object.values(rec).some((v) => v !== '')) out.push(rec);
    });
    return out;
  }
  throw new Error('CSV(.csv) 또는 엑셀(.xlsx) 파일만 가져올 수 있습니다.');
}

const pick = (rec: Record<string, string>, aliases: string[]): string => {
  for (const a of aliases) if (rec[a] !== undefined) return String(rec[a]).trim();
  return '';
};

export function normalizeDate(s: string): string {
  const m = /^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})\.?$/.exec(s.trim());
  if (!m) return s.trim();
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

export function normalizeRows(raw: Record<string, string>[]): ImportRow[] {
  return raw.map((rec, i) => ({
    rowNo: i + 2, // 1행은 헤더
    name: pick(rec, HEADER_ALIASES.name),
    position: pick(rec, HEADER_ALIASES.position),
    birthDate: normalizeDate(pick(rec, HEADER_ALIASES.birthDate)),
    phoneLast4: pick(rec, HEADER_ALIASES.phoneLast4).replace(/[^0-9]/g, ''),
    isHead: /^(y|yes|예|o|1|true|세대주)$/i.test(pick(rec, HEADER_ALIASES.isHead)),
    headName: pick(rec, HEADER_ALIASES.headName),
  }));
}

function isSamePerson(m: { name: string; birthDate?: string; phoneLast4?: string }, r: ImportRow): boolean {
  if (m.name !== r.name) return false;
  if (r.birthDate && m.birthDate) return m.birthDate === r.birthDate;
  if (r.phoneLast4 && m.phoneLast4) return m.phoneLast4 === r.phoneLast4;
  return true; // 비교할 식별 정보가 없으면 이름 일치만으로 중복 처리(안전 측)
}

export function buildPreview(rows: ImportRow[], existing: Member[]): PreviewRow[] {
  const preview: PreviewRow[] = rows.map((r) => {
    const messages: string[] = [];
    let status: ImportStatus = 'OK';
    const fail = (msg: string) => {
      messages.push(msg);
      status = 'ERROR';
    };
    const warn = (msg: string) => {
      messages.push(msg);
      if (status === 'OK') status = 'WARN';
    };
    const row: PreviewRow = { ...r, status, messages };
    if (!r.name) fail('이름이 없습니다.');
    if (r.birthDate && !isValidDateString(r.birthDate)) fail(`생년월일 형식 오류: ${r.birthDate}`);
    if (r.phoneLast4) {
      if (r.phoneLast4.length > 4) fail('연락처 뒷자리는 4자리입니다.');
      else if (r.phoneLast4.length < 4) {
        row.phoneLast4 = r.phoneLast4.padStart(4, '0');
        warn(`연락처 앞자리 0 보정: ${row.phoneLast4}`);
      }
    }
    if (r.isHead && r.headName) warn('세대주로 지정되어 세대주이름은 무시됩니다.');
    row.status = status;
    return row;
  });

  // 파일 내 중복
  const seen: PreviewRow[] = [];
  for (const row of preview) {
    if (row.status === 'ERROR') continue;
    if (seen.some((s) => isSamePerson(s, row))) {
      row.status = 'ERROR';
      row.messages.push('파일 안에 같은 사람이 이미 있습니다.');
      continue;
    }
    seen.push(row);
  }

  // 세대주 연결 확인
  for (const row of preview) {
    if (row.status === 'ERROR' || row.isHead || !row.headName) continue;
    const fileHeads = preview.filter((p) => p.isHead && p.status !== 'ERROR' && p.name === row.headName);
    const existingHeads = existing.filter((m) => m.isActive && m.isFamilyHead && m.name === row.headName);
    if (fileHeads.length === 1 && existingHeads.length === 0) row.headRef = { kind: 'FILE', rowNo: fileHeads[0].rowNo };
    else if (fileHeads.length === 0 && existingHeads.length === 1) row.headRef = { kind: 'EXISTING', memberId: existingHeads[0].id };
    else if (fileHeads.length + existingHeads.length === 0) {
      row.status = 'ERROR';
      row.messages.push(`세대주 '${row.headName}'을(를) 찾을 수 없습니다.`);
    } else {
      row.status = 'ERROR';
      row.messages.push(`세대주 '${row.headName}'이(가) 여러 명이라 특정할 수 없습니다.`);
    }
  }

  // 기존 성도와 중복
  for (const row of preview) {
    if (row.status === 'ERROR') continue;
    const dup = existing.find((m) => isSamePerson(m, row));
    if (dup) {
      row.duplicateOfId = dup.id;
      row.status = 'DUPLICATE';
      row.messages.push('이미 등록된 성도와 같습니다.');
    }
  }
  return preview;
}

/** 미리보기 결과를 명단에 반영합니다. 세대주 행을 먼저 생성한 뒤 세대원을 연결합니다. */
export function applyImport(
  preview: PreviewRow[],
  overwriteRowNos: Set<number>,
  existing: Member[],
): { members: Member[]; stats: ImportStats } {
  let members = existing.map((m) => ({ ...m }));
  const stats: ImportStats = { created: 0, skipped: 0, overwritten: 0, errors: 0 };
  const createdIdByRow = new Map<number, string>();
  const now = nowIso();

  const createRow = (row: PreviewRow, headMemberId: string) => {
    const res = applyMemberSave(members, {
      ...EMPTY_MEMBER_DRAFT,
      name: row.name,
      position: normalizePosition(row.position),
      birthDate: row.birthDate,
      phoneLast4: row.phoneLast4,
      isFamilyHead: row.isHead,
      headMemberId,
    });
    if (!res.ok) {
      stats.errors++;
      return;
    }
    members = res.members;
    createdIdByRow.set(row.rowNo, res.saved.id);
    stats.created++;
  };

  const ordered = [...preview].sort((a, b) => Number(b.isHead) - Number(a.isHead));
  for (const row of ordered) {
    if (row.status === 'ERROR') {
      stats.errors++;
      continue;
    }
    if (row.status === 'DUPLICATE') {
      if (!overwriteRowNos.has(row.rowNo) || !row.duplicateOfId) {
        stats.skipped++;
        continue;
      }
      const m = members.find((x) => x.id === row.duplicateOfId);
      if (m) {
        // 덮어쓰기는 직분·생년월일·연락처만 갱신합니다(세대 연결은 유지).
        if (normalizePosition(row.position)) m.position = normalizePosition(row.position);
        if (row.birthDate) m.birthDate = row.birthDate;
        if (row.phoneLast4) m.phoneLast4 = row.phoneLast4;
        m.updatedAt = now;
        stats.overwritten++;
      }
      continue;
    }
    let headMemberId = '';
    if (row.headRef?.kind === 'EXISTING') headMemberId = row.headRef.memberId;
    if (row.headRef?.kind === 'FILE') {
      const ref = row.headRef;
      headMemberId =
        createdIdByRow.get(ref.rowNo) ??
        preview.find((p) => p.rowNo === ref.rowNo && p.status === 'DUPLICATE')?.duplicateOfId ??
        '';
    }
    createRow(row, headMemberId);
  }
  return { members, stats };
}
