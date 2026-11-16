import type { Donation } from '../../contexts/types';
import { toChosung } from './search';

/** 날짜 최신순, 같은 날짜는 입력 시각 최신순 (방금 입력한 내역이 맨 위) */
export function sortForList(donations: readonly Donation[]): Donation[] {
  return [...donations].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * 표기명(성도 이름·무명1 등)으로 내역을 거릅니다. 한글 초성만 입력하면 초성으로 비교합니다.
 * 빈 검색어는 전체를 돌려줍니다.
 */
export function filterByDonor(donations: readonly Donation[], query: string): Donation[] {
  const q = query.replace(/\s/g, '');
  if (q === '') return [...donations];
  const chosungOnly = /^[ㄱ-ㅎ]+$/.test(q);
  return donations.filter((d) => (chosungOnly ? toChosung(d.donorDisplayName).includes(q) : d.donorDisplayName.includes(q)));
}
