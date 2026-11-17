/**
 * 메모리에 올려 둔 헌금(달 단위)을 연도 단위로 정리하는 규칙(순수 함수).
 * 메모리에 남길 내역은 합쳐서 최대 maxRows건이며, 넘으면 가장 오래 쓰지 않은 연도부터 내립니다(연도 수가 아니라 건수 기준이라
 * 건수가 적으면 여러 해를, 많으면 적은 해만 남김). 지금 화면이 쓰는 연도(pins)와 읽는 중인 연도(loading)는 내리지 않으므로
 * 그 연도만으로 maxRows를 넘을 수 있습니다.
 */
export function yearsToEvict(
  rowsByMonth: ReadonlyMap<string, number>,
  pins: ReadonlyMap<string, number>,
  lastUsed: ReadonlyMap<string, number>,
  loadingYears: ReadonlySet<string>,
  maxRows: number,
): string[] {
  const rowsByYear = new Map<string, number>();
  let total = 0;
  for (const [ym, n] of rowsByMonth) {
    rowsByYear.set(ym.slice(0, 4), (rowsByYear.get(ym.slice(0, 4)) ?? 0) + n);
    total += n;
  }
  if (total <= maxRows) return [];
  const candidates = [...rowsByYear.keys()]
    .filter((y) => (pins.get(y) ?? 0) <= 0 && !loadingYears.has(y))
    .sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0) || (a < b ? -1 : 1));
  const drop: string[] = [];
  for (const y of candidates) {
    if (total <= maxRows) break;
    drop.push(y);
    total -= rowsByYear.get(y)!;
  }
  return drop;
}
