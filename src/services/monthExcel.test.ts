import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Donation, OfferingType } from '../contexts/types';
import { monthRangeOf, shiftDay } from './domain/calendar';
import { monthsOfPeriod, periodLabel } from './domain/dates';
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
  it('builds a one-day report: day title, day sheets, only that day', async () => {
    const range = { start: '2026-11-15', end: '2026-11-15' };
    const list = [don('3', '2026-11-15', 3000)];
    const blob = await buildWeeklyWorkbook({ range, matrix: buildWeeklyMatrix(list, types, range), donations: list, offeringTypes: types, kind: 'DAY' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['일별헌금보고서', '일간상세내역']);
    expect(String(wb.worksheets[0].getCell('A1').value)).toContain('2026-11-15 일별 헌금 보고서');
  });
  it('day helpers: no months, label, and shiftDay crosses month ends', () => {
    expect(monthsOfPeriod('DAY', 1)).toEqual([]);
    expect(periodLabel('2026', 'DAY', 1)).toBe('2026년 일별');
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});
