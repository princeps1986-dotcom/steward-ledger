import { useCallback, useEffect, useRef, useState } from 'react';
import { useDemoActive, useDemoCreating } from '../services/demo/demoState';
import { useDonationYears } from '../contexts/DonationContext';
import { useMembers } from '../contexts/MemberContext';
import { useSettings, useSettingsActions, useSettingsSelector } from '../contexts/SettingsContext';
import { interruptedRestore } from '../services/backup/streamRestore';
import { buildAutoBackup, PERIODIC_BACKUP_INTERVAL_MS, runPeriodicBackup } from '../services/backup/autoBackupService';
import { saveBackupFile } from '../services/backup/backupService';
import { isRestoring } from '../services/backup/backupBusy';
import { formatDateTime } from '../services/domain/dates';
import { allowed } from '../services/auth/access';
import { setClosingNotice, useClosingNotice } from '../services/auth/closing';
import type { Action } from '../services/auth/roles';
import { desktop } from '../services/desktopBridge';

export type PageKey = 'input' | 'members' | 'offerings' | 'reports' | 'settings' | 'admin' | 'help';

export const PAGES: { key: PageKey; label: string }[] = [
  { key: 'input', label: '헌금 입력' },
  { key: 'reports', label: '보고서' },
  { key: 'members', label: '성도 정보' },
  { key: 'offerings', label: '헌금 종류' },
  { key: 'settings', label: '설정 정보' },
  { key: 'admin', label: '관리' },
  { key: 'help', label: '설명서' },
];

/** 메뉴(페이지)마다 필요한 권한. 설정·설명서는 모두에게 열리고(설정은 화면 안에서 역할별로 줄임), 나머지는 역할 표(roles.ts)를 따릅니다. */
const PAGE_ACTION: Record<PageKey, Action | null> = { input: 'donation:write', reports: 'report:summary', members: 'catalog:edit', offerings: 'catalog:edit', settings: null, admin: 'admin:tab', help: null };
// 관리자 탭은 계정이 있는 PC앱에만 있습니다(브라우저 시연 모드는 관리자와 같은 권한이지만 계정이 없음).
export const pageAllowed = (key: PageKey): boolean => (key === 'admin' && !desktop() ? false : PAGE_ACTION[key] === null || allowed(PAGE_ACTION[key]));
/** 지금 역할이 볼 수 있는 메뉴 */
export const visiblePages = (): typeof PAGES => PAGES.filter((p) => pageAllowed(p.key));

export function useAppNav() {
  const [page, setRawPage] = useState<PageKey>(() => visiblePages()[0]?.key ?? 'help');
  // 허용되지 않은 페이지로는 이동하지 않고, 어떻게든 들어오더라도 그리지 않고 첫 메뉴로 돌립니다(직접 여는 경로 차단).
  const setPage = (key: PageKey): void => {
    if (pageAllowed(key)) setRawPage(key);
  };
  return { page: pageAllowed(page) ? page : (visiblePages()[0]?.key ?? 'help'), setPage };
}

/**
 * Electron 자동 백업 연동
 * - 종료 직전 main의 요청에 백업 내용을 응답
 * - 시작 시 지난 종료의 자동 백업 결과를 반영(성공 → 마지막 백업 시각 갱신, 실패 → 경고)
 */
export type AutoSaveStatus = { state: 'saving' } | { state: 'done'; at: string } | null;

