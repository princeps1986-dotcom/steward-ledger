import { describe, expect, it } from 'vitest';
import type { OfferingType } from '../../contexts/types';
import { DEFAULT_OFFERING_TYPES } from './offeringDefaults';

describe('defaults v2.14', () => {
  it('seeds 구제헌금 as a primary type with quick amounts and 특별헌금 as a dropdown type', () => {
    const relief = DEFAULT_OFFERING_TYPES.find((d) => d.name === '구제헌금')!;
    const special = DEFAULT_OFFERING_TYPES.find((d) => d.name === '특별헌금')!;
    expect(relief).toMatchObject({ displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 30000, 50000, 100000], isActive: true });
    expect(special).toMatchObject({ displayArea: 'DROPDOWN', quickAmounts: [], isActive: true });
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

describe('yearsToEvict (메모리에 남길 연도 정리: 건수 기준)', () => {
  const rows = (o: Record<string, number>) => new Map(Object.entries(o));
  it('keeps everything when within the budget', async () => {
    const { yearsToEvict } = await import('./monthCache');
    expect(yearsToEvict(rows({ '2024-01': 10, '2025-03': 10, '2026-11': 10 }), new Map(), new Map(), new Set(), 100)).toEqual([]);
  });
  it('keeps many small years but drops big ones, least recently used first, never pinned or loading ones', async () => {
    const { yearsToEvict } = await import('./monthCache');
    const loaded = rows({ '2023-05': 40, '2024-01': 20, '2024-02': 20, '2025-03': 40, '2026-11': 40, '2022-12': 40 });
    const lastUsed = new Map([['2022', 1], ['2023', 5], ['2024', 3], ['2025', 9], ['2026', 8]]);
    // 합계 200건, 예산 100건: 가장 오래된 2022(40), 2024(40), 2023(40)을 내려 80건
    expect(yearsToEvict(loaded, new Map(), lastUsed, new Set(), 100)).toEqual(['2022', '2024', '2023']);
    // 2022는 화면이 쓰는 중(핀) → 건너뛰고 다음으로 오래된 연도를 내린다
    expect(yearsToEvict(loaded, new Map([['2022', 1]]), lastUsed, new Set(), 100)).toEqual(['2024', '2023', '2026']);
    // 읽는 중인 연도도 내리지 않는다
    expect(yearsToEvict(loaded, new Map(), lastUsed, new Set(['2022', '2024']), 100)).toEqual(['2023', '2026', '2025']);
    // 예산이 넉넉하면 연도 수와 상관없이 모두 남긴다
    expect(yearsToEvict(loaded, new Map(), lastUsed, new Set(), 500)).toEqual([]);
  });
  it('may exceed the budget when every extra year is pinned', async () => {
    const { yearsToEvict } = await import('./monthCache');
    const pins = new Map([['2023', 1], ['2024', 1], ['2025', 1], ['2026', 2]]);
    expect(yearsToEvict(rows({ '2023-01': 60, '2024-01': 60, '2025-01': 60, '2026-01': 60 }), pins, new Map(), new Set(), 100)).toEqual([]);
  });
});
