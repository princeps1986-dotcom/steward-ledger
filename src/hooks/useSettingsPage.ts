import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useDonationActions, useDonationYears } from '../contexts/DonationContext';
import { useMemberActions, useMembers } from '../contexts/MemberContext';
import { useOfferingActions, useOfferingTypes } from '../contexts/OfferingTypeContext';
import { DEFAULT_OFFERING_TYPES } from '../services/domain/offeringDefaults';
import { useSettings, useSettingsActions } from '../contexts/SettingsContext';
import type { AppTheme, BackupEnvelope, FontScale, PrintTheme } from '../contexts/types';
import { PRINT_THEME_OPTIONS, THEME_OPTIONS } from '../services/theme';
import { formatAmountInput, formatNumber, parseAmount } from '../services/domain/amount';
import { formatDateTime } from '../services/domain/dates';
import { createDemoData, removeDemoData } from '../services/demo/demoService';
import { refreshDemoState, useDemoActive, useDemoCreating } from '../services/demo/demoState';
import { isCompleteYearBackup, saveBackupFile, saveEmergencyBackup, resetAllData, previewMerge, restoreBackup, yearsInPayload } from '../services/backup/backupService';
import { isNdjsonFile, restoreFromFile, scanBackupFile, planFor, type BackupScan } from '../services/backup/streamRestore';
import { parseAndValidateBackup } from '../services/backup/validation';
import { desktop } from '../services/desktopBridge';
import type { MergePlan } from '../services/backup/mergeRules';

interface RestoreCandidate {
  /** 한 덩어리 JSON 백업(작은 파일)은 전체를 읽어 둔 내용, 줄 단위 백업은 null(복원할 때 파일을 다시 읽음) */
  envelope: BackupEnvelope | null;
  /** 줄 단위 백업: 검증을 마친 파일과 그 요약 */
  stream?: { file: File; scan: BackupScan };
  fileName: string;
  migratedFrom: number | null;
  summary: string;
  /** 성도·헌금 종류 합치기 결과 안내(없으면 빈 문자열) */
  mergeNotice: string;
  /** 백업 파일에 들어 있는 연도와 그 연도의 헌금 건수 */
  yearRows: { year: string; count: number }[];
}

const CHECKING_FILE = { kind: 'info' as const, text: '백업 파일을 확인하고 있습니다… 파일이 크면 수십 초 걸릴 수 있습니다.' };
const RESET_WAIT_SECONDS = 10;

/** 성도·헌금 종류 합치기 결과 안내문(다른 PC의 백업이면 같은 성도·종류를 현재 데이터와 대응시킴) */
function mergeNoticeOf(plan: MergePlan): string {
  const parts: string[] = [];
  if (plan.memberIdMap.size + plan.typeIdMap.size > 0) parts.push(`현재 데이터와 같은 성도 ${plan.memberIdMap.size}명·헌금 종류 ${plan.typeIdMap.size}개는 기존 항목에 연결됩니다.`);
  if (plan.addMembers.length + plan.addTypes.length > 0) parts.push(`새로 추가되는 항목: 성도 ${plan.addMembers.length}명·헌금 종류 ${plan.addTypes.length}개.`);
  if (plan.sameNameAdded > 0) parts.push(`새로 추가되는 성도 중 ${plan.sameNameAdded}명은 현재 데이터에 이름이 같은 성도가 있습니다(연락처 뒷4자리가 달라 같은 사람으로 보지 않음). 같은 사람이면 복원 후 성도 화면에서 확인해 주세요.`);
  return parts.join(' ');
}

