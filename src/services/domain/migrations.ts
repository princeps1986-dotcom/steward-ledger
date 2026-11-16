import type { AppSettings, OfferingType } from '../../contexts/types';
import { newId } from './ids';

/** v2.2: 건축헌금·선교헌금에 반드시 있어야 하는 자주 쓰는 금액 단추 */
export const V22_REQUIRED_QUICK_AMOUNTS: Record<string, number[]> = {
  건축헌금: [1000, 5000, 10000, 50000, 100000, 500000],
  선교헌금: [1000, 5000, 10000, 50000, 100000],
};

/**
 * v2.2 1회 보정: 건축헌금·선교헌금의 금액 단추에 빠진 금액을 추가합니다.
 * 이미 있는 금액(교회가 직접 설정한 값 포함)은 지우지 않고 합집합으로 정렬합니다. 변경이 없으면 null.
 */
export const migrateOfferingTypesV22 = (types: readonly OfferingType[]): OfferingType[] | null =>
  addRequiredQuickAmounts(types, V22_REQUIRED_QUICK_AMOUNTS);

/** v2.4: 십일조에 반드시 있어야 하는 자주 쓰는 금액 단추 */
export const V23_REQUIRED_QUICK_AMOUNTS: Record<string, number[]> = {
  십일조: [100000, 200000, 300000, 400000, 500000],
};

/** v2.4 1회 보정: 십일조 금액 단추에 30만·40만 원을 추가합니다(기존 금액 유지, 변경 없으면 null). */
export const migrateOfferingTypesV23 = (types: readonly OfferingType[]): OfferingType[] | null =>
  addRequiredQuickAmounts(types, V23_REQUIRED_QUICK_AMOUNTS);

/** 이름이 일치하는 헌금 종류의 금액 단추에 빠진 금액만 합집합으로 추가(정렬). 변경이 없으면 null. */
function addRequiredQuickAmounts(types: readonly OfferingType[], requiredByName: Record<string, number[]>): OfferingType[] | null {
  let changed = false;
  const next = types.map((t) => {
    const required = requiredByName[t.name];
    if (!required) return t;
    const merged = [...new Set([...t.quickAmounts, ...required])].sort((a, b) => a - b);
    if (merged.length === t.quickAmounts.length) return t;
    changed = true;
    return { ...t, quickAmounts: merged };
  });
  return changed ? next : null;
}

export const OLD_LARGE_AMOUNT_DEFAULT = 100_000_000;
export const NEW_LARGE_AMOUNT_DEFAULT = 10_000_000;

/**
 * v2.2 1회 보정: 이전 기본값(1억 원) 그대로인 큰 금액 확인 기준을 새 기본값(1천만 원)으로 바꿉니다.
 * 다른 값으로 직접 바꿔 둔 경우는 유지합니다. 변경이 없으면 null.
 */
export function migrateSettingsV22(stored: Partial<AppSettings> | null): Partial<AppSettings> | null {
  if (!stored || stored.largeAmountThreshold !== OLD_LARGE_AMOUNT_DEFAULT) return null;
  return { ...stored, largeAmountThreshold: NEW_LARGE_AMOUNT_DEFAULT };
}

/** v2.14: 기본으로 있어야 하는 헌금 종류(이름 기준). 이미 같은 이름이 있으면 건드리지 않습니다. */
export const V24_REQUIRED_TYPES: Omit<OfferingType, 'id' | 'sortOrder'>[] = [
  { name: '구제헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 30000, 50000, 100000], isActive: true },
  { name: '특별헌금', displayArea: 'DROPDOWN', quickAmounts: [], isActive: true },
];

/**
 * v2.14 1회 보정: 구제헌금(기본 나열 + 금액 단추)·특별헌금(기타 드롭다운)이 없으면 목록 맨 뒤에 추가합니다.
 * 교회가 이미 같은 이름으로 만들어 쓰는 종류는 설정을 존중해 그대로 둡니다. 추가할 것이 없으면 null.
 */
export function migrateOfferingTypesV24(types: readonly OfferingType[]): OfferingType[] | null {
  const have = new Set(types.map((t) => t.name));
  const missing = V24_REQUIRED_TYPES.filter((t) => !have.has(t.name));
  if (missing.length === 0) return null;
  let order = types.reduce((max, t) => Math.max(max, t.sortOrder), 0);
  return [...types, ...missing.map((t) => ({ ...t, quickAmounts: [...t.quickAmounts], id: newId(), sortOrder: ++order }))];
}
