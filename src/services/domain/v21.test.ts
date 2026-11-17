import { describe, expect, it } from 'vitest';
import type { Donation, OfferingType } from '../../contexts/types';
import { nextAnonymousName } from './anonymous';
import { buildMonthGrid, shiftMonth, shiftWeek, weekRangeOf } from './calendar';
import { DEFAULT_OFFERING_TYPES } from './offeringDefaults';
import { positionOptions, POSITIONS } from './positions';
import { buildWeeklyMatrix } from './weekly';

const don = (p: Partial<Donation>): Donation => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  date: '2026-11-15',
  memberId: 'm1',
  donorDisplayName: '김철수',
  offeringTypeId: 't1',
  amount: 1000,
  createdAt: '',
  ...p,
});

const type = (id: string, name: string, sortOrder: number, isActive = true): OfferingType => ({
  id,
  name,
  displayArea: 'PRIMARY',
  quickAmounts: [],
  sortOrder,
  isActive,
});

describe('calendar', () => {
  it('builds a 6-week Sunday-first grid with Sundays flagged', () => {
    const grid = buildMonthGrid(2026, 11); // 2026-11-01은 일요일
    expect(grid).toHaveLength(6);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0][0]).toMatchObject({ date: '2026-11-01', isSunday: true, inMonth: true });
    expect(grid.flat().filter((c) => c.isSunday).every((c) => new Date(c.date).getUTCDay() === 0)).toBe(true);
    expect(grid.flat().filter((c) => c.isSunday)).toHaveLength(6);
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });
  it('pads with previous month days when the month does not start on Sunday', () => {
    const grid = buildMonthGrid(2026, 12); // 2026-12-01은 화요일
    expect(grid[0][0]).toMatchObject({ date: '2026-11-29', inMonth: false, isSunday: true });
    expect(grid[0][2]).toMatchObject({ date: '2026-12-01', inMonth: true });
  });
  it('shifts months across year boundaries', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month: 6 });
  });
  it('week range is Sunday..Saturday and may cross years', () => {
    expect(weekRangeOf('2026-11-15')).toEqual({ start: '2026-11-15', end: '2026-11-21' });
    expect(weekRangeOf('2026-11-18')).toEqual({ start: '2026-11-15', end: '2026-11-21' });
    expect(weekRangeOf('2026-11-21')).toEqual({ start: '2026-11-15', end: '2026-11-21' });
    expect(weekRangeOf('2025-12-28')).toEqual({ start: '2025-12-28', end: '2026-01-03' });
    expect(shiftWeek('2026-11-15', -1)).toBe('2026-11-08');
    expect(shiftWeek('2026-12-27', 1)).toBe('2027-01-03');
  });
});

describe('nextAnonymousName', () => {
  it('starts at 무명1 and increments from the max on that date', () => {
    expect(nextAnonymousName([], '2026-11-15')).toBe('무명1');
    const list = [
      don({ memberId: null, donorDisplayName: '무명1' }),
      don({ memberId: null, donorDisplayName: '무명1', offeringTypeId: 't2' }), // 같은 봉투의 다른 종류
      don({ memberId: null, donorDisplayName: '무명3' }),
      don({ memberId: null, donorDisplayName: '방문자-홍길동' }),
      don({ memberId: null, donorDisplayName: '무명9', date: '2026-11-08' }), // 다른 날짜
      don({ memberId: 'm1', donorDisplayName: '무명7' }), // 등록 성도 이름이 우연히 같아도 제외
    ];
    expect(nextAnonymousName(list, '2026-11-15')).toBe('무명4');
    expect(nextAnonymousName(list, '2026-11-08')).toBe('무명10');
    expect(nextAnonymousName(list, '2026-11-01')).toBe('무명1');
  });
  it('reuses the number after the latest anonymous record is removed (undo)', () => {
    const list = [don({ memberId: null, donorDisplayName: '무명1' }), don({ memberId: null, donorDisplayName: '무명2' })];
    expect(nextAnonymousName(list, '2026-11-15')).toBe('무명3');
    expect(nextAnonymousName(list.slice(0, 1), '2026-11-15')).toBe('무명2');
  });
});

