import type { Donation, OfferingType } from '../../contexts/types';
import type { WeekRange } from './calendar';
import { compareKo, compareKoNumeric } from './compare';

export interface WeeklyColumn {
  id: string;
  name: string;
}

export interface WeeklyRow {
  /** 성도 ID 또는 무명/방문자 표기명 기반 키 */
  key: string;
  name: string;
  isAnonymous: boolean;
  /** columns 순서와 동일한 종류별 금액 */
  cells: number[];
  total: number;
}

export interface WeeklyMatrix {
  columns: WeeklyColumn[];
  rows: WeeklyRow[];
  columnTotals: number[];
  total: number;
  count: number;
}

const byName = compareKoNumeric;

/**
 * 주별 보고서: 가로 = 헌금 종류, 세로 = 성도명.
 * - 기간(start~end, 양끝 포함)에 속한 내역만 집계합니다.
 * - 열: 활성 종류 + 해당 주에 사용된 비활성 종류(sortOrder 순). 장부에만 있는 알 수 없는 종류는 마지막에 둡니다.
 * - 행: 등록 성도(가나다순, 동명이인은 보조 키 순) → 무명/방문자(번호순). 무명은 같은 표기명끼리 한 행입니다.
 */
export function buildWeeklyMatrix(
  donations: readonly Donation[],
  types: readonly OfferingType[],
  range: WeekRange,
  /** 이름이 같은 성도끼리의 순서를 정하는 보조 키(성도 id → 문자열). 없으면 입력 순서 */
  tieBreak?: (memberId: string) => string,
): WeeklyMatrix {
  const inWeek = donations.filter((d) => d.date >= range.start && d.date <= range.end);
  const used = new Set(inWeek.map((d) => d.offeringTypeId));
  const known = new Set(types.map((t) => t.id));

  const columns: WeeklyColumn[] = [
    ...types
      .filter((t) => t.isActive || used.has(t.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ id: t.id, name: t.name })),
    ...[...used].filter((id) => !known.has(id)).map((id) => ({ id, name: '(삭제된 종류)' })),
  ];
  const colIndex = new Map(columns.map((c, i) => [c.id, i]));

  const rowMap = new Map<string, WeeklyRow>();
  for (const d of inWeek) {
    const key = d.memberId ?? `anon:${d.donorDisplayName}`;
    let row = rowMap.get(key);
    if (!row) {
      row = { key, name: d.donorDisplayName, isAnonymous: d.memberId === null, cells: columns.map(() => 0), total: 0 };
      rowMap.set(key, row);
    }
    row.cells[colIndex.get(d.offeringTypeId)!] += d.amount;
    row.total += d.amount;
  }

  const rows = [...rowMap.values()].sort((a, b) => {
    if (a.isAnonymous !== b.isAnonymous) return a.isAnonymous ? 1 : -1;
    return byName(a.name, b.name) || (!a.isAnonymous && tieBreak ? compareKo(tieBreak(a.key), tieBreak(b.key)) : 0);
  });
  const columnTotals = columns.map((_, i) => rows.reduce((s, r) => s + r.cells[i], 0));
  return {
    columns,
    rows,
    columnTotals,
    total: columnTotals.reduce((s, v) => s + v, 0),
    count: inWeek.length,
  };
}
