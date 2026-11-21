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
import { decryptedBackup, isNdjsonFile, restoreFromFile, scanBackupFile, planFor, type BackupScan, type ReadableBackup } from '../services/backup/streamRestore';
import { setRestoreProgress, withCheckingBackup, withRestoring } from '../services/backup/backupBusy';
import { countYearDonations } from '../services/storage/storageService';
import { parseAndValidateBackup } from '../services/backup/validation';
import { desktop, type UpdateCheck } from '../services/desktopBridge';
import type { MergePlan } from '../services/backup/mergeRules';

interface RestoreCandidate {
  /** 한 덩어리 JSON 백업(작은 파일)은 전체를 읽어 둔 내용, 줄 단위 백업은 null(복원할 때 파일을 다시 읽음) */
  envelope: BackupEnvelope | null;
  /** 줄 단위 백업: 검증을 마친 파일과 그 요약 */
  stream?: { file: ReadableBackup; scan: BackupScan };
  fileName: string;
  migratedFrom: number | null;
  summary: string;
  /** 성도·헌금 종류 합치기 결과 안내(없으면 빈 문자열) */
  mergeNotice: string;
  /** 백업 파일에 들어 있는 연도와 그 연도의 헌금 건수 */
  yearRows: { year: string; count: number }[];
}

