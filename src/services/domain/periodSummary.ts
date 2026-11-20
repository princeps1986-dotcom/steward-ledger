import type { Donation } from '../../contexts/types';

interface TypeSums {
  amount: number;
  /** 무명(성도 미지정) 헌금 합계 */
  anonymous: number;
  count: number;
}

/** 한 달 내역을 헌금 종류별 합계로 줄인 것(분기·연도 요약용). 종류별로 두어 숨긴 종류를 빼고 다시 더할 수 있습니다. */
export type MonthSums = ReadonlyMap<string, TypeSums>;

export function sumMonth(list: readonly Donation[]): MonthSums {
  const out = new Map<string, TypeSums>();
  for (const d of list) {
    let s = out.get(d.offeringTypeId);
    if (!s) out.set(d.offeringTypeId, (s = { amount: 0, anonymous: 0, count: 0 }));
    s.amount += d.amount;
    s.count++;
    if (d.memberId === null) s.anonymous += d.amount;
  }
  return out;
}