describe('buildWeeklyMatrix', () => {
  const types = [type('t2', '주일헌금', 2), type('t1', '십일조', 1), type('t3', '건축헌금', 3), type('t4', '옛헌금', 4, false)];
  const range = { start: '2026-11-15', end: '2026-11-21' };

  it('builds member × type matrix with totals, sorted columns and rows', () => {
    const list = [
      don({ memberId: 'm2', donorDisplayName: '이영희', offeringTypeId: 't1', amount: 100000 }),
      don({ memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't1', amount: 50000 }),
      don({ memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't2', amount: 5000 }),
      don({ memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't2', amount: 3000, date: '2026-11-18' }), // 같은 칸에 합산
      don({ memberId: null, donorDisplayName: '무명10', offeringTypeId: 't2', amount: 1000 }),
      don({ memberId: null, donorDisplayName: '무명2', offeringTypeId: 't2', amount: 2000 }),
      don({ memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't1', amount: 999, date: '2026-11-22' }), // 주 밖
      don({ memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't1', amount: 999, date: '2026-11-14' }), // 주 밖
    ];
    const m = buildWeeklyMatrix(list, types, range);
    expect(m.columns.map((c) => c.name)).toEqual(['십일조', '주일헌금', '건축헌금']); // 비활성·미사용 종류 제외
    expect(m.rows.map((r) => r.name)).toEqual(['김철수', '이영희', '무명2', '무명10']);
    expect(m.rows[0].cells).toEqual([50000, 8000, 0]);
    expect(m.rows[0].total).toBe(58000);
    expect(m.columnTotals).toEqual([150000, 11000, 0]);
    expect(m.total).toBe(161000);
    expect(m.count).toBe(6);
  });

  it('keeps inactive types that were used and groups same-name anonymous donors', () => {
    const list = [
      don({ memberId: null, donorDisplayName: '무명1', offeringTypeId: 't4', amount: 700 }),
      don({ memberId: null, donorDisplayName: '무명1', offeringTypeId: 't1', amount: 300 }),
      don({ memberId: 'a', donorDisplayName: '박동명', offeringTypeId: 't1', amount: 1 }),
      don({ memberId: 'b', donorDisplayName: '박동명', offeringTypeId: 't1', amount: 2 }), // 동명이인은 별도 행
    ];
    const m = buildWeeklyMatrix(list, types, range);
    expect(m.columns.map((c) => c.name)).toEqual(['십일조', '주일헌금', '건축헌금', '옛헌금']);
    expect(m.rows.map((r) => r.name)).toEqual(['박동명', '박동명', '무명1']);
    expect(m.rows[2].total).toBe(1000);
    expect(m.total).toBe(1003);
  });

  it('adds a placeholder column for unknown offering types so totals stay consistent', () => {
    const m = buildWeeklyMatrix([don({ offeringTypeId: 'gone', amount: 500 })], types, range);
    expect(m.columns.at(-1)).toEqual({ id: 'gone', name: '(삭제된 종류)' });
    expect(m.total).toBe(500);
  });

  it('returns an empty matrix when nothing is in the week', () => {
    const m = buildWeeklyMatrix([don({ date: '2026-12-01' })], types, range);
    expect(m.rows).toEqual([]);
    expect(m.total).toBe(0);
    expect(m.count).toBe(0);
  });
});

describe('positions', () => {
  it('offers the fixed list and appends unknown legacy values', () => {
    expect([...POSITIONS]).toEqual(['목사', '전도사', '집사', '권사']);
    expect(positionOptions('성도')).toEqual([...POSITIONS]); // 이전 기본값 '성도'는 직분 없음
    expect(positionOptions('집사')).toEqual([...POSITIONS]);
    expect(positionOptions('')).toEqual([...POSITIONS]);
    expect(positionOptions(' 집사 ')).toEqual([...POSITIONS]); // 공백은 제거 후 비교
    expect(positionOptions(' 장로 ')).toEqual([...POSITIONS, '장로']);
  });
});

describe('offering defaults v2.1', () => {
  it('seeds 건축헌금 and 선교헌금 as primary with quick amounts', () => {
    for (const name of ['건축헌금', '선교헌금']) {
      const t = DEFAULT_OFFERING_TYPES.find((d) => d.name === name)!;
      expect(t.displayArea).toBe('PRIMARY');
      expect(t.quickAmounts.length).toBeGreaterThan(0);
    }
  });
});

describe('weekly excel export', () => {
  it('writes the member × type matrix with SUM formulas, cached results and injection-safe text', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const { buildWeeklyWorkbook } = await import('../excel/excelService');
    const types = [type('t1', '십일조', 1), type('t2', '주일헌금', 2)];
    const range = { start: '2026-11-15', end: '2026-11-21' };
    const donations = [
      don({ memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't1', amount: 50000 }),
      don({ memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't2', amount: 5000 }),
      don({ memberId: null, donorDisplayName: '=HYPERLINK("x")', offeringTypeId: 't2', amount: 1000, memo: '+메모' }),
    ];
    const blob = await buildWeeklyWorkbook({ range, matrix: buildWeeklyMatrix(donations, types, range), donations, offeringTypes: types });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['주별헌금보고서', '주간상세내역']);

    const ws = wb.getWorksheet('주별헌금보고서')!;
    expect(ws.getCell('A1').value).toBe('2026-11-15 ~ 2026-11-21 주별 헌금 보고서');
    expect([1, 2, 3, 4].map((c) => ws.getCell(3, c).value)).toEqual(['성도명', '십일조', '주일헌금', '합계']);
    expect(ws.getCell('A4').value).toBe('김철수');
    expect(ws.getCell('B4').value).toBe(50000);
    expect(ws.getCell('D4').value).toMatchObject({ formula: 'SUM(B4:C4)', result: 55000 });
    expect(ws.getCell('A5').value).toBe('\'=HYPERLINK("x")'); // 수식 인젝션 방어
    expect(ws.getCell('A6').value).toBe('합계');
    expect(ws.getCell('B6').value).toMatchObject({ formula: 'SUM(B4:B5)', result: 50000 });
    expect(ws.getCell('C6').value).toMatchObject({ formula: 'SUM(C4:C5)', result: 6000 });
    expect(ws.getCell('D6').value).toMatchObject({ formula: 'SUM(D4:D5)', result: 56000 });

    const detail = wb.getWorksheet('주간상세내역')!;
    expect(detail.rowCount).toBe(4);
    expect(detail.getCell('E4').value).toBe("'+메모");
  });

  it('writes an empty week without broken formulas', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const { buildWeeklyWorkbook } = await import('../excel/excelService');
    const types = [type('t1', '십일조', 1)];
    const range = { start: '2026-11-15', end: '2026-11-21' };
    const blob = await buildWeeklyWorkbook({ range, matrix: buildWeeklyMatrix([], types, range), donations: [], offeringTypes: types });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet('주별헌금보고서')!;
    expect(ws.getCell('A4').value).toBe('합계');
    expect(ws.getCell('B4').value).toBe(0);
  });
});
