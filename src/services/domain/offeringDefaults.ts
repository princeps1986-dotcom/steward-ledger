import type { OfferingType } from '../../contexts/types';

export type OfferingTypeDraft = Omit<OfferingType, 'id'>;

/** 최초 실행 시 시드되는 기본 헌금 종류 (v2.1: 건축·선교도 기본 나열 + 금액 단추) */
export const DEFAULT_OFFERING_TYPES: OfferingTypeDraft[] = [
  { name: '십일조', displayArea: 'PRIMARY', quickAmounts: [100000, 200000, 300000, 400000, 500000], sortOrder: 1, isActive: true },
  { name: '주일헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000], sortOrder: 2, isActive: true },
  { name: '감사헌금', displayArea: 'PRIMARY', quickAmounts: [10000, 30000, 50000], sortOrder: 3, isActive: true },
  { name: '건축헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 50000, 100000, 500000, 1000000], sortOrder: 4, isActive: true },
  { name: '선교헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 30000, 50000, 100000], sortOrder: 5, isActive: true },
  // v2.14: 구제헌금은 기본 나열, 특별헌금은 기타 드롭다운
  { name: '구제헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 30000, 50000, 100000], sortOrder: 6, isActive: true },
  { name: '특별헌금', displayArea: 'DROPDOWN', quickAmounts: [], sortOrder: 7, isActive: true },
];

/**
 * v2.1 1회 보정: 이전 기본값 그대로(기타 드롭다운 + 금액 단추 없음)인 건축헌금·선교헌금만
 * 기본 나열 + 기본 금액 단추로 바꿉니다. 교회가 직접 설정을 바꾼 항목은 건드리지 않습니다.
 * 변경이 없으면 null을 반환합니다.
 */
