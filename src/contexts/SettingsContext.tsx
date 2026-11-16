import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createContext, useContextSelector } from 'use-context-selector';
import { migrateSettingsV22 } from '../services/domain/migrations';
import { applyTheme } from '../services/theme';
import { clearDirty, KEYS, transact, type Write } from '../services/storage/storageService';
import { subscribeExternalChanges } from '../services/storage/tabSyncChannel';
import { DEFAULT_SETTINGS, type AppSettings, type FontScale } from './types';

interface SettingsActions {
  update(patch: Partial<AppSettings>): Promise<void>;
  /** 백업 성공 기록: 마지막 백업 시각 갱신 + 변경 플래그 해제 */
  markBackupDone(at?: string): Promise<void>;
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  actions: SettingsActions;
}

const FONT_SCALE_PERCENT: Record<FontScale, string> = { NORMAL: '', LARGE: '112.5%', XLARGE: '125%' };

const SettingsCtx = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    // v2.2 1회 보정: 큰 금액 확인 기준이 이전 기본값(1억 원) 그대로면 새 기본값(1천만 원)으로 변경
    const { result: s } = await transact<Partial<AppSettings> | null>(async (read) => {
      const stored = await read<Partial<AppSettings>>(KEYS.settings);
      if ((await read<boolean>(KEYS.migrationSettingsV22)) === true) return { writes: [], result: stored };
      const migrated = migrateSettingsV22(stored);
      const writes: Write[] = [{ key: KEYS.migrationSettingsV22, value: true }];
      if (migrated) writes.push({ key: KEYS.settings, value: migrated });
      return { writes, result: migrated ?? stored };
    });
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

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    const { result } = await transact(async (read) => {
      const cur = { ...DEFAULT_SETTINGS, ...((await read<Partial<AppSettings>>(KEYS.settings)) ?? {}) };
      const next = { ...cur, ...patch };
      return { writes: [{ key: KEYS.settings, value: next }], result: next };
    });
    setSettings(result);
  }, []);

  const markBackupDone = useCallback(
    async (at = new Date().toISOString()) => {
      await update({ lastBackupAt: at });
      await clearDirty();
    },
    [update],
  );

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
