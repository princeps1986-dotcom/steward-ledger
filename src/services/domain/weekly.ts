import type { Donation, OfferingType } from '../../contexts/types';
import { weekdayLabelOf, type WeekRange } from './calendar';
import { compareKo, compareKoNumeric } from './compare';

interface WeeklyColumn {
  id: string;
  name: string;
}

interface WeeklyRow {
  /** 성도 ID 또는 무명/방문자 표기명 기반 키 */
  key: string;
  name: string;
  isAnonymous: boolean;
  /** columns 순서와 동일한 종류별 금액 */
  cells: number[];
  total: number;
}

interface WeeklyMatrix {
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
 * - 행: 등록 성도(가나다순, 동명이인은 보조 키 순) → 무명/방문자(날짜순, 같은 날은 번호순).
 *   무명 번호는 날짜마다 1부터 다시 매기므로 같은 날짜·같은 표기명끼리만 한 행이고, 여러 날 범위면 이름 옆에 요일을 붙입니다(무명1 (수); 한 주보다 길면 무명1 (11/18 수)).
 */
/** 비활성 성도의 내역을 뺍니다(무명/방문자는 성도가 없으므로 남김). 종합 보고서의 [비활성 성도 포함] 해제용 */
export function withoutInactiveMembers(donations: readonly Donation[], members: readonly { id: string; isActive: boolean }[]): readonly Donation[] {
  const inactive = new Set(members.filter((m) => !m.isActive).map((m) => m.id));
  return inactive.size === 0 ? donations : donations.filter((d) => !d.memberId || !inactive.has(d.memberId));
}

export function buildWeeklyMatrix(
  donations: readonly Donation[],
  types: readonly OfferingType[],
  range: WeekRange,
  /** 이름이 같은 성도끼리의 순서를 정하는 보조 키(성도 id → 문자열). 없으면 입력 순서 */
  tieBreak?: (memberId: string) => string,
  /** 성도의 지금 이름(없으면 헌금에 남은 당시 이름). 이름을 바꾼 성도가 옛 이름으로 보이지 않게 */
  nameOf?: (memberId: string) => string | undefined,
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

  const multiDay = range.start !== range.end;
  // 한 주보다 길면(월별) 같은 요일이 여러 번 있으므로 날짜도 붙입니다.
  const multiWeek = Date.parse(range.end) - Date.parse(range.start) > 6 * 86_400_000;
  const rowMap = new Map<string, WeeklyRow>();
  for (const d of inWeek) {
    const key = d.memberId ?? `anon:${d.date}:${d.donorDisplayName}`;
    let row = rowMap.get(key);
    if (!row) {
      const w = d.memberId === null && multiDay ? weekdayLabelOf(d.date) : null;
      const day = multiWeek ? `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))} ` : '';
      const name = w ? `${d.donorDisplayName} (${day}${w.label})` : (d.memberId && nameOf?.(d.memberId)) || d.donorDisplayName;
      row = { key, name, isAnonymous: d.memberId === null, cells: columns.map(() => 0), total: 0 };
      rowMap.set(key, row);
    }
    row.cells[colIndex.get(d.offeringTypeId)!] += d.amount;
    row.total += d.amount;
  }

  const rows = [...rowMap.values()].sort((a, b) => {
    if (a.isAnonymous !== b.isAnonymous) return a.isAnonymous ? 1 : -1;
    if (a.isAnonymous && a.key.slice(5, 15) !== b.key.slice(5, 15)) return a.key.slice(5, 15) < b.key.slice(5, 15) ? -1 : 1; // 'anon:YYYY-MM-DD:'의 날짜
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
