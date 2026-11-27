import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import { useMemberActions, useMembers } from '../contexts/MemberContext';
import { downloadText } from '../services/downloadBridge';
import {
  applyImport,
  buildPreview,
  normalizeRows,
  parsePastedTable,
  readImportFile,
  templateCsv,
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
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [overwrite, setOverwrite] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [busy, setBusy] = useState(false);

  const [loadId, setLoadId] = useState(0);

  const load = useCallback(
    async (name: string, read: () => Record<string, string>[] | Promise<Record<string, string>[]>) => {
      setError(null);
      setStats(null);
      setOverwrite(new Set());
      setFileName(name);
      setLoadId((n) => n + 1);
      try {
        const raw = await read();
        if (raw.length === 0) throw new Error('가져올 행이 없습니다.');
        setPreview(buildPreview(normalizeRows(raw), members));
      } catch (err) {
        setPreview(null);
        setError((err as Error).message);
      }
    },
    [members],
  );

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

  const confirm = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      let result: ImportStats | null = null;
      await replaceMembers((latest) => {
        // 미리보기 이후 명단이 바뀌었을 수 있으므로 최신 명단으로 다시 판정합니다.
        const fresh = buildPreview(preview.map(({ status: _s, messages: _m, duplicateOfId: _d, headRef: _h, ...r }) => r), latest);
        const { members: next, stats: s } = applyImport(fresh, overwrite, latest);
        result = s;
        return next;
      });
      setStats(result);
      setPreview(null);
    } catch (err) {
      setError(`불러오기 실패: ${(err as Error).message} (아무것도 반영되지 않았습니다)`);
    } finally {
      setBusy(false);
    }
  }, [preview, overwrite, replaceMembers]);

  const summary = useMemo(() => {
    const rows = preview ?? [];
    return {
      ok: rows.filter((r) => r.status === 'OK' || r.status === 'WARN').length,
      dup: rows.filter((r) => r.status === 'DUPLICATE').length,
      err: rows.filter((r) => r.status === 'ERROR').length,
    };
  }, [preview]);

  return {
    fileName,
    loadId,
    preview: (preview ?? []).map((r) => ({ ...r, statusLabel: STATUS_LABEL[r.status], overwrite: overwrite.has(r.rowNo) })),
    hasPreview: !!preview,
    summary,
    error,
    stats,
    busy,
    onFile,
    onPaste,
    toggleOverwrite,
    confirm,
    downloadTemplate: () => downloadText(templateCsv(), '성도명단_양식.csv', 'text/csv;charset=utf-8'),
    close: onDone,
  };
}
