import { describe, expect, it } from 'vitest';
import { ACTIONS, can, type Action, type Role } from './roles';

// 계획 문서의 역할 표를 그대로 옮긴 기대값(관리자·재정담당·열람자 순). 정책을 바꾸면 이 표와 문서를 함께 고쳐야 합니다.
const EXPECTED: Record<Action, [boolean, boolean, boolean]> = {
  'donation:write': [true, true, false],
  'donation:bulkDelete': [true, false, false],
  'catalog:edit': [true, true, false],
  'year:lock': [true, true, false],
  'year:unlock': [true, false, false],
  'report:summary': [true, true, true],
  'report:list': [true, true, false],
  'report:personal': [true, true, false],
  'report:audit': [true, true, false],
  'report:print': [true, true, true],
  'backup:create': [true, true, false],
  'backup:restore': [true, false, false],
  'data:reset': [true, false, false],
  'settings:full': [true, true, false],
  'theme:change': [true, true, true],
  'update:check': [true, true, false],
  'accounts:manage': [true, false, false],
  'admin:tab': [true, false, false],
};
const ROLE_ORDER: Role[] = ['admin', 'finance', 'viewer'];

describe('역할 권한 표(can)', () => {
  it('모든 작업이 기대 표에 있다(표에 없는 작업이 생기면 실패)', () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(ACTIONS)('%s: 역할별 허용이 표와 같다', (action) => {
    expect(ROLE_ORDER.map((r) => can(r, action))).toEqual(EXPECTED[action]);
  });

  it('로그인하지 않았거나 모르는 역할은 모두 거절한다', () => {
    for (const a of ACTIONS) {
      expect(can(null, a)).toBe(false);
      expect(can(undefined, a)).toBe(false);
      expect(can('guest' as Role, a)).toBe(false);
    }
  });

  it('열람자는 종합보고서·인쇄·테마만 쓸 수 있다', () => {
    expect(ACTIONS.filter((a) => can('viewer', a)).sort()).toEqual(['report:print', 'report:summary', 'theme:change']);
  });
});
