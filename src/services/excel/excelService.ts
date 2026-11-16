import ExcelJS from 'exceljs';
import type { Donation, Member, OfferingType } from '../../contexts/types';
import type { WeekRange } from '../domain/calendar';
import { monthsOfPeriod, periodLabel, yearMonthOf, type PeriodType } from '../domain/dates';
import { buildFamilyLabels, familyKeyOf, familyMemberNames, type FamilyBasis } from '../domain/family';
import type { WeeklyMatrix } from '../domain/weekly';

export interface ExcelReportInput {
  year: string;
  periodType: PeriodType;
  periodValue: number;
  /** 이미 기간으로 필터링된 내역 */
  donations: Donation[];
  members: Member[];
  offeringTypes: OfferingType[];
  basis: FamilyBasis;
}

const SHEET1 = '종합결산요약';
const SHEET2 = '세대별_기부금집계';
const AMOUNT_FMT = '#,##0';

/** 엑셀 수식 인젝션 방어: 위험 문자로 시작하면 작은따옴표를 붙입니다. */
export function sanitizeCellText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** 수식 문자열 리터럴 이스케이프 */

/** 한글은 2, 그 외 1의 가중치로 표시 폭을 계산합니다. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ㄱ-ㅎㅏ-ㅣ가-힣　-〿＀-￯]/.test(ch) ? 2 : 1;
  return w;
}

function autoFit(ws: ExcelJS.Worksheet, min = 8, max = 50): void {
  ws.columns.forEach((col) => {
    let w = min;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const text =
        v && typeof v === 'object' && 'result' in v ? String((v as { result?: unknown }).result ?? '') : String(v ?? '');
      w = Math.max(w, displayWidth(text) + 2);
    });
    col.width = Math.min(w, max);
  });
}

/**
 * 이름 열이 한 줄에 다 보이도록 가장 긴 이름(한글=2)에 여유(+6)를 더해 폭을 정합니다.
 * 제목 줄처럼 긴 문구가 있는 열이라도 이름 기준으로만 계산하며, 엑셀은 옆 칸에 값이 있으면 글자를 잘라 보여 주므로 넉넉히 둡니다.
 */
export function fitNameColumn(ws: ExcelJS.Worksheet, col: number, names: readonly string[], opts: { min?: number; max?: number; extra?: number } = {}): void {
  const { min = 18, max = 60, extra = 6 } = opts;
  const widest = names.reduce((w, n) => Math.max(w, displayWidth(n) + extra), min);
  ws.getColumn(col).width = Math.min(widest, max);
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
}

export interface ExcelWeeklyInput {
  range: WeekRange;
  matrix: WeeklyMatrix;
  /** 이미 해당 주로 필터링된 내역 (상세 시트용) */
  donations: Donation[];
  offeringTypes: OfferingType[];
  /** 'MONTH'(월별 보고서)이면 제목을 월별로 쓰고 개별 내역 시트를 만들지 않습니다. 기본 'WEEK' */
  kind?: 'WEEK' | 'MONTH';
}

const MONTH_SHEET1 = '월별헌금보고서';
const WEEK_SHEET1 = '주별헌금보고서';
const WEEK_SHEET2 = '주간상세내역';
const THIN_BORDER = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } } as const;

/**
 * 주별 보고서 엑셀: Sheet 1 = 가로 헌금 종류 × 세로 성도명 교차표(합계는 SUM 수식 + 캐시 결과값),
 * Sheet 2 = 해당 주 상세 내역. 모든 텍스트 셀은 수식 인젝션 방어를 거칩니다.
 */
