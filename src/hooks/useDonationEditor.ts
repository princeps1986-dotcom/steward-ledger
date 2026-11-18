import { useCallback, useMemo, useState } from 'react';
import { useDonationActions } from '../contexts/DonationContext';
import { useMemberById, useMembers } from '../contexts/MemberContext';
import { useOfferingTypes } from '../contexts/OfferingTypeContext';
import type { Donation } from '../contexts/types';
import { formatAmountInput, formatNumber, formatWon, parseAmount } from '../services/domain/amount';
import { isValidDateString, withWeekday } from '../services/domain/dates';
import { validateReason } from '../services/domain/donationOps';
import { currentHeadOf } from '../services/domain/memberRules';
import { memberLabel } from '../services/domain/search';

export type EditorMode = 'EDIT' | 'DELETE';

interface EditDraft {
  date: string;
  offeringTypeId: string;
  amount: string;
  memo: string;
  reason: string;
}

/** 보고서 상세 리스트 행의 수정/삭제. 사유는 필수입니다. */
export function useDonationEditor() {
  const { updateDonation, deleteDonation } = useDonationActions();
  const memberById = useMemberById();
  const members = useMembers();
  const types = useOfferingTypes();
  const [target, setTarget] = useState<Donation | null>(null);
  const [mode, setMode] = useState<EditorMode>('EDIT');
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback((d: Donation, m: EditorMode) => {
    setTarget(d);
    setMode(m);
    setError(null);
    setDraft({
      date: d.date,
      offeringTypeId: d.offeringTypeId,
      amount: formatNumber(d.amount),
      memo: d.memo ?? '',
      reason: '',
    });
  }, []);
  const close = useCallback(() => {
    setTarget(null);
    setDraft(null);
  }, []);

  const setField = useCallback(
    <K extends keyof EditDraft>(k: K) =>
      (v: EditDraft[K]) =>
        setDraft((d) => (d ? { ...d, [k]: k === 'amount' ? formatAmountInput(String(v)) : v } : d)),
    [],
  );

  /** 수정창에 보여 주는 성도·표기명(읽기 전용). 동명이인이면 현재 성도 정보로 구분 표기를 붙입니다. */
  const donorLabel = useMemo(() => {
    if (!target) return '';
    const m = target.memberId ? memberById.get(target.memberId) : undefined;
    if (!m) return `${target.donorDisplayName} (무명/방문자)`;
    return target.donorDisplayName === m.name ? memberLabel(m) : `${target.donorDisplayName} — ${memberLabel(m)}`;
  }, [target, memberById]);
  /** 수정창에서 표기명 옆에 보여 주는 세대 정보(읽기 전용, 현재 세대 기준). 세대 연결이 없거나 무명/방문자면 빈 문자열 */
  const donorHousehold = useMemo(() => {
    const m = target?.memberId ? memberById.get(target.memberId) : undefined;
    if (!m) return '';
    if (m.isFamilyHead) return '세대주';
    const head = m.familyGroupId ? currentHeadOf(members, m.familyGroupId) : undefined;
    return head ? `${head.name} 세대의 세대원` : '';
  }, [target, memberById, members]);
  // 선택 목록에는 헌금 종류 화면에서 활성인 종류만 보여 줍니다.
  // 이 내역의 현재 종류가 비활성이면 값이 엉뚱하게 보이지 않도록 선택 불가(회색)로만 함께 표시합니다.
  const typeOptions = useMemo(
    () =>
      types
        .filter((t) => t.isActive || t.id === target?.offeringTypeId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({ id: t.id, label: t.isActive ? t.name : `${t.name} (비활성)`, disabled: !t.isActive })),
    [types, target?.offeringTypeId],
  );

  const submit = useCallback(async () => {
    if (!target || !draft || busy) return;
    const reason = draft.reason.trim();
    const reasonError = validateReason(reason);
    if (reasonError) return setError(reasonError);
    setBusy(true);
    try {
      if (mode === 'DELETE') {
        await deleteDonation(target, reason);
      } else {
        if (!isValidDateString(draft.date)) return setError('날짜가 올바르지 않습니다.');
        const p = parseAmount(draft.amount);
        if (p.kind !== 'ok') return setError(p.kind === 'invalid' ? p.reason : '금액을 입력하세요.');
        // 성도·표기명·세대 스냅샷은 그대로 두고 날짜·종류·금액·메모만 바꿉니다.
        const next: Donation = {
          ...target,
          date: draft.date,
          offeringTypeId: draft.offeringTypeId,
          amount: p.value,
        };
        const memo = draft.memo.trim();
        if (memo) next.memo = memo;
        else delete next.memo;
        // 바뀐 내용이 없으면 의미 없는 수정 이력을 남기지 않습니다.
        if (next.date === target.date && next.offeringTypeId === target.offeringTypeId && next.amount === target.amount && (next.memo ?? '') === (target.memo ?? '')) {
          return setError('바뀐 내용이 없습니다. 수정할 항목을 바꿔 주세요.');
        }
        await updateDonation(target, next, reason);
      }
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [target, draft, busy, mode, deleteDonation, updateDonation, close]);

  return {
    isOpen: !!target && !!draft,
    mode,
    draft,
    setField,
    donorLabel,
    donorHousehold,
    typeOptions,
    targetSummary: target ? `${withWeekday(target.date)} ${target.donorDisplayName} ${formatWon(target.amount)}` : '',
    error,
    busy,
    open,
    close,
    submit,
  };
}

export type DonationEditorController = ReturnType<typeof useDonationEditor>;
