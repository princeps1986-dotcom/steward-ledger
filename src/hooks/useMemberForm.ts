import { useCallback, useMemo, useRef, useState } from 'react';
import { useMemberActions, useMembers } from '../contexts/MemberContext';
import type { Member } from '../contexts/types';
import type { MemberDraft } from '../services/domain/memberRules';
import { DEFAULT_POSITION, normalizePosition, positionOptions } from '../services/domain/positions';
import { memberLabel } from '../services/domain/search';
import { compareKo } from '../services/domain/compare';

/** 성도 등록/수정 폼 (성도 화면과 빠른 등록 모달 공용) */
export function useMemberForm(opts: { initial: MemberDraft; editingId?: string; onSaved(m: Member): void }) {
  const members = useMembers();
  const { saveMember } = useMemberActions();
  // 직분이 비어 있는 기존 성도는 선택 목록 기본값(성도)으로 표시
  const [draft, setDraft] = useState<MemberDraft>(() => ({ ...opts.initial, position: normalizePosition(opts.initial.position) || DEFAULT_POSITION }));
  // 목록에 없는 기존 직분(예: 집사)은 값이 유실되지 않도록 항목에 추가. 선택 중 목록이 바뀌지 않게 초기값 기준으로 고정
  const positionChoices = useMemo(() => positionOptions(opts.initial.position), [opts.initial.position]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // 상태는 다음 렌더 뒤에야 바뀌므로 연타를 즉시 막으려면 ref가 필요합니다.

  const headOptions = useMemo(
    () =>
      members
        .filter((m) => m.isActive && m.isFamilyHead && m.id !== opts.editingId)
        .sort((a, b) => compareKo(a.name, b.name))
        .map((m) => ({ id: m.id, label: memberLabel(m) })),
    [members, opts.editingId],
  );

  const setField = useCallback(
    <K extends keyof MemberDraft>(key: K) =>
      (value: MemberDraft[K]) => {
        setDraft((d) => {
          const next = { ...d, [key]: value };
          if (key === 'isFamilyHead' && value === true) next.headMemberId = '';
          if (key === 'phoneLast4') next.phoneLast4 = String(value).replace(/[^0-9]/g, '').slice(0, 4);
          return next;
        });
      },
    [],
  );

  const submit = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await saveMember(draft, opts.editingId);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        opts.onSaved(res.saved);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [saveMember, draft, opts]);

  return { draft, setField, headOptions, positionOptions: positionChoices, error, saving, submit };
}

export type MemberFormController = ReturnType<typeof useMemberForm>;