export async function buildWeeklyWorkbook(input: ExcelWeeklyInput): Promise<Blob> {
  const { range, matrix, donations, offeringTypes, kind = 'WEEK' } = input;
  const isMonth = kind === 'MONTH';
  const typeName = (id: string): string => offeringTypes.find((t) => t.id === id)?.name ?? '(삭제된 종류)';

  const wb = new ExcelJS.Workbook();
  wb.creator = '청지기 장부';
  wb.created = new Date();
  const ws1 = wb.addWorksheet(isMonth ? MONTH_SHEET1 : WEEK_SHEET1);
  const ws2 = isMonth ? null : wb.addWorksheet(WEEK_SHEET2, { views: [{ state: 'frozen', ySplit: 1 }] });

  // ── Sheet 1: 성도명 × 헌금 종류 ─────────────────────────
  ws1.addRow([isMonth ? `${range.start.slice(0, 7)} 월별 헌금 보고서` : `${range.start} ~ ${range.end} 주별 헌금 보고서`]).font = { bold: true, size: 14 };
  ws1.addRow([]);
  const colCount = matrix.columns.length;
  const header = ws1.addRow(['성도명', ...matrix.columns.map((c) => sanitizeCellText(c.name)), '합계']);
  styleHeader(header);
  const firstDataRow = header.number + 1;
  const letter = (i: number): string => ws1.getColumn(i).letter;
  const totalCol = colCount + 2;

  for (const r of matrix.rows) {
    const row = ws1.addRow([sanitizeCellText(r.name), ...r.cells]);
    row.getCell(totalCol).value = { formula: `SUM(${letter(2)}${row.number}:${letter(totalCol - 1)}${row.number})`, result: r.total };
  }
  const lastDataRow = firstDataRow + matrix.rows.length - 1;
  const totalRow = ws1.addRow(['합계']);
  totalRow.font = { bold: true };
  for (let c = 2; c <= totalCol; c++) {
    const result = c === totalCol ? matrix.total : matrix.columnTotals[c - 2];
    totalRow.getCell(c).value = matrix.rows.length ? { formula: `SUM(${letter(c)}${firstDataRow}:${letter(c)}${lastDataRow})`, result } : 0;
  }
  for (let r = firstDataRow; r <= totalRow.number; r++) {
    ws1.getRow(r).eachCell((c, ci) => {
      if (ci > 1) c.numFmt = AMOUNT_FMT;
      c.border = THIN_BORDER;
    });
  }
  autoFit(ws1, 10, 30);
  fitNameColumn(ws1, 1, ['성도명', '합계', ...matrix.rows.map((r) => r.name)]);
  ws1.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // ── Sheet 2: 주간 상세 내역 (월별 보고서에는 없음) ─────────
  if (ws2) {
    ws2.addRow(['날짜', '표기명', '헌금종류', '금액', '메모']);
    styleHeader(ws2.getRow(1));
    const sorted = [...donations].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    for (const d of sorted) {
      ws2.addRow([d.date, sanitizeCellText(d.donorDisplayName), sanitizeCellText(typeName(d.offeringTypeId)), d.amount, sanitizeCellText(d.memo ?? '')]);
    }
    ws2.getColumn(4).numFmt = AMOUNT_FMT;
    autoFit(ws2);
    fitNameColumn(ws2, 2, ['표기명', ...sorted.map((d) => d.donorDisplayName)]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function buildReportWorkbook(input: ExcelReportInput): Promise<Blob> {
  const { year, periodType, periodValue, donations, members, offeringTypes, basis } = input;
  const memberById = new Map(members.map((m) => [m.id, m]));
  const usedTypeIds = new Set(donations.map((d) => d.offeringTypeId));
  const types = offeringTypes
    .filter((t) => t.isActive || usedTypeIds.has(t.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const months = monthsOfPeriod(periodType, periodValue);
  const title = periodLabel(year, periodType, periodValue);

  // 한 번만 훑어 종류×월, 종류, 월, 세대×종류, 세대 합계를 모읍니다(건수가 많아도 선형 시간).
  // 개별 내역은 파일에 넣지 않으므로 합계는 수식이 아니라 값으로 기록합니다(행·열 합계만 SUM 수식).
  const typeMonth = new Map<string, number>();
  const typeTotal = new Map<string, number>();
  const monthTotal = new Map<string, number>();
  const famType = new Map<string, number>();
  const famTotal = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number): void => void m.set(k, (m.get(k) ?? 0) + v);
  let grand = 0;
  const familyKeySet = new Set<string>();
  for (const d of donations) {
    const ym = yearMonthOf(d.date);
    add(typeMonth, `${d.offeringTypeId}|${ym}`, d.amount);
    add(typeTotal, d.offeringTypeId, d.amount);
    add(monthTotal, ym, d.amount);
    grand += d.amount;
    const fk = familyKeyOf(d, basis, memberById);
    if (fk) {
      familyKeySet.add(fk);
      add(famType, `${fk}|${d.offeringTypeId}`, d.amount);
      add(famTotal, fk, d.amount);
    }
  }
  const familyKeys = [...familyKeySet];
  const familyLabels = buildFamilyLabels(familyKeys, members);

  const wb = new ExcelJS.Workbook();
  wb.creator = '청지기 장부';
  wb.created = new Date();
  const ws1 = wb.addWorksheet(SHEET1);
  const ws2 = wb.addWorksheet(SHEET2);

  // ── Sheet 1: 종류 × 월 매트릭스 ──────────────────────────
  ws1.addRow([`${title} 헌금 결산 요약`]).font = { bold: true, size: 14 };
  ws1.addRow([`세대 집계 기준: ${basis === 'CURRENT' ? '현재 세대' : '납부 당시 세대'}`]);
  ws1.addRow([]);
  const header = ws1.addRow(['헌금 종류', ...months.map((m) => `${m}월`), '합계']);
  styleHeader(header);
  const firstDataRow = header.number + 1;
  const colLetter = (i: number): string => ws1.getColumn(i).letter;
  const ymOf = (mo: number): string => `${year}-${String(mo).padStart(2, '0')}`;

  types.forEach((t) => {
    const r = ws1.addRow([sanitizeCellText(t.name)]);
    months.forEach((mo, i) => {
      r.getCell(i + 2).value = typeMonth.get(`${t.id}|${ymOf(mo)}`) ?? 0;
    });
    const totalCol = months.length + 2;
    r.getCell(totalCol).value = {
      formula: `SUM(${colLetter(2)}${r.number}:${colLetter(totalCol - 1)}${r.number})`,
      result: typeTotal.get(t.id) ?? 0,
    };
  });
  const lastDataRow = firstDataRow + types.length - 1;
  const totalRow = ws1.addRow(['합계']);
  totalRow.font = { bold: true };
  for (let c = 2; c <= months.length + 2; c++) {
    const L = colLetter(c);
    const result = c === months.length + 2 ? grand : (monthTotal.get(ymOf(months[c - 2])) ?? 0);
    totalRow.getCell(c).value = types.length ? { formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})`, result } : 0;
  }
  for (let r = firstDataRow; r <= totalRow.number; r++) {
    ws1.getRow(r).eachCell((c, ci) => {
      if (ci > 1) c.numFmt = AMOUNT_FMT;
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
  }
  autoFit(ws1, 10, 30);
  ws1.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

  // ── Sheet 2: 세대별 기부금 집계 (무명 제외) ──────────────
  ws2.addRow([`${title} 세대별 기부금 집계 (${basis === 'CURRENT' ? '현재 세대 기준' : '납부 당시 세대 기준'})`]).font = {
    bold: true,
    size: 13,
  };
  ws2.addRow([]);
  styleHeader(ws2.addRow(['세대', '구성원(현재 명단)', ...types.map((t) => t.name), '합계']));
  const sortedFamilies = [...familyKeys].sort((a, b) => familyLabels.get(a)!.localeCompare(familyLabels.get(b)!, 'ko'));
  for (const k of sortedFamilies) {
    const label = familyLabels.get(k)!;
    const r = ws2.addRow([sanitizeCellText(label), sanitizeCellText(familyMemberNames(k, members))]);
    types.forEach((t, i) => {
      r.getCell(i + 3).value = famType.get(`${k}|${t.id}`) ?? 0;
    });
    const tc = types.length + 3;
    r.getCell(tc).value = {
      formula: `SUM(${ws2.getColumn(3).letter}${r.number}:${ws2.getColumn(tc - 1).letter}${r.number})`,
      result: famTotal.get(k) ?? 0,
    };
    r.eachCell((c, ci) => {
      if (ci > 2) c.numFmt = AMOUNT_FMT;
    });
  }
  autoFit(ws2, 10, 40);
  fitNameColumn(ws2, 1, ['세대', ...sortedFamilies.map((k) => familyLabels.get(k)!)]);
  fitNameColumn(ws2, 2, ['구성원(현재 명단)', ...sortedFamilies.map((k) => familyMemberNames(k, members))], { max: 100 });
  ws2.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
