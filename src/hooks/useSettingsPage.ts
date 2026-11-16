import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { useDonationActions } from '../contexts/DonationContext';
import { useMemberActions } from '../contexts/MemberContext';
import { useOfferingActions } from '../contexts/OfferingTypeContext';
import { useSettings, useSettingsActions } from '../contexts/SettingsContext';
import type { AppTheme, BackupEnvelope, FontScale, PrintTheme } from '../contexts/types';
import { PRINT_THEME_OPTIONS, THEME_OPTIONS } from '../services/theme';
import { formatAmountInput, formatNumber, parseAmount } from '../services/domain/amount';
import { formatDateTime } from '../services/domain/dates';
import { downloadBackup, replaceAllData } from '../services/backup/backupService';
import { parseAndValidateBackup } from '../services/backup/validation';
import { desktop } from '../services/desktopBridge';
import { isValidEmail } from '../services/excel/mailtoProtocol';

interface RestoreCandidate {
  envelope: BackupEnvelope;
  fileName: string;
  migratedFrom: number | null;
  summary: string;
}

export function useSettingsPage() {
  const settings = useSettings();
  const { update, markBackupDone } = useSettingsActions();
  const memberActions = useMemberActions();
  const offeringActions = useOfferingActions();
  const donationActions = useDonationActions();

  const [email, setEmail] = useState(settings.recipientEmail);
  const [threshold, setThreshold] = useState(formatNumber(settings.largeAmountThreshold));
  const [reminderDays, setReminderDays] = useState(String(settings.backupReminderDays));
  const [defaultDir, setDefaultDir] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [restore, setRestore] = useState<RestoreCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const isDesktop = !!desktop();

  useEffect(() => {
    setEmail(settings.recipientEmail);
    setThreshold(formatNumber(settings.largeAmountThreshold));
    setReminderDays(String(settings.backupReminderDays));
  }, [settings.recipientEmail, settings.largeAmountThreshold, settings.backupReminderDays]);

  useEffect(() => {
    void desktop()?.getDefaultBackupDir().then(setDefaultDir);
  }, []);

  const saveGeneral = useCallback(async () => {
    if (email.trim() && !isValidEmail(email)) return setMessage({ kind: 'error', text: '메일 주소 형식이 올바르지 않습니다.' });
    const t = parseAmount(threshold);
    if (t.kind !== 'ok') return setMessage({ kind: 'error', text: '큰 금액 확인 기준을 입력하세요.' });
    const days = Number(reminderDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) return setMessage({ kind: 'error', text: '백업 권고 주기는 1~365일입니다.' });
    await update({ recipientEmail: email.trim(), largeAmountThreshold: t.value, backupReminderDays: days });
    setMessage({ kind: 'info', text: '설정을 저장했습니다.' });
  }, [email, threshold, reminderDays, update]);

  /** 저장 시 정규화되는 값(공백 제거·앞자리 0·쉼표)은 정규화한 뒤 비교해, 저장 후에도 변경으로 남지 않게 합니다. */
  function isGeneralDirty(): boolean {
    const t = parseAmount(threshold);
    return (
      email.trim() !== settings.recipientEmail ||
      t.kind !== 'ok' ||
      t.value !== settings.largeAmountThreshold ||
      Number(reminderDays) !== settings.backupReminderDays
    );
  }

  const toggleAutoBackup = useCallback((v: boolean) => void update({ autoBackupEnabled: v }), [update]);

  const selectDir = useCallback(async () => {
    const dir = await desktop()?.selectBackupDir();
    if (dir) await update({ autoBackupDir: dir });
  }, [update]);
  const resetDir = useCallback(() => void update({ autoBackupDir: '' }), [update]);

  const backupNow = useCallback(async () => {
    setBusy(true);
    try {
      const name = await downloadBackup('backup');
      await markBackupDone();
      setMessage({ kind: 'info', text: `${name} 백업 파일을 저장했습니다.` });
    } catch (err) {
      setMessage({ kind: 'error', text: `백업 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [markBackupDone]);

  const onRestoreFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const res = await parseAndValidateBackup(await file.text());
    if (!res.ok) return setMessage({ kind: 'error', text: `복원 불가: ${res.error}` });
    const p = res.envelope.payload;
    const donationCount = Object.values(p.donationsByYear).reduce((s, l) => s + l.length, 0);
    setRestore({
      envelope: res.envelope,
      fileName: file.name,
      migratedFrom: res.migratedFrom,
      summary: `백업 일시 ${formatDateTime(res.envelope.exportedAt)} · 성도 ${p.members.length}명 · 헌금 종류 ${p.offeringTypes.length}개 · 헌금 내역 ${donationCount}건`,
    });
  }, []);

  const confirmRestore = useCallback(async () => {
    if (!restore) return;
    setBusy(true);
    try {
      // 복원 직전 현재 데이터를 긴급 백업으로 내려받습니다.
      await downloadBackup('emergency_before_restore');
      await replaceAllData(restore.envelope.payload);
      await Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
      setMessage({
        kind: 'info',
        text: `복원 완료${restore.migratedFrom ? ` (v${restore.migratedFrom} → v2 자동 변환)` : ''}. 복원 전 데이터는 emergency_before_restore 파일로 저장되었습니다.`,
      });
      setRestore(null);
    } catch (err) {
      setMessage({ kind: 'error', text: `복원 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [restore, memberActions, offeringActions, donationActions]);

  return {
    email,
    setEmail,
    threshold,
    setThreshold: (v: string) => setThreshold(formatAmountInput(v)),
    reminderDays,
    setReminderDays: (v: string) => setReminderDays(v.replace(/[^0-9]/g, '').slice(0, 3)),
    saveGeneral,
    /** [설정 저장]을 눌러야 반영되는 항목(메일·큰 금액 기준·백업 주기)에 저장하지 않은 변경이 있는지 */
    dirty: isGeneralDirty(),
    isDesktop,
    autoBackupEnabled: settings.autoBackupEnabled,
    toggleAutoBackup,
    theme: settings.theme,
    changeTheme: (v: AppTheme) => void update({ theme: v }),
    themeOptions: THEME_OPTIONS,
    printTheme: settings.printTheme,
    changePrintTheme: (v: PrintTheme) => void update({ printTheme: v }),
    printThemeOptions: PRINT_THEME_OPTIONS,
    fontScale: settings.fontScale,
    changeFontScale: (v: FontScale) => void update({ fontScale: v }),
    fontScaleOptions: [
      { value: 'NORMAL' as const, label: '보통' },
      { value: 'LARGE' as const, label: '크게' },
      { value: 'XLARGE' as const, label: '매우 크게' },
    ],
    backupHelp:
      '백업 파일(.json)에는 버전 정보와 SHA-256 무결성 체크섬이 포함됩니다. 복원 직전에는 현재 데이터를 긴급 백업 파일로 먼저 내려받아 데이터 유실을 막습니다.',
    backupDir: settings.autoBackupDir || defaultDir || '(데스크톱 앱에서만 사용 가능)',
    isCustomDir: !!settings.autoBackupDir,
    selectDir,
    resetDir,
    lastBackupLabel: settings.lastBackupAt ? formatDateTime(settings.lastBackupAt) : '없음',
    backupNow,
    onRestoreFile,
    restore,
    confirmRestore,
    cancelRestore: () => setRestore(null),
    busy,
    message,
  };
}
