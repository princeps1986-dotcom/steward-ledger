import { useCallback, useMemo, useState } from 'react';
import { useOfferingActions, useOfferingTypes, type OfferingTypeDraft } from '../contexts/OfferingTypeContext';
import type { OfferingType } from '../contexts/types';
import { formatNumber } from '../services/domain/amount';

interface FormState {
  id?: string;
  name: string;
  displayArea: OfferingType['displayArea'];
  quickAmountsText: string;
  sortOrder: string;
  isActive: boolean;
}

const emptyForm = (nextOrder: number): FormState => ({
  name: '',
  displayArea: 'PRIMARY',
  quickAmountsText: '',
  sortOrder: String(nextOrder),
  isActive: true,
});

/** 금액은 '/'로 구분합니다. 쉼표는 천 단위 표기로 간주해 제거합니다. "10,000 / 50000" → [10000, 50000] */
export function parseQuickAmounts(text: string): number[] | string {
  const parts = text.split('/').map((p) => p.replace(/[,\s]/g, '')).filter(Boolean);
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p) || Number(p) <= 0) return `금액 단추 값이 올바르지 않습니다: ${p}`;
    nums.push(Number(p));
  }
  return nums;
}

export function useOfferingsPage() {
  const types = useOfferingTypes();
  const { save, countUsage, remove, reorder } = useOfferingActions();
  const sorted = useMemo(() => [...types].sort((a, b) => a.sortOrder - b.sortOrder), [types]);
  const nextOrder = (sorted.at(-1)?.sortOrder ?? 0) + 1;
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 삭제 흐름: 입력된 헌금이 있으면 안내(notice)만, 없으면 확인(confirming) 후 삭제 */
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [confirming, setConfirming] = useState<OfferingType | null>(null);

  /** 끌어서 순서 바꾸기: dragId 행을 overId 행의 위(before) 또는 아래에 놓습니다. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = useCallback(() => {
    setDragId(null);
    setDrop(null);
  }, []);
  const dropRow = useCallback(() => {
    if (dragId && drop && dragId !== drop.id) {
      const ids = sorted.map((t) => t.id).filter((id) => id !== dragId);
      ids.splice(ids.indexOf(drop.id) + (drop.after ? 1 : 0), 0, dragId);
      if (ids.some((id, i) => id !== sorted[i].id)) void reorder(ids);
    }
    endDrag();
  }, [dragId, drop, sorted, reorder, endDrag]);

  const openNew = useCallback(() => {
    setError(null);
    setForm(emptyForm(nextOrder));
  }, [nextOrder]);

  const openEdit = useCallback((t: OfferingType) => {
    setError(null);
    setForm({
      id: t.id,
      name: t.name,
      displayArea: t.displayArea,
      quickAmountsText: t.quickAmounts.join(' / '),
      sortOrder: String(t.sortOrder),
      isActive: t.isActive,
    });
  }, []);

  const setField = useCallback(
    <K extends keyof FormState>(k: K) =>
      (v: FormState[K]) =>
        setForm((f) => (f ? { ...f, [k]: v } : f)),
    [],
  );

  const submit = useCallback(async () => {
    if (!form) return;
    const quick = parseQuickAmounts(form.quickAmountsText);
    if (typeof quick === 'string') return setError(quick);
    const order = Number(form.sortOrder);
    if (!Number.isFinite(order)) return setError('정렬 순서는 숫자입니다.');
    const draft: OfferingTypeDraft = {
      name: form.name,
      displayArea: form.displayArea,
      quickAmounts: quick,
      sortOrder: order,
      isActive: form.isActive,
    };
    const err = await save(draft, form.id);
    if (err) setError(err);
    else setForm(null);
  }, [form, save]);

  const toggleActive = useCallback(
    (t: OfferingType) => {
      const { id, ...rest } = t;
      void save({ ...rest, isActive: !t.isActive }, id);
    },
    [save],
  );

  const askDelete = useCallback(
    async (t: OfferingType) => {
      const count = await countUsage(t.id);
      if (count > 0) {
        setNotice({
          title: '삭제할 수 없습니다',
          body: `'${t.name}'(으)로 이미 입력된 헌금이 ${count.toLocaleString('ko-KR')}건 있어 삭제할 수 없습니다. 더 이상 쓰지 않으려면 [비활성화]를 눌러 새 입력에서만 빼 주세요. 과거 내역과 통계는 그대로 남습니다.`,
        });
      } else {
        setConfirming(t);
      }
    },
    [countUsage],
  );
  const confirmDelete = useCallback(async () => {
    const t = confirming;
    setConfirming(null);
    if (!t) return;
    const res = await remove(t.id);
    if (res.kind === 'used') {
      setNotice({ title: '삭제할 수 없습니다', body: `'${t.name}'(으)로 입력된 헌금이 ${res.count.toLocaleString('ko-KR')}건 있어 삭제하지 않았습니다. [비활성화]를 사용하세요.` });
    }
  }, [confirming, remove]);

  return {
    rows: sorted.map((t) => ({
      type: t,
      areaLabel: t.displayArea === 'PRIMARY' ? '기본 나열' : '기타 드롭다운',
      quickLabel: t.quickAmounts.map(formatNumber).join(' / ') || '-',
    })),
    form,
    error,
    dragId,
    drop,
    startDrag: setDragId,
    overRow: setDrop,
    dropRow,
    endDrag,
    openNew,
    openEdit,
    close: () => setForm(null),
    setField,
    submit,
    toggleActive,
    askDelete,
    confirmDelete,
    confirming,
    cancelDelete: () => setConfirming(null),
    notice,
    closeNotice: () => setNotice(null),
  };
}
