import type { AppTheme, PrintTheme } from '../contexts/types';

export interface ThemeOption<T extends string> {
  value: T;
  label: string;
  desc: string;
  /** 미리보기 색 점: 상단 바 · 바탕 · 강조 */
  swatch: [string, string, string];
}

/** 화면 테마. 실제 색은 index.css의 `:root[data-theme]` 변수에 있고 여기는 설정 화면 표시용입니다. */
export const THEME_OPTIONS: ThemeOption<AppTheme>[] = [
  { value: 'BLUE', label: '차분한 블루', desc: '기본. 정돈된 청회색 바탕', swatch: ['#1f2f46', '#f3f5f9', '#2457c5'] },
  { value: 'WARM', label: '밝고 따뜻한', desc: '크림색 바탕에 테라코타 강조', swatch: ['#b4532a', '#fff7ee', '#b4532a'] },
  { value: 'CALM', label: '눈이 편안한', desc: '반사광을 줄인 연한 회녹색', swatch: ['#47594f', '#e9eee6', '#3b7366'] },
  { value: 'DARK', label: '어두운', desc: '어두운 바탕, 밤·어두운 방에서', swatch: ['#0f1522', '#171d2b', '#5b86ef'] },
];

/** 인쇄 양식 색상. 흑백이 기본이고 나머지는 화면 테마의 색 계열을 옅게 사용합니다. */
export const PRINT_THEME_OPTIONS: ThemeOption<PrintTheme>[] = [
  { value: 'MONO', label: '흑백', desc: '기본. 잉크 절약, 복사에 유리', swatch: ['#111111', '#ffffff', '#d1d5db'] },
  { value: 'BLUE', label: '차분한 블루', desc: '옅은 파랑 머리글', swatch: ['#1f2f46', '#dbe5fb', '#2457c5'] },
  { value: 'WARM', label: '밝고 따뜻한', desc: '옅은 살구색 머리글', swatch: ['#7a3719', '#fde4cb', '#b4532a'] },
  { value: 'CALM', label: '눈이 편안한', desc: '옅은 회녹색 머리글', swatch: ['#2f4a40', '#d9e2d5', '#3b7366'] },
];

const STORAGE_KEY = 'church-ledger-theme';

/** 루트 요소의 data 속성으로 테마를 적용합니다(색은 CSS 변수). 다음 실행의 깜빡임을 막으려고 localStorage에도 기록합니다. */
export function applyTheme(theme: AppTheme, printTheme: PrintTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.printTheme = printTheme;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, printTheme }));
  } catch {
    /* 저장소를 쓸 수 없어도 이번 실행의 적용에는 영향 없음 */
  }
}

/** 설정이 로드되기 전에 마지막 테마를 먼저 적용해 첫 화면의 색 깜빡임을 줄입니다. */
export function applyStoredTheme(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as { theme?: string; printTheme?: string };
    if (v.theme && THEME_OPTIONS.some((o) => o.value === v.theme)) document.documentElement.dataset.theme = v.theme;
    if (v.printTheme && PRINT_THEME_OPTIONS.some((o) => o.value === v.printTheme)) document.documentElement.dataset.printTheme = v.printTheme;
  } catch {
    /* 무시: 기본 테마로 시작 */
  }
}
