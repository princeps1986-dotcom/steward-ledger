import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useDonationActions } from '../contexts/DonationContext';
import { useMembers } from '../contexts/MemberContext';
import { useOfferingTypes } from '../contexts/OfferingTypeContext';
import { useSettings } from '../contexts/SettingsContext';
import type { DonationDraft } from '../contexts/types';
import { formatWon } from '../services/domain/amount';
import { lastSunday } from '../services/domain/dates';
import { readImportFile } from '../services/import/memberImportService';
import {
  donationTemplateCsv,
  matchDonationRows,
  normalizeDonationRows,
  type DonationImportRow,
  type MatchedDonationRow,
} from '../services/import/donationImportService';
import { downloadText } from '../services/downloadBridge';

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

  /** 저장소의 최신 기록을 보고 줄마다 상태를 정합니다. */
  const classify = useCallback(
    async (src: DonationImportRow[], date: string | null) => {
      const draftsOf = (list: MatchedDonationRow[]) => list.flatMap((r) => (r.draft ? [r.draft] : []));
      const first = matchDonationRows(src, {
        members,
        types: allTypes,
        defaultDate: hasDateColumn ? null : date,
        largeAmountThreshold: settings.largeAmountThreshold,
      });
      const drafts = draftsOf(first);
      const found = drafts.length ? await actions.findDuplicates(drafts) : [];
      // 기존 기록은 초안 순서대로 붙이므로 줄 번호에 맞춥니다.
      let k = 0;
      const existing = first.map((r) => (r.draft ? found[k++] : undefined));
      return matchDonationRows(src, {
        members,
        types: allTypes,
        defaultDate: hasDateColumn ? null : date,
        largeAmountThreshold: settings.largeAmountThreshold,
        existing,
      });
    },
    [actions, allTypes, members, settings.largeAmountThreshold, hasDateColumn],
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
  const canSave = !busy && rows !== null && errorCount === 0 && toSave.length > 0 && (largeCount === 0 || largeConfirmed);

  const confirm = useCallback(async () => {
    if (!rows || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      // 저장 직전에 한 번 더 판정합니다(미리보기 뒤에 저장소가 바뀌었을 수 있음).
      const fresh = await classify(rows, defaultDate);
      if (fresh.some((r) => r.status === 'ERROR')) {
        setMatched(fresh);
        setError('미리보기 이후 저장된 내역이 바뀌었습니다. 오류 항목을 확인한 뒤 다시 저장하세요. (아무것도 저장되지 않았습니다)');
        return;
      }
      const drafts: DonationDraft[] = fresh.filter((r) => r.draft && r.status !== 'SAVED').map((r) => r.draft as DonationDraft);
      if (drafts.length === 0) {
        setError('저장할 내역이 없습니다.');
        return;
      }
      const batch = await actions.saveBatch(drafts, 'SEPARATE');
      const total = batch.lines.reduce((s, l) => s + l.amount, 0);
      setResult(`${drafts.length}건 저장 완료 (합계 ${formatWon(total)}). 이미 있던 ${fresh.length - drafts.length}건은 건너뛰었습니다.`);
      setRows(null);
      setMatched([]);
      setLargeConfirmed(false);
    } catch (err) {
      setError(`저장 실패: ${(err as Error).message} (아무것도 반영되지 않았을 수 있습니다. 헌금 내역을 확인하세요)`);
    } finally {
      setBusy(false);
    }
  }, [rows, canSave, classify, defaultDate, actions]);

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
    error,
    result,
    busy,
    onFile,
    confirm,
    downloadTemplate: () => downloadText(donationTemplateCsv(), '헌금_불러오기_양식.csv', 'text/csv;charset=utf-8'),
    close: onDone,
  };
}