export function useAutoBackupBridge(): { failure: string | null; closing: boolean; skipBackup(): void; autoSave: AutoSaveStatus } {
  const settings = useSettings();
  const loaded = useSettingsSelector((s) => s.loaded);
  const { markBackupDone, update } = useSettingsActions();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [failure, setFailure] = useState<string | null>(null);
  const [autoSave, setAutoSave] = useState<AutoSaveStatus>(null);
  // 종료 중 자동 백업을 만드는 동안 true: 화면을 덮는 안내를 보여 주고 백업이 끝나면 앱이 종료됩니다(잠금 화면도 같은 값을 읽음).
  const closing = useClosingNotice();

  useEffect(() => {
    const api = desktop();
    if (!api) return;
    const offRequest = api.onBackupRequest(async () => {
      // 백업 파일 확인·복원 중에는 창을 닫지 않습니다(main이 '복원하고 있습니다' 안내만 띄움).
      if (isRestoring()) return { blocked: true as const };
      setClosingNotice(true);
      return buildAutoBackup();
    });
    const offCancel = api.onBackupCancelled(() => setClosingNotice(false));
    return () => {
      offRequest();
      offCancel();
    };
  }, []);

  // 앱을 쓰는 동안 변경이 있으면 10분마다 백업합니다(진행은 작은 표시로 알림)(종료 때 한 번뿐이면 비정상 종료 시 그날 입력분을 잃을 수 있음).
  useEffect(() => {
    if (!desktop() || !loaded) return;
    let hideTimer: number | undefined;
    const tick = async (): Promise<void> => {
      setAutoSave({ state: 'saving' });
      try {
        const res = await runPeriodicBackup(settingsRef.current);
        if (res) {
          // 바뀐 연도만 담은 10분 백업은 '마지막 전체 백업' 시각을 바꾸지 않습니다. 바뀐 연도를 몰라 전체를 담았을 때만 갱신합니다.
          if (res.full) await markBackupDone();
          setFailure((f) => (f?.startsWith('주기 백업') ? null : f));
          setAutoSave({ state: 'done', at: new Date().toISOString() });
          window.clearTimeout(hideTimer);
          hideTimer = window.setTimeout(() => setAutoSave(null), 6000); // 완료 표시는 잠시 보여 주고 사라집니다.
        } else {
          setAutoSave(null); // 변경이 없어 할 일이 없었음
        }
      } catch (e) {
        setAutoSave(null);
        setFailure(`주기 백업에 실패했습니다 (${formatDateTime(new Date().toISOString())}): ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    const timer = window.setInterval(() => void tick(), PERIODIC_BACKUP_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(hideTimer);
    };
  }, [loaded, markBackupDone]);

  useEffect(() => {
    const api = desktop();
    if (!api || !loaded) return;
    void (async () => {
      const status = await api.getAutoBackupStatus();
      if (!status) return;
      if (status.ok) {
        const last = settingsRef.current.lastBackupAt;
        // 정상적으로 성공한 종료 백업 시각만 남깁니다(실패·백업 없이 종료는 ok가 아님). 종료 백업은 전체이므로 더 새로우면 전체 백업 시각도 함께, 한 번에 씁니다.
        await update({ lastCloseBackupAt: status.at, ...(!last || status.at > last ? { lastBackupAt: status.at } : {}) });
      } else {
        setFailure(`지난 종료 시 자동 백업에 실패했습니다 (${formatDateTime(status.at)}): ${status.error ?? '알 수 없는 오류'}`);
      }
      await api.ackAutoBackupStatus();
    })();
  }, [loaded, update]);

  // 지난 복원이 끝나지 않고 중단됐는지 시작할 때 한 번 알려 줍니다(같은 백업으로 다시 복원하면 됨).
  useEffect(() => {
    if (!loaded) return;
    void interruptedRestore()
      .then((m) => m && setFailure(m.kind === 'demo' ? `시연 데이터 생성이 끝나지 않고 중단되었습니다(${formatDateTime(m.startedAt)}). 설정에서 [시연 데이터 제거]로 정리하세요.` : `지난 복원(${m.years.join(', ')}년)이 끝나지 않고 중단되었습니다(${formatDateTime(m.startedAt)}). 데이터가 일부만 복원되었을 수 있습니다. 설정에서 같은 백업 파일로 다시 복원하세요.`))
      .catch(() => setFailure('지난 복원이 끝까지 되었는지 확인하지 못했습니다. 필요하면 설정에서 같은 백업 파일로 다시 복원하세요.'));
  }, [loaded]);

  const skipBackup = useCallback(() => desktop()?.skipBackup(), []);
  return { failure, closing, skipBackup, autoSave };
}

/** 백업 권고 배너 */
export function useBackupReminder(autoBackupFailure: string | null, goSettings: () => void) {
  const settings = useSettings();
  const loaded = useSettingsSelector((s) => s.loaded);
  const { markBackupDone } = useSettingsActions();
  const years = useDonationYears();
  const members = useMembers();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  // 시연 중에는 백업을 권하지 않고 [지금 백업]도 없습니다(시연 데이터는 백업하지 않음).
  const demoActive = useDemoActive();
  const demoCreating = useDemoCreating() !== null;
  const demoBlocked = demoActive || demoCreating;

  let text: string | null = null;
  let tone: 'warn' | 'error' = 'warn';
  if (autoBackupFailure) {
    text = autoBackupFailure;
    tone = 'error';
  } else if (demoBlocked) {
    text = null;
  } else if (desktop() && allowed('backup:create') && loaded && !settings.lastBackupAt && (years.length > 0 || members.length > 0)) {
    text = '아직 백업한 적이 없습니다. 데이터 보호를 위해 백업 파일을 만들어 두세요.';
  }

  const backupNow = useCallback(async () => {
    // 데스크톱 앱의 직접 백업은 사용자가 정한 암호가 필요하므로 설정 정보의 [백업 파일 저장]으로 안내합니다.
    if (desktop()) return goSettings();
    setBusy(true);
    try {
      // 'backup_날짜_시각'은 종료 백업 이름이라 최근 10개만 남기고 지워지므로 직접 백업은 다른 이름으로 저장합니다.
      await saveBackupFile('backup_manual');
      await markBackupDone();
      setDismissed(true);
    } catch {
      // 저장 창에서 취소했거나 저장에 실패하면 백업한 것으로 기록하지 않고 안내 배너를 그대로 둡니다.
    } finally {
      setBusy(false);
    }
  }, [markBackupDone, goSettings]);

  return { visible: !!text && !dismissed, text, tone, busy, canBackup: !demoBlocked, backupNow, dismiss: () => setDismissed(true) };
}
