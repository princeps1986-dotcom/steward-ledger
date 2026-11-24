// 역할별 권한 표(docs/plans/권한-체계-계획.md 2장). 역할 제한은 앱 안의 규칙입니다: main이 실제로 막는 것은 계정·역할 관리뿐이고
// (electron/userStore.cjs), 헌금 쓰기·복원·초기화는 렌더러의 저장소 작업이라 화면에서 숨기고 막는 규칙입니다.

export type Role = 'admin' | 'finance' | 'viewer';
export const ROLES: readonly Role[] = ['admin', 'finance', 'viewer'];

const ALL: readonly Role[] = ['admin', 'finance', 'viewer'];
const STAFF: readonly Role[] = ['admin', 'finance'];
const ADMIN: readonly Role[] = ['admin'];

/** 작업 → 허용 역할. 새 작업은 여기에 한 줄을 더하면 can()과 시험 표가 함께 따라갑니다. */
const ALLOWED = {
  'donation:write': STAFF, // 헌금 입력·수정·건별 삭제
  'donation:bulkDelete': ADMIN, // 기간 일괄 삭제
  'catalog:edit': STAFF, // 성도·헌금 종류 편집
  'year:lock': STAFF,
  'year:unlock': ADMIN,
  'report:summary': ALL, // 종합보고서 탭
  'report:list': STAFF, // 전체 입력 내역 탭
  'report:personal': STAFF, // 개인별/세대별 탭
  'report:audit': STAFF, // 수정·삭제 이력 탭
  'report:print': ALL, // 인쇄·PDF(종합보고서 탭에만 있음)
  'backup:create': STAFF,
  'backup:restore': ADMIN,
  'data:reset': ADMIN,
  'settings:full': STAFF, // 설정 화면 전체(열람자는 화면 테마만)
  'theme:change': ALL,
  'update:check': STAFF,
  'accounts:manage': ADMIN, // 계정·역할 관리
  'admin:tab': ADMIN,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof ALLOWED;
export const ACTIONS = Object.keys(ALLOWED) as Action[];

/** 로그인하지 않았거나(role이 null) 모르는 역할이면 모두 거절합니다. */
export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && (ALLOWED[action] as readonly Role[]).includes(role);
}
