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
