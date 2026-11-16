import { useCallback, useEffect, useRef, useState } from 'react';
import { useDonationYears } from '../contexts/DonationContext';
import { useMembers } from '../contexts/MemberContext';
import { useSettings, useSettingsActions, useSettingsSelector } from '../contexts/SettingsContext';
import { buildAutoBackup } from '../services/backup/autoBackupService';
import { saveBackupFile } from '../services/backup/backupService';
import { formatDateTime } from '../services/domain/dates';
import { desktop } from '../services/desktopBridge';

export type PageKey = 'input' | 'members' | 'offerings' | 'reports' | 'settings' | 'help';

export const PAGES: { key: PageKey; label: string }[] = [
  { key: 'input', label: '헌금 입력' },
  { key: 'reports', label: '보고서' },
  { key: 'members', label: '성도 정보' },
  { key: 'offerings', label: '헌금 종류' },
  { key: 'settings', label: '설정 정보' },
  { key: 'help', label: '사용 설명서' },
];

export function useAppNav() {
  const [page, setPage] = useState<PageKey>('input');
  return { page, setPage };
}

/**
 * Electron 자동 백업 연동
 * - 종료 직전 main의 요청에 백업 내용을 응답
 * - 시작 시 지난 종료의 자동 백업 결과를 반영(성공 → 마지막 백업 시각 갱신, 실패 → 경고)
 */
export function useAutoBackupBridge(): { failure: string | null; closing: boolean; skipBackup(): void } {
  const settings = useSettings();
  const loaded = useSettingsSelector((s) => s.loaded);
  const { markBackupDone } = useSettingsActions();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [failure, setFailure] = useState<string | null>(null);
  // 종료 중 자동 백업을 만드는 동안 true: 화면을 덮는 안내를 보여 주고 백업이 끝나면 앱이 종료됩니다.
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const api = desktop();
    if (!api) return;
    const offRequest = api.onBackupRequest(async () => {
      setClosing(true);
      return buildAutoBackup(settingsRef.current);
    });
    const offCancel = api.onBackupCancelled(() => setClosing(false));
    return () => {
      offRequest();
      offCancel();
    };
  }, []);

  useEffect(() => {
    const api = desktop();
    if (!api || !loaded) return;
    void (async () => {
      const status = await api.getAutoBackupStatus();
      if (!status) return;
      if (status.ok) {
        const last = settingsRef.current.lastBackupAt;
        if (!last || status.at > last) await markBackupDone(status.at);
      } else {
        setFailure(`지난 종료 시 자동 백업에 실패했습니다 (${formatDateTime(status.at)}): ${status.error ?? '알 수 없는 오류'}`);
      }
      await api.ackAutoBackupStatus();
    })();
  }, [loaded, markBackupDone]);

  const skipBackup = useCallback(() => desktop()?.skipBackup(), []);
  return { failure, closing, skipBackup };
}

const DAY = 24 * 60 * 60 * 1000;

/** 백업 권고 배너 */
export function useBackupReminder(autoBackupFailure: string | null) {
  const settings = useSettings();
  const loaded = useSettingsSelector((s) => s.loaded);
  const { markBackupDone } = useSettingsActions();
  const years = useDonationYears();
  const members = useMembers();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  let text: string | null = null;
  let tone: 'warn' | 'error' = 'warn';
  if (autoBackupFailure) {
    text = autoBackupFailure;
    tone = 'error';
  } else if (loaded && !settings.lastBackupAt && (years.length > 0 || members.length > 0)) {
    text = '아직 백업한 적이 없습니다. 데이터 보호를 위해 백업 파일을 만들어 두세요.';
  } else if (settings.lastBackupAt) {
    const days = Math.floor((Date.now() - Date.parse(settings.lastBackupAt)) / DAY);
    if (days >= settings.backupReminderDays) text = `마지막 백업 후 ${days}일이 지났습니다. 백업을 권장합니다.`;
  }

  const backupNow = useCallback(async () => {
    setBusy(true);
    try {
      await saveBackupFile('backup');
      await markBackupDone();
      setDismissed(true);
    } catch {
      // 저장 창에서 취소했거나 저장에 실패하면 백업한 것으로 기록하지 않고 안내 배너를 그대로 둡니다.
    } finally {
      setBusy(false);
    }
  }, [markBackupDone]);

  return { visible: !!text && !dismissed, text, tone, busy, backupNow, dismiss: () => setDismissed(true) };
}
