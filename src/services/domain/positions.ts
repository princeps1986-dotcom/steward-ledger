/** 성도 등록·수정 시 선택하는 직분 목록 (선택하지 않으면 직분 없음) */
export const POSITIONS = ['목사', '전도사', '집사', '권사'] as const;
/** 직분 없음 (v2.15: '성도'는 직분이 아니므로 기본값은 빈 값) */
export const DEFAULT_POSITION = '';

/** 이전 버전에서 기본값으로 저장된 '성도'는 직분 없음으로 취급합니다. */
export function normalizePosition(p: string | undefined | null): string {
  const t = (p ?? '').trim();
  return t === '성도' ? '' : t;
}

/**
 * 선택 목록 항목. 이전 버전·명단 가져오기로 등록되어 목록에 없는 직분(예: 장로)은
 * 값이 유실되지 않도록 마지막 항목으로 함께 노출합니다.
 */
export function positionOptions(current: string): string[] {
  const c = normalizePosition(current);
  return c && !(POSITIONS as readonly string[]).includes(c) ? [...POSITIONS, c] : [...POSITIONS];
}

/** 직분이 '성도'인 성도를 직분 없음으로 바꾼 새 목록 (바꿀 것이 없으면 null) */
export function clearLegacyPosition<T extends { position: string }>(members: readonly T[]): T[] | null {
  if (!members.some((m) => m.position.trim() === '성도')) return null;
  return members.map((m) => (m.position.trim() === '성도' ? { ...m, position: '' } : m));
}
