import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createContext, useContextSelector } from 'use-context-selector';
import { assertAllowed } from '../services/auth/access';
import { applyTheme } from '../services/theme';
import { getItem, KEYS, transact } from '../services/storage/storageService';
import { subscribeExternalChanges } from '../services/storage/tabSyncChannel';
import { DEFAULT_SETTINGS, type AppSettings, type FontScale } from './types';

interface SettingsActions {
  /** 함수로 주면 저장된 최신 설정(cur)으로 고칠 값을 만듭니다(목록·객체 값을 낡은 화면 값으로 덮어쓰지 않게). */
  update(patch: Partial<AppSettings> | ((cur: AppSettings) => Partial<AppSettings>)): Promise<void>;
  /** 백업 성공 기록: 마지막 백업 시각만 갱신합니다(변경 표시는 백업이 직접 관리). */
  markBackupDone(at?: string): Promise<void>;
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  actions: SettingsActions;
}

const FONT_SCALE_PERCENT: Record<FontScale, string> = { SMALL: '87.5%', NORMAL: '', LARGE: '112.5%', XLARGE: '125%' };

const SettingsCtx = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
        const s = await getItem<Partial<AppSettings>>(KEYS.settings);
    setSettings({ ...DEFAULT_SETTINGS, ...(s ?? {}) });
    setLoaded(true);
  }, []);

  // 화면 글자 크기: 루트 글자 크기를 바꾸면 rem 기반인 전체 화면이 함께 커집니다.
  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SCALE_PERCENT[settings.fontScale] ?? '';
  }, [settings.fontScale]);

  // 화면 테마·인쇄 양식 색상: 루트 data 속성으로 적용(색은 index.css의 CSS 변수)
  useEffect(() => {
    applyTheme(settings.theme, settings.printTheme);
  }, [settings.theme, settings.printTheme]);

  useEffect(() => {
    void load();
    return subscribeExternalChanges((keys) => {
      if (keys.includes(KEYS.settings)) void load();
    });
  }, [load]);

  const update = useCallback(async (change: Partial<AppSettings> | ((cur: AppSettings) => Partial<AppSettings>)) => {
    const { result } = await transact(async (read) => {
      const cur = { ...DEFAULT_SETTINGS, ...((await read<Partial<AppSettings>>(KEYS.settings)) ?? {}) };
      const patch = typeof change === 'function' ? change(cur) : change;
      const next = { ...cur, ...patch };
      // 연도 잠금: 걸기는 관리자·재정담당, 풀기는 관리자만(화면을 우회해도 막음)
      if (patch.lockedYears) {
        if (patch.lockedYears.some((y) => !cur.lockedYears.includes(y))) assertAllowed('year:lock');
        if (cur.lockedYears.some((y) => !patch.lockedYears!.includes(y))) assertAllowed('year:unlock');
      }
      return { writes: [{ key: KEYS.settings, value: next }], result: next };
    });
    setSettings(result);
  }, []);

  // 변경 표시는 백업이 직접 내립니다(백업 전에 내려야 백업하는 동안의 변경이 다음 백업에 담김).
  const markBackupDone = useCallback((at = new Date().toISOString()) => update({ lastBackupAt: at }), [update]);

  const actions = useMemo(() => ({ update, markBackupDone }), [update, markBackupDone]);
  const value = useMemo(() => ({ settings, loaded, actions }), [settings, loaded, actions]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettingsSelector<T>(selector: (s: SettingsState) => T): T {
  return useContextSelector(SettingsCtx, (s) => {
    if (!s) throw new Error('SettingsProvider가 필요합니다.');
    return selector(s);
  });
}

export const useSettings = () => useSettingsSelector((s) => s.settings);
export const useSettingsActions = () => useSettingsSelector((s) => s.actions);
