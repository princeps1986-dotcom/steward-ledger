import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOfferingActions, useOfferingTypes, type OfferingTypeDraft } from '../contexts/OfferingTypeContext';
import { useSettings, useSettingsActions } from '../contexts/SettingsContext';
import type { OfferingType } from '../contexts/types';
import { formatAmountInput, formatNumber, parseAmount } from '../services/domain/amount';

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
function parseQuickAmounts(text: string): number[] | string {
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
  // 큰 금액 확인 기준: 입력값을 쥐고 있다가 [저장]을 눌러야 설정에 반영합니다.
  const settings = useSettings();
  const { update } = useSettingsActions();
  const [threshold, setThreshold] = useState(formatNumber(settings.largeAmountThreshold));
  const [thresholdMessage, setThresholdMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  useEffect(() => {
    setThreshold(formatNumber(settings.largeAmountThreshold));
  }, [settings.largeAmountThreshold]);
  const cancelThreshold = useCallback(() => {
    setThreshold(formatNumber(settings.largeAmountThreshold));
    setThresholdMessage(null); // 되돌리면 앞의 저장·오류 안내도 지웁니다.
  }, [settings.largeAmountThreshold]);
  const saveThreshold = useCallback(async () => {
    const t = parseAmount(threshold);
    if (t.kind !== 'ok') return setThresholdMessage({ kind: 'error', text: '큰 금액 확인 기준을 입력하세요.' });
    try {
      await update({ largeAmountThreshold: t.value });
      setThresholdMessage({ kind: 'info', text: '큰 금액 확인 기준을 저장했습니다.' });
    } catch (e) {
      // 저장소 오류는 영어일 수 있어 화면에는 한글 문장만 보이고, 원문은 콘솔에 남깁니다(기준은 바뀌지 않음).
      console.error('큰 금액 확인 기준 저장 실패', e);
      setThresholdMessage({ kind: 'error', text: '저장하지 못했습니다. 잠시 뒤 다시 시도하세요.' });
    }
  }, [threshold, update]);
  // 저장 때 정규화되는 값(공백·앞자리 0·쉼표)은 정규화한 뒤 비교해, 저장 후에도 변경으로 남지 않게 합니다.
  const thresholdDirty = (() => {
    const t = parseAmount(threshold);
    return t.kind !== 'ok' || t.value !== settings.largeAmountThreshold;
  })();
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
    const order = Number(form.sortOrder.trim() || NaN); // 빈칸이 0(맨 앞)으로 저장되지 않도록
    if (!Number.isSafeInteger(order) || order < 0) return setError('정렬 순서는 0 이상의 정수입니다.');
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
    threshold,
    setThreshold: (v: string) => {
      setThreshold(formatAmountInput(v));
      setThresholdMessage(null); // 다시 고치기 시작하면 앞의 저장 안내는 지웁니다.
    },
    saveThreshold,
    cancelThreshold,
    thresholdDirty,
    thresholdMessage,
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
