import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMemberActions, useMembers } from '../contexts/MemberContext';
import { downloadText } from '../services/downloadBridge';
import {
  applyImport,
  buildPreview,
  normalizeRows,
  parsePastedTable,
  readImportFile,
  templateCsv,
  type ImportRow,
  type ImportStats,
  type PreviewRow,
} from '../services/import/memberImportService';

const STATUS_LABEL: Record<PreviewRow['status'], string> = {
  OK: '정상',
  WARN: '경고',
  ERROR: '오류',
  DUPLICATE: '중복',
};

export function useMemberImport(onDone: () => void) {
  const members = useMembers();
  const { replaceMembers } = useMemberActions();
  const [fileName, setFileName] = useState('');
  // 원본 줄을 들고 있다가 고치거나 뺄 때마다 다시 판정합니다.
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [removed, setRemoved] = useState(0);
  const [overwrite, setOverwrite] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [busy, setBusy] = useState(false);

  const [loadId, setLoadId] = useState(0);
  // 마지막으로 시작한 불러오기 번호(늦게 끝난 이전 읽기 결과를 버림)와 저장 중 여부
  const requestRef = useRef(0);
  const busyRef = useRef(false);

  const load = useCallback(
    async (name: string, read: () => Record<string, string>[] | Promise<Record<string, string>[]>) => {
      // 저장 중에 불러온 자료는 저장이 끝나며 지워지므로 받지 않습니다.
      if (busyRef.current) return;
      const id = ++requestRef.current;
      setError(null);
      setStats(null);
      setOverwrite(new Set());
      setRemoved(0);
      setFileName(name);
      setLoadId((n) => n + 1);
      try {
        const raw = await read();
        if (id !== requestRef.current) return; // 그사이 다른 파일·붙여넣기를 시작함
        if (raw.length === 0) throw new Error('가져올 행이 없습니다.');
        setRows(normalizeRows(raw));
      } catch (err) {
        if (id !== requestRef.current) return;
        setRows(null);
        setError((err as Error).message);
      }
    },
    [],
  );

  const preview = useMemo<PreviewRow[] | null>(() => (rows ? buildPreview(rows, members) : null), [rows, members]);

  const onFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      await load(file.name, () => readImportFile(file));
    },
    [load],
  );

  const onPaste = useCallback((text: string) => load('붙여넣은 표', () => parsePastedTable(text)), [load]);

  const toggleOverwrite = useCallback((rowNo: number) => {
    setOverwrite((prev) => {
      const next = new Set(prev);
      if (next.has(rowNo)) next.delete(rowNo);
      else next.add(rowNo);
      return next;
    });
  }, []);

  const unmark = useCallback(
    (rowNo: number) =>
      setOverwrite((prev) => {
        const next = new Set(prev);
        next.delete(rowNo);
        return next;
      }),
    [],
  );

  const removeRow = useCallback(
    (rowNo: number) => {
      setRows((prev) => prev && prev.filter((r) => r.rowNo !== rowNo));
      unmark(rowNo);
      setRemoved((n) => n + 1);
    },
    [unmark],
  );

  const updateRow = useCallback(
    (rowNo: number, patch: Pick<ImportRow, 'name' | 'position' | 'phoneLast4'>) => {
      const fixed = { name: patch.name.trim(), position: patch.position.trim(), phoneLast4: patch.phoneLast4.replace(/[^0-9]/g, '') };
      setRows((prev) => prev && prev.map((r) => (r.rowNo === rowNo ? { ...r, ...fixed } : r)));
      // 고치면 다른 성도와 겹칠 수 있으므로 덮어쓰기는 다시 고르게 합니다.
      unmark(rowNo);
    },
    [unmark],
  );

  const confirm = useCallback(async () => {
    if (!rows || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      let result: ImportStats | null = null;
      await replaceMembers((latest) => {
        // 미리보기 이후 명단이 바뀌었을 수 있으므로 최신 명단으로 다시 판정합니다.
        const fresh = buildPreview(rows, latest);
        const { members: next, stats: s } = applyImport(fresh, overwrite, latest);
        result = s;
        return next;
      });
      setStats(result);
      setRows(null);
    } catch (err) {
      setError(`불러오기 실패: ${(err as Error).message} (아무것도 반영되지 않았습니다)`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [rows, overwrite, replaceMembers]);

  const summary = useMemo(() => {
    const list = preview ?? [];
    return {
      ok: list.filter((r) => r.status === 'OK' || r.status === 'WARN').length,
      dup: list.filter((r) => r.status === 'DUPLICATE').length,
      err: list.filter((r) => r.status === 'ERROR').length,
    };
  }, [preview]);

  return {
    fileName,
    loadId,
    preview: (preview ?? []).map((r) => ({ ...r, statusLabel: STATUS_LABEL[r.status], overwrite: overwrite.has(r.rowNo) })),
    hasPreview: !!preview,
    removed,
    summary,
    error,
    stats,
    busy,
    onFile,
    onPaste,
    toggleOverwrite,
    removeRow,
    updateRow,
    confirm,
    downloadTemplate: () => downloadText(templateCsv(), '성도명단_양식.csv', 'text/csv;charset=utf-8'),
    close: onDone,
  };
}
