import { describe, expect, it } from 'vitest';
import type { OfferingType } from '../../contexts/types';
import { fitNameColumn } from '../excel/excelService';
import ExcelJS from 'exceljs';
import { migrateOfferingTypesV24 } from './migrations';
import { DEFAULT_OFFERING_TYPES } from './offeringDefaults';

const t = (name: string, sortOrder: number, extra: Partial<OfferingType> = {}): OfferingType => ({ id: name, name, displayArea: 'PRIMARY', quickAmounts: [], sortOrder, isActive: true, ...extra });

describe('defaults v2.14', () => {
  it('seeds 구제헌금 as a primary type with quick amounts and 특별헌금 as a dropdown type', () => {
    const relief = DEFAULT_OFFERING_TYPES.find((d) => d.name === '구제헌금')!;
    const special = DEFAULT_OFFERING_TYPES.find((d) => d.name === '특별헌금')!;
    expect(relief).toMatchObject({ displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 30000, 50000, 100000], isActive: true });
    expect(special).toMatchObject({ displayArea: 'DROPDOWN', quickAmounts: [], isActive: true });
  });
});

describe('migrateOfferingTypesV24', () => {
  it('appends the missing types after the current last sort order', () => {
    const out = migrateOfferingTypesV24([t('십일조', 1), t('주일헌금', 5)])!;
    expect(out.map((x) => [x.name, x.displayArea, x.sortOrder])).toEqual([
      ['십일조', 'PRIMARY', 1],
      ['주일헌금', 'PRIMARY', 5],
      ['구제헌금', 'PRIMARY', 6],
      ['특별헌금', 'DROPDOWN', 7],
    ]);
    expect(out[2].quickAmounts).toEqual([1000, 5000, 10000, 30000, 50000, 100000]);
    expect(new Set(out.map((x) => x.id)).size).toBe(4); // 새 id 부여
  });
  it('leaves an existing type of the same name untouched (church settings win) and only adds the other', () => {
    const custom = t('구제헌금', 3, { displayArea: 'DROPDOWN', isActive: false, quickAmounts: [777] });
    const out = migrateOfferingTypesV24([custom])!;
    expect(out.find((x) => x.name === '구제헌금')).toEqual(custom);
    expect(out.map((x) => x.name)).toEqual(['구제헌금', '특별헌금']);
  });
  it('returns null when both already exist', () => {
    expect(migrateOfferingTypesV24([t('구제헌금', 1), t('특별헌금', 2)])).toBeNull();
  });
});

describe('fitNameColumn', () => {
  it('leaves room for the longest name (Hangul counts as 2) and ignores long titles in the same column', () => {
    const ws = new ExcelJS.Workbook().addWorksheet('s');
    fitNameColumn(ws, 1, ['성도명', '남궁민수', 'Sarah Lee']);
    expect(ws.getColumn(1).width).toBe(18); // 최소 폭
    fitNameColumn(ws, 1, ['성도명', '아주아주긴이름의성도입니다']); // 13자×2 + 6
    expect(ws.getColumn(1).width).toBe(32);
    fitNameColumn(ws, 2, ['가'.repeat(60)]);
    expect(ws.getColumn(2).width).toBe(60); // 상한
  });
});

describe('clearLegacyPosition', () => {
  it('clears only the legacy 성도 value and returns null when nothing to do', async () => {
    const { clearLegacyPosition } = await import('./positions');
    expect(clearLegacyPosition([{ position: '집사' }, { position: '성도' }])).toEqual([{ position: '집사' }, { position: '' }]);
    expect(clearLegacyPosition([{ position: '집사' }, { position: '' }])).toBeNull();
  });
});

