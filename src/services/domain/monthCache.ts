/**
 * 메모리에 올려 둔 헌금(달 단위)을 연도 단위로 정리하는 규칙(순수 함수).
 * 메모리에 남길 연도는 최대 maxYears개이며, 넘으면 가장 오래 쓰지 않은 연도부터 내립니다.
 * 지금 화면이 쓰는 연도(pins)와 읽는 중인 연도(loading)는 내리지 않습니다.
 */
export function yearsToEvict(
  loadedMonths: Iterable<string>,
  pins: ReadonlyMap<string, number>,
  lastUsed: ReadonlyMap<string, number>,
  loadingYears: ReadonlySet<string>,
  maxYears: number,
): string[] {
  const years = new Set<string>();
  for (const ym of loadedMonths) years.add(ym.slice(0, 4));
  let count = years.size;
  if (count <= maxYears) return [];
  const candidates = [...years]
    .filter((y) => (pins.get(y) ?? 0) <= 0 && !loadingYears.has(y))
    .sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0) || (a < b ? -1 : 1));
  const drop: string[] = [];
  for (const y of candidates) {
    if (count <= maxYears) break;
    drop.push(y);
    count--;
  }
  return drop;
}
