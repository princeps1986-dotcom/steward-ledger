// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppProviders } from '../../contexts/AppProviders';
import { setCurrentUser } from '../../services/auth/currentUser';
import type { Role } from '../../services/auth/roles';
import type { DesktopApi } from '../../services/desktopBridge';
import { db } from '../../services/storage/db';
import { ReportsPage } from './reports/ReportsPage';
import { SettingsPage } from './settings/SettingsPage';

/** PC앱을 흉내 낸 가짜 desktop: on…은 구독 해제 함수를, 나머지는 null로 끝나는 비동기 함수를 돌려줍니다. */
const fakeDesktop = new Proxy({}, { get: (_t, name: string) => (name.startsWith('on') ? () => () => undefined : async () => null) }) as DesktopApi;
const login = (role: Role) => {
  window.desktop = fakeDesktop;
  setCurrentUser({ email: 'a@b.c', role });
};
const renderPage = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);

beforeEach(async () => {
  // jsdom에는 ResizeObserver가 없어(보고서의 스크롤 측정이 씀) 아무 일도 하지 않는 것으로 대신합니다.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await db.kv.clear();
  await db.donations.clear();
  await db.audits.clear();
});
afterEach(() => {
  cleanup();
  delete window.desktop;
  setCurrentUser(null);
});

describe('역할별 보고서 탭', () => {
  const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

  it.each<Role>(['admin', 'finance'])('%s는 네 탭을 모두 본다', async (role) => {
    login(role);
    renderPage(<ReportsPage />);
    expect(tabNames()).toEqual(['종합 보고서', '전체 입력 내역', '개인별·대표자별 내역', '수정·삭제 이력']);
  });

  it('열람자는 종합 보고서 탭만 본다', async () => {
    login('viewer');
    renderPage(<ReportsPage />);
    expect(tabNames()).toEqual(['종합 보고서']);
    expect(screen.queryByText('수정·삭제 이력')).toBeNull();
  });

  it('브라우저(시연) 모드는 네 탭을 모두 본다', () => {
    renderPage(<ReportsPage />);
    expect(tabNames()).toHaveLength(4);
  });
});

describe('브라우저(시연) 모드는 PC앱 전용 항목이 없다', () => {
  const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

  it('수정·삭제 이력 탭에 작업자 열이 없고, PC앱에는 있다', () => {
    renderPage(<ReportsPage />);
    fireEvent.click(screen.getByRole('tab', { name: '수정·삭제 이력' }));
    expect(headers()).toEqual(['작업 일시', '유형', '사유', '변경 전', '변경 후']);
    cleanup();
    login('admin');
    renderPage(<ReportsPage />);
    fireEvent.click(screen.getByRole('tab', { name: '수정·삭제 이력' }));
    expect(headers()).toContain('작업자');
  });

  it('설정 화면에 연도 잠금·기간 헌금 삭제가 없고 기존 영역은 그대로 있다', async () => {
    renderPage(<SettingsPage />);
    expect(await screen.findByRole('button', { name: '백업 파일 저장' })).toBeTruthy();
    expect(screen.queryByText('연도 잠금')).toBeNull();
    expect(screen.queryByText('기간 헌금 삭제')).toBeNull();
    for (const name of ['백업 파일 복원', '전체 초기화', '시연 데이터 생성']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });
});

describe('역할별 설정 화면', () => {
  const has = (name: string | RegExp) => screen.queryByRole('button', { name }) !== null;

  it('관리자는 백업·복원·업데이트·전체 초기화를 모두 본다', async () => {
    login('admin');
    renderPage(<SettingsPage />);
    expect(await screen.findByRole('button', { name: '백업 파일 저장' })).toBeTruthy();
    expect(has('백업 파일 복원')).toBe(true);
    expect(has('전체 초기화')).toBe(true);
    expect(has('시연 데이터 생성')).toBe(true);
    expect(has('업데이트 확인')).toBe(true);
    expect(screen.getByText('연도 잠금')).toBeTruthy();
    expect(screen.queryByText('기간 헌금 삭제')).toBeNull(); // 관리자 탭으로 옮김
  });

  it('재정담당은 백업 저장·업데이트는 보지만 복원·전체 초기화·시연 데이터는 보지 못한다', async () => {
    login('finance');
    renderPage(<SettingsPage />);
    expect(await screen.findByRole('button', { name: '백업 파일 저장' })).toBeTruthy();
    expect(has('업데이트 확인')).toBe(true);
    expect(has('백업 파일 복원')).toBe(false);
    expect(has('전체 초기화')).toBe(false);
    expect(has('시연 데이터 생성')).toBe(false);
    expect(screen.getByText('연도 잠금')).toBeTruthy(); // 잠그기는 재정담당도
    expect(screen.queryByText('기간 헌금 삭제')).toBeNull(); // 일괄 삭제는 관리자만
  });

  it('열람자는 화면 테마만 바꿀 수 있고 백업·복원·업데이트·초기화는 모두 보이지 않는다', async () => {
    login('viewer');
    renderPage(<SettingsPage />);
    expect(await screen.findByText('화면 테마')).toBeTruthy();
    expect(screen.getByText(/인쇄 양식 색상/)).toBeTruthy();
    expect(screen.queryByText('연도 잠금')).toBeNull();
    for (const name of ['백업 파일 저장', '백업 파일 복원', '전체 초기화', '시연 데이터 생성', '업데이트 확인', '설정 저장']) expect(has(name)).toBe(false);
  });
});
