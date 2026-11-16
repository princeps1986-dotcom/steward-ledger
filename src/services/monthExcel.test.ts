import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Donation, OfferingType } from '../contexts/types';
import { monthRangeOf } from './domain/calendar';
import { buildWeeklyMatrix } from './domain/weekly';
import { buildWeeklyWorkbook } from './excel/excelService';

const types: OfferingType[] = [{ id: 't1', name: '십일조', displayArea: 'PRIMARY', quickAmounts: [], sortOrder: 1, isActive: true }];
const don = (id: string, date: string, amount: number): Donation => ({ id, date, memberId: 'm', donorDisplayName: '김철수', offeringTypeId: 't1', amount, createdAt: id }) as Donation;

describe('monthly person workbook', () => {
  it('has one sheet (no per-donation detail) and a monthly title', async () => {
    const range = monthRangeOf('2026', 11);
    const list = [don('1', '2026-11-01', 1000), don('2', '2026-11-08', 2000)];
    const blob = await buildWeeklyWorkbook({ range, matrix: buildWeeklyMatrix(list, types, range), donations: list, offeringTypes: types, kind: 'MONTH' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['월별헌금보고서']);
    expect(String(wb.worksheets[0].getCell('A1').value)).toContain('2026-11 월별 헌금 보고서');
  });
  it('keeps two sheets for the weekly report', async () => {
    const range = { start: '2026-11-08', end: '2026-11-14' };
    const list = [don('2', '2026-11-08', 2000)];
    const blob = await buildWeeklyWorkbook({ range, matrix: buildWeeklyMatrix(list, types, range), donations: list, offeringTypes: types });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['주별헌금보고서', '주간상세내역']);
  });
});