describe('monthly person report (월별 = 그 달의 모든 주를 개인별로 합산)', () => {
  it('monthRangeOf covers the first to the last day', async () => {
    const { monthRangeOf } = await import('./calendar');
    expect(monthRangeOf('2026', 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRangeOf('2028', 2).end).toBe('2028-02-29');
    expect(monthRangeOf('2026', 12)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('the month matrix equals the sum of its weekly matrices per person', async () => {
    const { buildWeeklyMatrix } = await import('./weekly');
    const { monthRangeOf, weekRangeOf } = await import('./calendar');
    const types = [{ id: 't1', name: '십일조', displayArea: 'PRIMARY', quickAmounts: [], sortOrder: 1, isActive: true }, { id: 't2', name: '주일헌금', displayArea: 'PRIMARY', quickAmounts: [], sortOrder: 2, isActive: true }] as OfferingType[];
    const mk = (id: string, date: string, memberId: string, name: string, typeId: string, amount: number) => ({ id, date, memberId, donorDisplayName: name, offeringTypeId: typeId, amount, createdAt: '' }) as never;
    const list = [
      mk('1', '2026-11-01', 'a', '가인', 't1', 1000),
      mk('2', '2026-11-08', 'a', '가인', 't1', 2000),
      mk('3', '2026-11-08', 'b', '나인', 't2', 500),
      mk('4', '2026-11-29', 'a', '가인', 't2', 700),
      mk('5', '2026-10-25', 'a', '가인', 't1', 99999), // 다른 달: 제외
    ];
    const month = buildWeeklyMatrix(list, types, monthRangeOf('2026', 11));
    expect(month.total).toBe(4200);
    expect(month.rows.map((r) => [r.name, r.cells, r.total])).toEqual([['가인', [3000, 700], 3700], ['나인', [0, 500], 500]]);
    // 주별 표를 사람마다 더하면(월 안의 날짜만) 월별 표와 같다
    const weekSum = new Map<string, number>();
    for (const d of ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']) {
      for (const r of buildWeeklyMatrix(list.filter((x) => (x as { date: string }).date.startsWith('2026-11')), types, weekRangeOf(d)).rows) weekSum.set(r.name, (weekSum.get(r.name) ?? 0) + r.total);
    }
    expect([...weekSum]).toEqual(month.rows.map((r) => [r.name, r.total]));
  });
});

describe('yearsToEvict (메모리에 남길 연도 정리)', () => {
  it('keeps everything when within the limit', async () => {
    const { yearsToEvict } = await import('./monthCache');
    expect(yearsToEvict(['2024-01', '2025-03', '2026-11'], new Map(), new Map(), new Set(), 3)).toEqual([]);
  });
  it('drops the least recently used years first and never pinned or loading ones', async () => {
    const { yearsToEvict } = await import('./monthCache');
    const loaded = ['2023-05', '2024-01', '2024-02', '2025-03', '2026-11', '2022-12'];
    const lastUsed = new Map([['2022', 1], ['2023', 5], ['2024', 3], ['2025', 9], ['2026', 8]]);
    // 5개 연도 → 3개로: 가장 오래된 2022, 2024를 내린다
    expect(yearsToEvict(loaded, new Map(), lastUsed, new Set(), 3)).toEqual(['2022', '2024']);
    // 2022는 화면이 쓰는 중(핀) → 건너뛰고 다음으로 오래된 연도를 내린다
    expect(yearsToEvict(loaded, new Map([['2022', 1]]), lastUsed, new Set(), 3)).toEqual(['2024', '2023']);
    // 읽는 중인 연도도 내리지 않는다
    expect(yearsToEvict(loaded, new Map(), lastUsed, new Set(['2022', '2024']), 3)).toEqual(['2023', '2026']);
  });
  it('may exceed the limit when every extra year is pinned', async () => {
    const { yearsToEvict } = await import('./monthCache');
    const pins = new Map([['2023', 1], ['2024', 1], ['2025', 1], ['2026', 2]]);
    expect(yearsToEvict(['2023-01', '2024-01', '2025-01', '2026-01'], pins, new Map(), new Set(), 3)).toEqual([]);
  });
});
