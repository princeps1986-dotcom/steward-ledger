// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentUser } from '../services/auth/currentUser';
import type { Role } from '../services/auth/roles';
import type { DesktopApi } from '../services/desktopBridge';
import { pageAllowed, useAppNav, visiblePages } from './useAppShell';

const login = (role: Role | null) => {
  window.desktop = {} as DesktopApi;
  setCurrentUser(role ? { email: 'a@b.c', role } : null);
};
const keys = () => visiblePages().map((p) => p.key);

afterEach(() => {
  delete window.desktop;
  setCurrentUser(null);
});

describe('역할별 메뉴', () => {
  it('브라우저(시연) 모드와 관리자·재정담당은 모든 메뉴를 본다', () => {
    expect(keys()).toEqual(['input', 'reports', 'members', 'offerings', 'settings', 'help']);
    login('admin');
    expect(keys()).toEqual(['input', 'reports', 'members', 'offerings', 'settings', 'help']);
    login('finance');
    expect(keys()).toEqual(['input', 'reports', 'members', 'offerings', 'settings', 'help']);
  });

  it('열람자는 보고서·설정·설명서만 본다', () => {
    login('viewer');
    expect(keys()).toEqual(['reports', 'settings', 'help']);
    expect(pageAllowed('input')).toBe(false);
    expect(pageAllowed('members')).toBe(false);
  });

  it('열람자는 보고서 화면으로 시작하고, 허용되지 않은 페이지로는 이동할 수 없다(직접 여는 경로 차단)', () => {
    login('viewer');
    const { result } = renderHook(() => useAppNav());
    expect(result.current.page).toBe('reports');
    act(() => result.current.setPage('input'));
    expect(result.current.page).toBe('reports');
    act(() => result.current.setPage('members'));
    expect(result.current.page).toBe('reports');
    act(() => result.current.setPage('help'));
    expect(result.current.page).toBe('help');
  });

  it('재정담당·관리자는 헌금 입력 화면으로 시작한다', () => {
    login('finance');
    expect(renderHook(() => useAppNav()).result.current.page).toBe('input');
  });

  it('역할이 없는 PC앱(로그인 전)은 설정·설명서만 열린다', () => {
    login(null);
    expect(keys()).toEqual(['settings', 'help']);
  });
});