export function useSettingsPage() {
  const settings = useSettings();
  const { update, markBackupDone } = useSettingsActions();
  const memberActions = useMemberActions();
  const offeringActions = useOfferingActions();
  const donationActions = useDonationActions();
  const years = useDonationYears();
  // 성도·헌금 내역이 없고 헌금 종류도 기본값 그대로면 되돌릴 것이 없으므로 전체 초기화를 쓸 수 없습니다.
  const offeringTypes = useOfferingTypes();
  const typesChanged = useMemo(() => {
    const strip = (t: { name: string; displayArea: string; quickAmounts: number[]; sortOrder: number; isActive: boolean }) =>
      JSON.stringify([t.name, t.displayArea, t.quickAmounts, t.sortOrder, t.isActive]);
    const cur = [...offeringTypes].sort((a, b) => a.sortOrder - b.sortOrder).map(strip);
    return cur.length !== DEFAULT_OFFERING_TYPES.length || cur.some((c, i) => c !== strip(DEFAULT_OFFERING_TYPES[i]));
  }, [offeringTypes]);
  const hasData = useMembers().length > 0 || years.length > 0 || typesChanged;

  const [threshold, setThreshold] = useState(formatNumber(settings.largeAmountThreshold));
  const [defaultDir, setDefaultDir] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [restore, setRestore] = useState<RestoreCandidate | null>(null);
  // 백업·복원은 항상 연도 하나를 선택해서 합니다(셀렉트 박스, 헌금 내역이 있는 연도만).
  const [backupYearPick, setBackupYearPick] = useState('');
  const [restoreYearPick, setRestoreYearPick] = useState('');
  // 선택값이 목록에 없으면(처음, 또는 연도가 사라졌을 때) 가장 최근 연도를 씁니다.
  const backupYear = years.includes(backupYearPick) ? backupYearPick : (years[years.length - 1] ?? '');
  const restoreYear = restore?.yearRows.some((r) => r.year === restoreYearPick) ? restoreYearPick : (restore?.yearRows[restore.yearRows.length - 1]?.year ?? '');
  const [busy, setBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState<{ done: number; total: number } | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [removeDemoOpen, setRemoveDemoOpen] = useState(false);
  const [demoProgress, setDemoProgress] = useState<{ done: number; total: number } | null>(null);
  // 시연 데이터가 한 건이라도 있으면 시연 중(전체 데이터를 훑지 않고 색인으로 판정). 설정 화면에 들어올 때 다시 확인합니다.
  const demoActive = useDemoActive();
  // 시연 데이터를 쓰거나 만드는 동안에는 백업·복원·자동 백업을 쓸 수 없습니다.
  const demoCreating = useDemoCreating() !== null;
  const backupBlocked = demoActive || demoCreating;
  useEffect(() => {
    void refreshDemoState();
  }, []);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetLeft, setResetLeft] = useState(RESET_WAIT_SECONDS);
  const isDesktop = !!desktop();

  useEffect(() => {
    setThreshold(formatNumber(settings.largeAmountThreshold));
  }, [settings.largeAmountThreshold]);

  useEffect(() => {
    void desktop()?.getDefaultBackupDir().then(setDefaultDir);
  }, []);

  /** 저장하지 않은 입력을 버리고 저장된 값으로 되돌립니다. */
  const cancelGeneral = useCallback(() => setThreshold(formatNumber(settings.largeAmountThreshold)), [settings.largeAmountThreshold]);

  const saveGeneral = useCallback(async () => {
    const t = parseAmount(threshold);
    if (t.kind !== 'ok') return setMessage({ kind: 'error', text: '큰 금액 확인 기준을 입력하세요.' });
    await update({ largeAmountThreshold: t.value });
    setMessage({ kind: 'info', text: '설정을 저장했습니다.' });
  }, [threshold, update]);

  /** 저장 시 정규화되는 값(공백 제거·앞자리 0·쉼표)은 정규화한 뒤 비교해, 저장 후에도 변경으로 남지 않게 합니다. */
  function isGeneralDirty(): boolean {
    const t = parseAmount(threshold);
    return t.kind !== 'ok' || t.value !== settings.largeAmountThreshold;
  }

  const toggleAutoBackup = useCallback((v: boolean) => !backupBlocked && void update({ autoBackupEnabled: v }), [update, backupBlocked]);

  const selectDir = useCallback(async () => {
    if (backupBlocked) return;
    const dir = await desktop()?.selectBackupDir();
    if (dir) await update({ autoBackupDir: dir });
  }, [update, backupBlocked]);
  const resetDir = useCallback(() => void update({ autoBackupDir: '' }), [update]);

  const backupNow = useCallback(async () => {
    if (backupBlocked) return;
    if (!backupYear) return setMessage({ kind: 'error', text: '백업할 연도가 없습니다. 헌금 내역이 있는 연도만 백업할 수 있습니다.' });
    setBusy(true);
    try {
      const all = await isCompleteYearBackup(backupYear); // 다른 연도의 헌금·이력이 없을 때만 전체 백업으로 취급
      const name = await saveBackupFile('backup', [backupYear], (done, total) => setBackupProgress({ done, total }));
      // 일부 연도만 저장한 백업은 마지막 백업 기록으로 치지 않습니다(저장하지 않은 연도에 변경이 남아 있을 수 있음).
      if (all) await markBackupDone();
      setBackupOpen(false);
      setMessage({ kind: 'info', text: `${name} 백업 파일을 저장했습니다. (${backupYear}년)` });
    } catch (err) {
      setMessage({ kind: 'error', text: `백업 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
      setBackupProgress(null);
    }
  }, [markBackupDone, years, backupYear, backupBlocked]);

  /** 자동 백업(.json.gz)은 압축을 풀어서, 그 외(.json)는 그대로 읽습니다. */
  const readBackupText = (file: File): Promise<string> =>
    /\.gz$/i.test(file.name) ? new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : file.text();

  const onRestoreFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || backupBlocked) return;
    setRestoreYearPick('');
    setMessage(CHECKING_FILE); // 큰 파일은 검사(체크섬·형식)에 수십 초가 걸리므로 멈춘 것으로 보이지 않게 알립니다.
    if (await isNdjsonFile(file)) {
      // 줄 단위 백업: 파일째 읽지 않고 흘려 읽으며 검증합니다(큰 백업도 메모리가 작음).
      setBusy(true);
      try {
        // 데스크톱 앱은 체크섬을 main의 내장 기능으로 먼저 확인합니다(큰 파일에서 화면 쪽 계산보다 훨씬 빠름).
        const checked = (await desktop()?.verifyBackupFile?.(file)) ?? null;
        if (checked) return setMessage({ kind: 'error', text: `복원 불가: ${checked}` });
        const scan = await scanBackupFile(file, { hashChecked: checked === '' });
        if (!scan.ok) return setMessage({ kind: 'error', text: `복원 불가: ${scan.error}` });
        setMessage(null);
        const years = Object.keys(scan.yearCounts).sort();
        setRestore({
          mergeNotice: mergeNoticeOf(await planFor(scan)),
          envelope: null,
          stream: { file, scan },
          fileName: file.name,
          migratedFrom: null,
          summary: `백업 일시 ${formatDateTime(scan.exportedAt ?? '')} · 성도 ${scan.members.length}명 · 헌금 종류 ${scan.offeringTypes.length}개 · 헌금 내역 ${Object.values(scan.yearCounts).reduce((s, n) => s + n, 0)}건`,
          yearRows: years.map((year) => ({ year, count: scan.yearCounts[year] })),
        });
      } catch (err) {
        setMessage({ kind: 'error', text: `복원 불가: ${(err as Error).message}` });
      } finally {
        setBusy(false);
      }
      return;
    }
    const res = await parseAndValidateBackup(await readBackupText(file));
    if (!res.ok) return setMessage({ kind: 'error', text: `복원 불가: ${res.error}` });
    const p = res.envelope.payload;
    const donationCount = Object.values(p.donationsByYear).reduce((s, l) => s + l.length, 0);
    // 다른 PC의 백업이면 같은 성도·헌금 종류를 현재 데이터와 대응시키므로, 그 결과를 미리 알려 줍니다.
    const plan = await previewMerge(p);
    setMessage(null);
    setRestore({
      mergeNotice: mergeNoticeOf(plan),
      envelope: res.envelope,
      fileName: file.name,
      migratedFrom: res.migratedFrom,
      summary: `백업 일시 ${formatDateTime(res.envelope.exportedAt)} · 성도 ${p.members.length}명 · 헌금 종류 ${p.offeringTypes.length}개 · 헌금 내역 ${donationCount}건`,
      yearRows: yearsInPayload(p).map((year) => ({ year, count: (p.donationsByYear[year] ?? []).length })),
    });
  }, []);

  // 초기화 확인창이 열리면 10초 카운트다운 후에만 [초기화]를 누를 수 있습니다.
  useEffect(() => {
    if (!resetOpen) return;
    setResetLeft(RESET_WAIT_SECONDS);
    const id = window.setInterval(() => setResetLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [resetOpen]);

  const confirmDemo = useCallback(async () => {
    if (demoActive) return; // 시연 중에는 만들 수 없습니다(이미 시연 중).
    setDemoOpen(false); // 누르는 즉시 레이어를 닫고, 진행은 최상단 안내 띠에 보입니다.
    setBusy(true);
    try {
      const reloadAll = () => Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
      // 최근 몇 달이 저장되면 바로 쓸 수 있게 화면을 열고, 나머지 과거 달은 뒤에서 이어서 만듭니다(진행은 최상단 띠에 표시).
      await createDemoData({
        onProgress: (done, total) => setDemoProgress({ done, total }),
        onReady: () => {
          setBusy(false);
          void reloadAll();
        },
      });
      await reloadAll();
      setMessage({ kind: 'info', text: '시연 데이터를 생성했습니다.' });
    } catch (err) {
      setMessage({ kind: 'error', text: `시연 데이터 생성 실패: ${(err as Error).message}` });
    } finally {
      setDemoProgress(null);
      setBusy(false);
    }
  }, [demoActive, memberActions, offeringActions, donationActions]);

  const confirmRemoveDemo = useCallback(async () => {
    if (!demoActive || demoCreating) return; // 시연 데이터가 없거나 만드는 중이면 작동하지 않습니다.
    setBusy(true);
    try {
      await removeDemoData();
      await Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
      setMessage({ kind: 'info', text: '시연 데이터를 제거했습니다.(빈 상태로 돌아갑니다)' });
      setRemoveDemoOpen(false);
    } catch (err) {
      setMessage({ kind: 'error', text: `시연 데이터 제거 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [demoActive, demoCreating, memberActions, offeringActions, donationActions]);

  const confirmReset = useCallback(async () => {
    if (resetLeft > 0 || demoActive || !hasData) return; // 시연 중에는 전체 초기화를 쓸 수 없습니다(시연 데이터 제거를 먼저).
    setBusy(true);
    try {
      await saveEmergencyBackup('emergency_before_reset');
      await resetAllData();
      await Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
      setMessage({ kind: 'info', text: '전체 데이터를 초기화했습니다. 초기화 전 데이터는 emergency_before_reset 파일로 저장되었습니다.' });
      setResetOpen(false);
    } catch (err) {
      setMessage({ kind: 'error', text: `초기화 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [resetLeft, demoActive, hasData, memberActions, offeringActions, donationActions]);

  const confirmRestore = useCallback(async () => {
    if (!restore) return;
    if (!restoreYear) return setMessage({ kind: 'error', text: '이 백업 파일에는 복원할 헌금 내역(연도)이 없습니다.' });
    const picked = [restoreYear];
    setBusy(true);
    try {
      if (restore.stream) await restoreFromFile(restore.stream.file, restore.stream.scan, picked);
      else await restoreBackup(restore.envelope!.payload, { years: picked, mode: 'YEARS' });
      await Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
      setMessage({
        kind: 'info',
        text: `복원 완료 (${restoreYear}년, 다른 연도는 유지)${restore.migratedFrom ? ` (v${restore.migratedFrom} → v2 자동 변환)` : ''}.`,
      });
      setRestore(null);
    } catch (err) {
      setMessage({ kind: 'error', text: `복원 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [restore, restoreYear, memberActions, offeringActions, donationActions]);

  return {
    threshold,
    setThreshold: (v: string) => setThreshold(formatAmountInput(v)),
    saveGeneral,
    cancelGeneral,
    /** [설정 저장]을 눌러야 반영되는 항목(큰 금액 기준·백업 주기)에 저장하지 않은 변경이 있는지 */
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
      '특정 연도를 선택해야 합니다. (성도·헌금 종류는 항상 포함)\n복원하면 선택한 연도의 헌금과 수정·삭제 이력이 백업 내용으로 바뀝니다.',
    backupDir: settings.autoBackupDir || defaultDir || '(데스크톱 앱에서만 사용 가능)',
    isCustomDir: !!settings.autoBackupDir,
    selectDir,
    resetDir,
    lastBackupLabel: settings.lastBackupAt ? formatDateTime(settings.lastBackupAt) : '없음',
    backupNow,
    backupOpen,
    openBackup: () => !backupBlocked && setBackupOpen(true),
    cancelBackup: () => setBackupOpen(false),
    onRestoreFile,
    restore,
    confirmRestore,
    cancelRestore: () => setRestore(null),
    // 연도별 백업·복원 선택
    backupYearOptions: years,
    backupYear,
    setBackupYear: setBackupYearPick,
    restoreYearOptions: restore?.yearRows ?? [],
    restoreYear,
    setRestoreYear: setRestoreYearPick,
    demoOpen,
    openDemo: () => setDemoOpen(true),
    cancelDemo: () => setDemoOpen(false),
    confirmDemo,
    resetOpen,
    resetLeft,
    demoActive,
    backupBlocked,
    demoProgress,
    demoBrowser: !desktop(),
    removeDemoOpen,
    hasData,
    demoCreating,
    openRemoveDemo: () => !demoCreating && setRemoveDemoOpen(true),
    cancelRemoveDemo: () => setRemoveDemoOpen(false),
    confirmRemoveDemo,
    openReset: () => {
      if (!demoActive && hasData) setResetOpen(true);
    },
    cancelReset: () => setResetOpen(false),
    confirmReset,
    busy,
    backupProgress,
    message,
  };
}
