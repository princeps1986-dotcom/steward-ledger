import type { Member } from '../../contexts/types';
import { nowIso } from '../domain/ids';
import { applyMemberSave, EMPTY_MEMBER_DRAFT } from '../domain/memberRules';
import { normalizePosition } from '../domain/positions';

interface ImportRow {
  rowNo: number;
  name: string;
  position: string;
  phoneLast4: string;
  isHead: boolean;
  headName: string;
}

type ImportStatus = 'OK' | 'WARN' | 'ERROR' | 'DUPLICATE';

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
  phoneLast4: ['연락처뒷4자리', '연락처 뒷4자리', '연락처뒷자리', '전화뒷자리'],
  isHead: ['세대주여부', '세대주 여부'],
  headName: ['세대주이름', '세대주 이름', '세대주'],
};

const TEMPLATE_HEADERS = ['이름', '직분', '연락처뒷4자리', '세대주여부', '세대주이름'];

export function templateCsv(): string {
  const rows = [TEMPLATE_HEADERS, ['김철수', '집사', '1234', 'Y', ''], ['이영희', '권사', '5678', 'N', '김철수']];
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

/** 읽은 행에 원본 줄 번호(1행은 제목)를 실어 나르는 이름 */
export const LINE_KEY = '__line';

/** 파일에서 헤더 기준 행 목록을 읽습니다. 값은 모두 문자열이며 수식은 평가하지 않습니다. */
export async function readImportFile(file: File): Promise<Record<string, string>[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const Papa = (await import('papaparse')).default;
    // 제목 앞의 빈 줄만 먼저 떼고(뗀 줄 수는 줄 번호에 더함), 중간의 빈 줄은 줄 번호를 매긴 뒤에 버립니다.
    const raw = decodeCsvBytes(bytes);
    const lead = raw.match(/^([\s,]*\n)+/)?.[0] ?? '';
    const skipped = (lead.match(/\n/g) ?? []).length;
    const text = raw.slice(lead.length);
    // 구분 문자(쉼표·탭·세미콜론)는 빈 줄을 빼고 알아냅니다. 빈 줄이 섞이면 자동 판별이 쉼표로 떨어집니다.
    const { delimiter } = Papa.parse(text, { preview: 10, skipEmptyLines: 'greedy' }).meta;
    const parsed = Papa.parse<Record<string, string>>(text, {
      delimiter,
      header: true,
      transformHeader: (h) => h.trim(),
    });
    // 따옴표 안의 줄바꿈(엑셀 칸 안 Alt+Enter)은 한 기록이 여러 줄을 차지하므로, 그만큼 다음 번호를 늘립니다.
    let line = 2 + skipped;
    return parsed.data.flatMap((rec) => {
      const joined = Object.values(rec).join('');
      const at = line;
      line += 1 + (joined.match(/\n/g)?.length ?? 0);
      return joined.trim() ? [{ ...rec, [LINE_KEY]: String(at) }] : [];
    });
  }
  throw new Error('CSV(.csv) 파일만 가져올 수 있습니다.');
}

const pick = (rec: Record<string, string>, aliases: string[]): string => {
  for (const a of aliases) if (rec[a] !== undefined) return String(rec[a]).trim();
  return '';
};

export function normalizeRows(raw: Record<string, string>[]): ImportRow[] {
  return raw.map((rec, i) => ({
    rowNo: i + 2, // 1행은 헤더
    name: pick(rec, HEADER_ALIASES.name),
    position: pick(rec, HEADER_ALIASES.position),
    phoneLast4: pick(rec, HEADER_ALIASES.phoneLast4).replace(/[^0-9]/g, ''),
    isHead: /^(y|yes|예|o|1|true|세대주)$/i.test(pick(rec, HEADER_ALIASES.isHead)),
    headName: pick(rec, HEADER_ALIASES.headName),
  }));
}

function isSamePerson(m: { name: string; phoneLast4?: string }, r: ImportRow): boolean {
  if (m.name !== r.name) return false;
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

  // 이름별로 묶어 두고 같은 이름끼리만 비교합니다(행마다 전체를 훑지 않도록).
  const groupBy = <T,>(list: readonly T[], keep: (x: T) => boolean, name: (x: T) => string): Map<string, T[]> => {
    const out = new Map<string, T[]>();
    for (const x of list) {
      if (!keep(x)) continue;
      const k = name(x);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(x);
    }
    return out;
  };

  // 파일 내 중복
  const seen = new Map<string, PreviewRow[]>();
  for (const row of preview) {
    if (row.status === 'ERROR') continue;
    const same = seen.get(row.name) ?? [];
    if (same.some((s) => isSamePerson(s, row))) {
      row.status = 'ERROR';
      row.messages.push('파일 안에 같은 사람이 이미 있습니다.');
      continue;
    }
    seen.set(row.name, [...same, row]);
  }

  // 세대주 연결 확인
  const fileHeadsByName = groupBy(preview, (p) => p.isHead && p.status !== 'ERROR', (p) => p.name);
  const existingHeadsByName = groupBy(existing, (m) => m.isActive && m.isFamilyHead, (m) => m.name);
  const existingByName = groupBy(existing, () => true, (m) => m.name);
  for (const row of preview) {
    if (row.status === 'ERROR' || row.isHead || !row.headName) continue;
    const existingHeads = existingHeadsByName.get(row.headName) ?? [];
    // 이미 등록된 세대주와 같은 사람인 파일 행(같은 명단을 다시 가져올 때)은 등록된 쪽 하나로 셉니다.
    const fileHeads = (fileHeadsByName.get(row.headName) ?? []).filter((f) => !existingHeads.some((e) => isSamePerson(e, f)));
    // 파일의 세대주가 이미 등록된 성도인데 세대주가 아니면, 불러오기는 그 성도를 세대주로 바꾸지 않으므로(덮어쓰기는 직분·연락처만)
    // 그대로 연결하면 그 성도가 속한 다른 세대에 들어가거나 세대주 없는 세대가 생깁니다. 연결하지 않고 알립니다.
    if (fileHeads.length === 1 && existingHeads.length === 0 && existingByName.get(row.headName)?.some((m) => isSamePerson(m, fileHeads[0]))) {
      row.status = 'ERROR';
      row.messages.push(`세대주 '${row.headName}'은(는) 이미 등록된 성도지만 세대주가 아닙니다. 성도 화면에서 세대주로 바꾼 뒤 다시 가져오세요.`);
    } else if (fileHeads.length === 1 && existingHeads.length === 0) row.headRef = { kind: 'FILE', rowNo: fileHeads[0].rowNo };
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
    const dup = existingByName.get(row.name)?.find((m) => isSamePerson(m, row));
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
  let members = [...existing];
  // applyMemberSave는 끝에 덧붙이기만 하므로 기존 성도의 자리는 그대로입니다.
  const indexById = new Map(existing.map((m, i) => [m.id, i]));
  const stats: ImportStats = { created: 0, skipped: 0, overwritten: 0, errors: 0 };
  const createdIdByRow = new Map<number, string>();
  const now = nowIso();

  const createRow = (row: PreviewRow, headMemberId: string) => {
    const res = applyMemberSave(members, {
      ...EMPTY_MEMBER_DRAFT,
      name: row.name,
      position: normalizePosition(row.position),
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
      const i = indexById.get(row.duplicateOfId);
      if (i !== undefined) {
        const m = (members[i] = { ...members[i] }); // 덮어쓸 성도만 복사해서 바꿉니다.
        // 덮어쓰기는 직분·연락처만 갱신합니다(세대 연결은 유지).
        if (normalizePosition(row.position)) m.position = normalizePosition(row.position);
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