/** 복원이 아무리 빨리 끝나도 덮개(조작 막기)를 보여 두는 최소 시간 */
const RESTORE_MIN_MS = 5000;
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
  // 직접 백업 암호(데스크톱 앱). 앱은 암호를 저장하지 않으며, 창을 닫거나 저장하면 지웁니다.
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPassword2, setBackupPassword2] = useState('');
  // 암호가 필요한 백업 파일을 골랐을 때 암호 입력 창
  const [restorePw, setRestorePw] = useState<{ file: File; input: string; error: string } | null>(null);
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
    if (isDesktop && backupPassword.length < 6) return setMessage({ kind: 'error', text: '백업 암호는 6자 이상으로 정하세요.' });
    if (isDesktop && backupPassword !== backupPassword2) return setMessage({ kind: 'error', text: '암호 확인이 맞지 않습니다. 같은 암호를 두 번 입력하세요.' });
    setBusy(true);
    try {
      const all = await isCompleteYearBackup(backupYear); // 다른 연도의 헌금·이력이 없을 때만 전체 백업으로 취급
      const name = await saveBackupFile('backup', [backupYear], (done, total) => setBackupProgress({ done, total }), isDesktop ? backupPassword : undefined);
      // 일부 연도만 저장한 백업은 마지막 백업 기록으로 치지 않습니다(저장하지 않은 연도에 변경이 남아 있을 수 있음).
      if (all) await markBackupDone();
      closeBackup();
      setMessage({ kind: 'info', text: `${name} 백업 파일을 저장했습니다. (${backupYear}년)` });
    } catch (err) {
      setMessage({ kind: 'error', text: `백업 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
      setBackupProgress(null);
    }
  }, [markBackupDone, years, backupYear, backupBlocked, isDesktop, backupPassword, backupPassword2]);
  const closeBackup = () => {
    setBackupOpen(false);
    setBackupPassword('');
    setBackupPassword2('');
  };

  /** 자동 백업(.json.gz)은 압축을 풀어서, 그 외(.json)는 그대로 읽습니다. */
  const readBackupText = (file: File): Promise<string> =>
    /\.gz$/i.test(file.name) ? new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : file.text();

  /**
   * 줄 단위 백업 검사: 파일째 읽지 않고 흘려 읽으며 검증합니다(큰 백업도 메모리가 작음). source는 읽을 내용(암호화한 파일이면 main이 풀어 주는 래퍼).
   * 데스크톱 앱은 체크섬을 main의 내장 기능으로 먼저 확인합니다(큰 파일에서 화면 쪽 계산보다 훨씬 빠름). 실패 사유를 돌려주고, 통과하면 복원 창을 엽니다.
   */
  const checkStreamBackup = async (file: File, source: ReadableBackup, password?: string): Promise<string | null> => {
    setBusy(true);
    try {
      const checked = (await desktop()?.verifyBackupFile?.(file, password)) ?? null;
      if (checked) return checked;
      const scan = await scanBackupFile(source, { hashChecked: checked === '', onMonth: (n) => setRestoreProgress({ done: n, total: 0 }) });
      if (!scan.ok) return scan.error;
      setMessage(null);
      const years = Object.keys(scan.yearCounts).sort();
      setRestore({
        mergeNotice: mergeNoticeOf(await planFor(scan)),
        envelope: null,
        stream: { file: source, scan },
        fileName: file.name,
        migratedFrom: null,
        summary: `백업 일시 ${formatDateTime(scan.exportedAt ?? '')} · 성도 ${scan.members.length}명 · 헌금 종류 ${scan.offeringTypes.length}개 · 헌금 내역 ${Object.values(scan.yearCounts).reduce((s, n) => s + n, 0)}건`,
        yearRows: years.map((year) => ({ year, count: scan.yearCounts[year] })),
      });
      return null;
    } catch (err) {
      return (err as Error).message;
    } finally {
      setBusy(false);
    }
  };

  const onRestoreFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || backupBlocked) return;
    try {
      // 확인하는 동안 화면 전체를 덮어 막고 진행(확인한 달 수)을 보여 줍니다. 암호를 물어야 하면 여기서 끝나 덮개가 닫힙니다.
      await withCheckingBackup(async () => {
      setRestoreYearPick('');
      setMessage(null);
      // 암호화한 백업(.slbk): 자동 백업은 이 PC의 키로 바로 풀고, 직접 백업은 암호를 물어봅니다. 화면은 키를 모르고 main이 풀어 줍니다.
      const api = desktop();
      const info = api ? await api.inspectBackupFile(file) : null;
      if (info?.error) return setMessage({ kind: 'error', text: `복원 불가: ${info.error.replace(/^백업 파일 검증 실패: /, '')}` });
      if (api && info?.kind === 'password') {
        setMessage(null);
        return setRestorePw({ file, input: '', error: '' });
      }
      if (api && info?.kind === 'pc') {
        const fail = await checkStreamBackup(file, decryptedBackup(api, file));
        if (fail) setMessage({ kind: 'error', text: `복원 불가: ${fail}` });
        return;
      }
      if (await isNdjsonFile(file)) {
        const fail = await checkStreamBackup(file, file);
        if (fail) setMessage({ kind: 'error', text: `복원 불가: ${fail}` });
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
      });
    } catch (err) {
      // 손상된 압축 파일 등 읽는 중의 오류: '확인하고 있습니다' 문구가 남지 않게 사유를 알립니다.
      setMessage({ kind: 'error', text: `복원 불가: ${(err as Error).message}` });
    }
  }, []);

  /** 암호 입력 창의 [확인]: 틀리면 창에 사유를 보여 주고, 맞으면 복원 창으로 넘어갑니다(암호는 복원할 때 파일을 다시 읽으려고 래퍼 안에만 둡니다). */
  const confirmRestorePassword = useCallback(async () => {
    const api = desktop();
    if (!api || !restorePw || !restorePw.input) return;
    const { file, input } = restorePw;
    setRestorePw(null); // 확인하는 동안은 암호 창을 닫고 덮개만 보여 줍니다(틀리면 사유와 함께 다시 엶).
    const fail = await withCheckingBackup(() => checkStreamBackup(file, decryptedBackup(api, file, input), input));
    if (fail) setRestorePw({ file, input: '', error: fail.replace(/^백업 파일 검증 실패: /, '') });
  }, [restorePw]);

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

  // 확인 창에 보여 줄 현재 데이터의 그 연도 건수(잘못된 파일을 골랐는지 알아보기 쉽게). 세는 동안 null
  const [currentYearCount, setCurrentYearCount] = useState<number | null>(null);
  useEffect(() => {
    setCurrentYearCount(null);
    if (!restore || !restoreYear) return;
    let alive = true;
    void countYearDonations(restoreYear)
      .then((n) => alive && setCurrentYearCount(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [restore, restoreYear]);

  const confirmRestore = useCallback(async () => {
    if (!restore) return;
    if (!restoreYear) return setMessage({ kind: 'error', text: '이 백업 파일에는 복원할 헌금 내역(연도)이 없습니다.' });
    const picked = [restoreYear];
    const count = restore.yearRows.find((r) => r.year === restoreYear)?.count ?? 0;
    const log = desktop()?.logRestore;
    log?.({ stage: 'start', file: restore.fileName, years: picked, count, current: currentYearCount ?? undefined });
    setRestore(null); // 복원 창을 먼저 닫아 덮개만 남깁니다(Esc로 창이 닫히거나 포커스가 창에 갇히지 않게).
    setBusy(true);
    try {
      // 복원과 화면 다시 불러오기를 모두 덮개 아래에서 하고, 빨리 끝나도 덮개는 최소 5초 보여 줍니다(실패하면 바로 알림).
      const result = await withRestoring(async () => {
        const [r] = await Promise.all([
          (async () => {
            const res = restore.stream ? await restoreFromFile(restore.stream.file, restore.stream.scan, picked) : await restoreBackup(restore.envelope!.payload, { years: picked, mode: 'YEARS' });
            await Promise.all([memberActions.reload(), offeringActions.reload(), donationActions.reloadAll()]);
            return res;
          })(),
          new Promise((resolve) => window.setTimeout(resolve, RESTORE_MIN_MS)),
        ]);
        return r;
      });
      log?.({ stage: 'done', file: restore.fileName, years: picked, count, addedMembers: result.addedMembers, addedTypes: result.addedTypes });
      setMessage({
        kind: 'info',
        text: `${restoreYear}년 헌금 ${count.toLocaleString('ko-KR')}건을 복원했습니다. 다른 연도는 그대로입니다. 새로 추가된 성도 ${result.addedMembers}명·헌금 종류 ${result.addedTypes}개.${restore.migratedFrom ? ` (v${restore.migratedFrom} → v2 자동 변환)` : ''}`,
      });
    } catch (err) {
      log?.({ stage: 'fail', file: restore.fileName, years: picked, error: (err as Error).message });
      setMessage({ kind: 'error', text: `복원 실패: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [restore, restoreYear, currentYearCount, memberActions, offeringActions, donationActions]);

  // 프로그램 업데이트: 단추를 누를 때만 인터넷에 접속합니다(데스크톱 앱 전용).
  const [appUpdate, setAppUpdate] = useState<
    { state: 'idle' } | { state: 'checking' } | { state: 'latest'; current: string } | { state: 'available'; current: string; latest: string } | { state: 'downloading'; latest: string; percent: number } | { state: 'ready'; latest: string } | { state: 'error'; text: string }
  >({ state: 'idle' });
  const checkUpdate = useCallback(async () => {
    const api = desktop();
    if (!api) return;
    setAppUpdate({ state: 'checking' });
    const r: UpdateCheck = await api.checkForUpdate().catch(() => ({ current: '', error: '업데이트를 확인하지 못했습니다.' }));
    if (r.error) setAppUpdate({ state: 'error', text: r.error });
    else if (r.available && r.latest) setAppUpdate({ state: 'available', current: r.current, latest: r.latest });
    else setAppUpdate({ state: 'latest', current: r.current });
  }, []);
  const downloadUpdate = useCallback(async () => {
    const api = desktop();
    if (!api || appUpdate.state !== 'available') return;
    const latest = appUpdate.latest;
    setAppUpdate({ state: 'downloading', latest, percent: 0 });
    const off = api.onUpdateProgress((percent) => setAppUpdate({ state: 'downloading', latest, percent }));
    const r = await api.downloadUpdate().catch(() => ({ error: '업데이트를 내려받지 못했습니다.' }));
    off();
    setAppUpdate(r.error ? { state: 'error', text: r.error } : { state: 'ready', latest });
  }, [appUpdate]);

  return {
    appUpdate,
    checkUpdate,
    downloadUpdate,
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
    cancelBackup: closeBackup,
    backupPassword,
    setBackupPassword,
    backupPassword2,
    setBackupPassword2,
    onRestoreFile,
    restorePw,
    setRestorePwInput: (input: string) => setRestorePw((r) => (r ? { ...r, input } : r)),
    confirmRestorePassword,
    cancelRestorePassword: () => setRestorePw(null),
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
    currentYearCount,
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
