import { useCallback, useMemo, useState } from 'react';
import { useDonationActions } from '../contexts/DonationContext';
import { useMemberById, useMembers } from '../contexts/MemberContext';
import { useOfferingTypes } from '../contexts/OfferingTypeContext';
import type { Donation } from '../contexts/types';
import { formatAmountInput, formatNumber, formatWon, parseAmount } from '../services/domain/amount';
import { isValidDateString } from '../services/domain/dates';
import { memberLabel } from '../services/domain/search';

export type EditorMode = 'EDIT' | 'DELETE';

interface EditDraft {
  date: string;
  memberId: string; // '' = 무명/방문자
  donorDisplayName: string;
  offeringTypeId: string;
  amount: string;
  memo: string;
  reason: string;
}

/** 보고서 상세 리스트 행의 수정/삭제. 사유는 필수입니다. */
export function useDonationEditor() {
  const { updateDonation, deleteDonation } = useDonationActions();
  const members = useMembers();
  const memberById = useMemberById();
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
      memberId: d.memberId ?? '',
      donorDisplayName: d.donorDisplayName,
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

  const memberOptions = useMemo(
    () =>
      members
        .filter((m) => m.isActive || m.id === target?.memberId)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
        .map((m) => ({ id: m.id, label: memberLabel(m) })),
    [members, target?.memberId],
  );
  const typeOptions = useMemo(
    () =>
      types
        .filter((t) => t.isActive || t.id === target?.offeringTypeId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({ id: t.id, label: t.name })),
    [types, target?.offeringTypeId],
  );

  const submit = useCallback(async () => {
    if (!target || !draft || busy) return;
    const reason = draft.reason.trim();
    if (!reason) return setError('사유를 입력하세요. (필수)');
    setBusy(true);
    try {
      if (mode === 'DELETE') {
        await deleteDonation(target, reason);
      } else {
        if (!isValidDateString(draft.date)) return setError('날짜가 올바르지 않습니다.');
        const p = parseAmount(draft.amount);
        if (p.kind !== 'ok') return setError(p.kind === 'invalid' ? p.reason : '금액을 입력하세요.');
        const member = draft.memberId ? memberById.get(draft.memberId) : undefined;
        if (draft.memberId && !member) return setError('성도를 찾을 수 없습니다.');
        const memberChanged = (target.memberId ?? '') !== draft.memberId;
        const next: Donation = {
          ...target,
          date: draft.date,
          memberId: member?.id ?? null,
          donorDisplayName: member ? (memberChanged ? member.name : target.donorDisplayName) : draft.donorDisplayName.trim() || '무명',
          // 성도가 바뀌면 바뀐 성도의 현재 세대를 스냅샷으로 사용
          familyGroupIdSnapshot: memberChanged ? member?.familyGroupId ?? null : target.familyGroupIdSnapshot ?? null,
          offeringTypeId: draft.offeringTypeId,
          amount: p.value,
        };
        const memo = draft.memo.trim();
        if (memo) next.memo = memo;
        else delete next.memo;
        await updateDonation(target, next, reason);
      }
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [target, draft, busy, mode, deleteDonation, updateDonation, memberById, close]);

  return {
    isOpen: !!target && !!draft,
    mode,
    draft,
    setField,
    memberOptions,
    typeOptions,
    targetSummary: target ? `${target.date} ${target.donorDisplayName} ${formatWon(target.amount)}` : '',
    error,
    busy,
    open,
    close,
    submit,
  };
}

export type DonationEditorController = ReturnType<typeof useDonationEditor>;
