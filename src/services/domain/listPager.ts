import type { Donation } from '../../contexts/types';
import { filterByDonor, sortForList } from './donationList';

export interface ListCriteria {
  query: string;
  /** 주별처럼 달의 일부만 볼 때의 날짜 범위(양 끝 포함). 없으면 달 전체 */
  range: { start: string; end: string } | null;
}

/** 한 달의 조건에 맞는 내역 요약. rows는 최신순이며, 메모리 예산을 넘으면 건수·합계만 남기고 null */
export interface ListSlice {
  version: string;
  count: number;
  total: number;
  rows: Donation[] | null;
}

const critKeyOf = (c: ListCriteria): string => `${c.query}|${c.range?.start ?? ''}|${c.range?.end ?? ''}`;

function select(list: readonly Donation[], c: ListCriteria): Donation[] {
  const inRange = c.range ? list.filter((d) => d.date >= c.range!.start && d.date <= c.range!.end) : list;
  return sortForList(filterByDonor(inRange, c.query));
}

/**
 * "전체 입력 내역"을 달 단위로 나누어 읽는 도구(화면과 무관한 순수 로직). 기간의 모든 내역을 메모리에 올리지 않고,
 * 달마다 건수·합계만 구해 두었다가 화면에 보이는 행이 속한 달만 읽습니다. 합쳐서 keepBudget건까지는 행을 그대로 들고 있어
 * (작은 기간은 한 번만 읽음) 그보다 큰 기간만 달을 다시 읽습니다. 달이 바뀌었는지는 version(문자열)으로 알아내 바뀐 달만 다시 읽습니다.
 */
export class ListPager {
  private slices = new Map<string, ListSlice>();
  /** 예산 때문에 행을 버린 달을 보여 줄 때 읽어 둔 임시 행(최근 3개 달) */
  private demand = new Map<string, { version: string; rows: Donation[] }>();
  private pending = new Set<string>();
  private crit: ListCriteria = { query: '', range: null };
  private critKey = critKeyOf(this.crit);

  constructor(
    private readonly read: (ym: string) => Promise<Donation[]>,
    private readonly keepBudget = 50_000,
    private readonly onChange: () => void = () => undefined,
  ) {}

  /** months(최신 달부터)의 요약을 최신 상태로 맞춥니다. 달 하나를 읽을 때마다 onChange를 부릅니다. cancelled가 true가 되면 멈춥니다. */
  async refresh(months: readonly string[], versionOf: (ym: string) => string, crit: ListCriteria, cancelled: () => boolean): Promise<void> {
    const key = critKeyOf(crit);
    if (key !== this.critKey) {
      this.critKey = key;
      this.slices.clear();
      this.demand.clear();
    }
    this.crit = crit;
    for (const ym of [...this.slices.keys()]) if (!months.includes(ym)) this.slices.delete(ym);
    for (const ym of months) {
      const version = versionOf(ym);
      if (this.slices.get(ym)?.version === version) continue;
      const rows = select(await this.read(ym), crit);
      if (cancelled()) return;
      let kept = 0;
      for (const [m, s] of this.slices) if (m !== ym) kept += s.rows?.length ?? 0;
      let total = 0;
      for (const d of rows) total += d.amount;
      this.slices.set(ym, { version, count: rows.length, total, rows: kept + rows.length <= this.keepBudget ? rows : null });
      this.onChange();
    }
  }

  get count(): number {
    let n = 0;
    for (const s of this.slices.values()) n += s.count;
    return n;
  }

  get total(): number {
    let n = 0;
    for (const s of this.slices.values()) n += s.total;
    return n;
  }

  /** 모든 달의 행을 들고 있는지(인쇄할 때 목록이 잘리지 않는지) */
  get complete(): boolean {
    for (const s of this.slices.values()) if (s.count > 0 && !s.rows) return false;
    return true;
  }

  /** i번째(최신순) 내역. 그 달의 행을 아직 읽는 중이면 null을 돌려주고, 다 읽으면 onChange를 부릅니다. */
  rowAt(months: readonly string[], i: number): Donation | null {
    for (const ym of months) {
      const s = this.slices.get(ym);
      if (!s) continue;
      if (i >= s.count) {
        i -= s.count;
        continue;
      }
      const rows = s.rows ?? (this.demand.get(ym)?.version === s.version ? this.demand.get(ym)!.rows : null);
      if (rows) return rows[i] ?? null;
      this.load(ym, s.version);
      return null;
    }
    return null;
  }

  private load(ym: string, version: string): void {
    if (this.pending.has(ym)) return;
    this.pending.add(ym);
    const crit = this.crit;
    void this.read(ym)
      .then((list) => {
        if (this.critKey !== critKeyOf(crit) || this.slices.get(ym)?.version !== version) return;
        this.demand.delete(ym);
        this.demand.set(ym, { version, rows: select(list, crit) });
        while (this.demand.size > 3) this.demand.delete(this.demand.keys().next().value as string);
        this.onChange();
      })
      .catch(() => undefined) // 읽기 실패: 다시 그릴 때 한 번 더 시도하도록 알리지 않고 둡니다(무한 반복 방지)
      .finally(() => this.pending.delete(ym));
  }
}
