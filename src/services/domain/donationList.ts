import type { Donation } from '../../contexts/types';

/**
 * 날짜 최신순, 같은 날짜는 입력 시각 최신순 (방금 입력한 내역이 맨 위).
 * 날짜(YYYY-MM-DD)와 입력 시각(ISO)은 형식이 고정이라 일반 문자열 비교로 충분하며,
 * 한글 규칙 비교(localeCompare)보다 훨씬 빨라 수십만 건에서도 지연이 적습니다.
 */
export function sortForList(donations: readonly Donation[]): Donation[] {
  return [...donations].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return 0;
  });
}

/**
 * 표기명(성도 이름·무명1 등)으로 내역을 거릅니다.
 * 빈 검색어는 전체를 돌려줍니다.
 */
export function filterByDonor(donations: readonly Donation[], query: string): Donation[] {
  const q = query.replace(/\s/g, '');
  if (q === '') return [...donations];
  return donations.filter((d) => d.donorDisplayName.includes(q));
}
