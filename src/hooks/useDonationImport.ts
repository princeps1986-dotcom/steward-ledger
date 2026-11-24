import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useDonationActions } from '../contexts/DonationContext';
import { useMembers } from '../contexts/MemberContext';
import { useOfferingTypes } from '../contexts/OfferingTypeContext';
import { useSettings } from '../contexts/SettingsContext';
import type { Donation, DonationDraft } from '../contexts/types';
import { formatWon } from '../services/domain/amount';
import { lastSunday } from '../services/domain/dates';
import { readImportFile } from '../services/import/memberImportService';
import {
  donationTemplateCsv,
  batchLabel,
  fileDateError,
  matchDonationRows,
  normalizeDonationRows,
  type DonationImportRow,
  type MatchedDonationRow,
} from '../services/import/donationImportService';
import { downloadText } from '../services/downloadBridge';
import { readDay } from '../services/storage/storageService';
import { createExclusive } from './exclusive';

const STATUS_LABEL = { OK: '저장', WARN: '확인', ERROR: '오류', SAVED: '이미 저장' } as const;

export function useDonationImport(onDone: () => void, initialDate: string = lastSunday()) {
  const members = useMembers();
  const allTypes = useOfferingTypes();
  const settings = useSettings();
  const actions = useDonationActions();

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<DonationImportRow[] | null>(null);
  const [hasDateColumn, setHasDateColumn] = useState(true);
  const [defaultDate, setDefaultDate] = useState<string>(initialDate);
  const [matched, setMatched] = useState<MatchedDonationRow[]>([]);
  const [largeConfirmed, setLargeConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const exclusive = useMemo(() => createExclusive(busyRef), []);

  /** 저장소의 최신 기록을 보고 줄마다 상태를 정합니다. */
  const classify = useCallback(
    async (src: DonationImportRow[], date: string | null) => {
      const ctx = { members, types: allTypes, defaultDate: hasDateColumn ? null : date, largeAmountThreshold: settings.largeAmountThreshold };
      // 1차: 초안을 만들고, 2차: 저장소의 기존 기록을 붙여 상태를 정합니다.
      const first = matchDonationRows(src, ctx);
      const dates = [...new Set(first.flatMap((r) => (r.draft ? [r.draft.date] : [])))];
      const stored = (await Promise.all(dates.map(readDay))).flat();
      // 같은 날짜·성도·종류 기록이 여러 건일 수 있어(별도 추가) 금액까지 같은 기록을 한 건씩 짝지어 "이미 저장"을 정합니다.
      // 첫 1건만 보면 같은 파일을 다시 불러올 때 금액이 다른 줄이 또 저장됩니다.
      const sameKey = (s: Donation, d: DonationDraft) => s.date === d.date && s.memberId === d.memberId && s.offeringTypeId === d.offeringTypeId;
      const unused = [...stored];
      const existing = first.map((r) => {
        const d = r.draft;
        if (!d) return undefined;
        const i = unused.findIndex((s) => sameKey(s, d) && s.amount === d.amount);
        return i >= 0 ? unused.splice(i, 1)[0] : stored.find((s) => sameKey(s, d));
      });
      return matchDonationRows(src, { ...ctx, existing });
    },
    [allTypes, members, settings.largeAmountThreshold, hasDateColumn],
  );

  // 파일이나 날짜가 바뀌면 다시 판정합니다.
  useEffect(() => {
    if (!rows) return;
    const id = ++requestRef.current;
    void classify(rows, defaultDate).then((m) => {
      if (id === requestRef.current) {
        setMatched(m);
        setLargeConfirmed(false);
      }
    });
  }, [rows, defaultDate, classify]);

  const onFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const raw = await readImportFile(file);
      if (raw.length === 0) throw new Error('가져올 행이 없습니다.');
      const { rows: parsed, hasDateColumn: hasDate } = normalizeDonationRows(raw);
      setHasDateColumn(hasDate);
      setRows(parsed);
    } catch (err) {
      setRows(null);
      setMatched([]);
      setError((err as Error).message);
    }
  }, []);

  const errorCount = matched.filter((r) => r.status === 'ERROR').length;
  const toSave = matched.filter((r) => r.draft && r.status !== 'SAVED' && r.status !== 'ERROR');
  const largeCount = matched.filter((r) => r.large).length;
  const dateError = fileDateError(matched);
  const canSave = !busy && rows !== null && errorCount === 0 && !dateError && toSave.length > 0 && (largeCount === 0 || largeConfirmed);

  // 연타로 두 번 저장되지 않도록 ref로 즉시 막습니다(상태 busy는 다음 렌더 뒤에야 바뀝니다).
  const confirm = useCallback(
    () =>
      exclusive(async () => {
        if (!rows || !canSave) return;
        setBusy(true);
        setError(null);
        try {
          // 저장 직전에 한 번 더 판정합니다(미리보기 뒤에 저장소가 바뀌었을 수 있음).
          const fresh = await classify(rows, defaultDate);
          if (fresh.some((r) => r.status === 'ERROR') || fileDateError(fresh)) {
            setMatched(fresh);
            setError('미리보기 이후 저장된 내역이 바뀌었습니다. 오류 항목을 확인한 뒤 다시 저장하세요. (아무것도 저장되지 않았습니다)');
            return;
          }
          const drafts: DonationDraft[] = fresh.filter((r) => r.draft && r.status !== 'SAVED').map((r) => r.draft as DonationDraft);
          if (drafts.length === 0) {
            setError('저장할 내역이 없습니다.');
            return;
          }
          // 한 파일(한 날짜)을 한 번에 저장합니다. 저장은 원자적이라 실패하면 아무것도 남지 않고, 복구하기가 파일 전체를 되돌립니다.
          const batch = await actions.saveBatch(drafts, 'SEPARATE', batchLabel(drafts, members));
          const total = batch.lines.reduce((s, l) => s + l.amount, 0);
          setResult(`${drafts.length}건 저장 완료 (합계 ${formatWon(total)}). 이미 있던 ${fresh.length - drafts.length}건은 건너뛰었습니다.`);
          setRows(null);
          setMatched([]);
          setLargeConfirmed(false);
        } catch (err) {
          setError(`저장 실패: ${(err as Error).message} (아무것도 저장되지 않았습니다)`);
        } finally {
          setBusy(false);
        }
      }),
    [exclusive, rows, canSave, classify, defaultDate, actions, members],
  );

  const summary = useMemo(
    () => ({
      save: toSave.length,
      saved: matched.filter((r) => r.status === 'SAVED').length,
      warn: matched.filter((r) => r.status === 'WARN').length,
      err: errorCount,
    }),
    [matched, toSave.length, errorCount],
  );

  return {
    fileName,
    hasPreview: rows !== null,
    hasDateColumn,
    defaultDate,
    setDefaultDate,
    preview: matched.map((r) => ({ ...r, statusLabel: STATUS_LABEL[r.status] })),
    summary,
    largeCount,
    largeConfirmed,
    setLargeConfirmed,
    canSave,
    dateError,
    error,
    result,
    busy,
    onFile,
    confirm,
    downloadTemplate: () => downloadText(donationTemplateCsv(), '헌금_불러오기_양식.csv', 'text/csv;charset=utf-8'),
    close: onDone,
  };
}
