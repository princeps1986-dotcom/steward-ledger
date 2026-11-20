import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useMemberActions, useMembers } from '../contexts/MemberContext';
import type { Member } from '../contexts/types';
import { canDeactivate, currentHeadOf, EMPTY_MEMBER_DRAFT, linkedHeadIdOf, registeredDateOf, type MemberDraft } from '../services/domain/memberRules';
import { memberComparator, type MemberSortKey, type SortDir } from '../services/domain/memberSort';
import { matchMember } from '../services/domain/search';

interface MemberRow {
  member: Member;
  familyLabel: string;
  stateLabel: string;
  registeredLabel: string;
}

export function useMembersPage() {
  const members = useMembers();
  const { setActive } = useMemberActions();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query); // 글자를 칠 때 입력 칸이 먼저 반응하고, 많은 목록은 뒤따라 갱신
  const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState<{ key: number; editingId?: string; initial: MemberDraft } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: MemberSortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [confirming, setConfirming] = useState<Member | null>(null);

  const rows: MemberRow[] = useMemo(
    () =>
      members
        .filter((m) => (showInactive || m.isActive) && (deferredQuery.trim() === '' || matchMember(m, deferredQuery)))
        .map((m) => ({
          member: m,
          familyLabel: m.familyGroupId ? `${currentHeadOf(members, m.familyGroupId)?.name ?? '?'} 세대` : '-',
          stateLabel: m.isActive ? '활성' : '비활성',
          registeredLabel: registeredDateOf(m) || '-',
        }))
        .sort(memberComparator(sort.key, sort.dir)),
    [members, deferredQuery, showInactive, sort],
  );

  const openNew = useCallback(() => setEditor({ key: Date.now(), initial: EMPTY_MEMBER_DRAFT }), []);
  const openEdit = useCallback(
    (m: Member) =>
      setEditor({
        key: Date.now(),
        editingId: m.id,
        initial: {
          name: m.name,
          position: m.position,
          phoneLast4: m.phoneLast4 ?? '',
          isFamilyHead: m.isFamilyHead,
          headMemberId: linkedHeadIdOf(members, m),
          registeredAt: registeredDateOf(m),
        },
      }),
    [members],
  );
  const closeEditor = useCallback(() => setEditor(null), []);
  const onSaved = useCallback((m: Member) => {
    setEditor(null);
    setMessage(`${m.name} 저장 완료`);
  }, []);

  /** 같은 열을 다시 누르면 방향 전환, 다른 열을 누르면 오름차순으로 시작 */
  const toggleSort = useCallback(
    (key: MemberSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })),
    [],
  );

  const askToggleActive = useCallback(
    (m: Member) => {
      // 세대원이 남은 세대주는 비활성화할 수 없으므로 확인창을 띄우기 전에 이유를 알려 줍니다.
      const blocked = m.isActive ? canDeactivate(members, m) : null;
      if (blocked) setMessage(blocked);
      else setConfirming(m);
    },
    [members],
  );
  const cancelToggleActive = useCallback(() => setConfirming(null), []);
  const confirmToggleActive = useCallback(async () => {
    const m = confirming;
    setConfirming(null);
    if (!m) return;
    const verb = m.isActive ? '비활성화' : '복구';
    const err = await setActive(m.id, !m.isActive);
    setMessage(err ?? `${m.name} ${verb} 완료`);
  }, [confirming, setActive]);

  return {
    query,
    setQuery,
    showInactive,
    setShowInactive,
    rows,
    total: members.filter((m) => m.isActive).length,
    editor,
    openNew,
    openEdit,
    closeEditor,
    onSaved,
    sort,
    toggleSort,
    confirming,
    confirmingText: confirming
      ? confirming.isActive
        ? {
            title: `${confirming.name} 성도를 비활성화할까요?`,
            body: '비활성 성도는 헌금 입력의 성도 검색에 나오지 않습니다. 과거 헌금 기록과 통계는 그대로 보존되며, "비활성 성도 포함"을 체크하면 다시 볼 수 있고 언제든 [복구]할 수 있습니다.',
            ok: '비활성화',
          }
        : {
            title: `${confirming.name} 성도를 복구할까요?`,
            body: '다시 활성 성도가 되어 헌금 입력의 성도 검색에 나옵니다.',
            ok: '복구',
          }
      : null,
    askToggleActive,
    cancelToggleActive,
    confirmToggleActive,
    importOpen,
    openImport: () => setImportOpen(true),
    closeImport: () => setImportOpen(false),
    message,
  };
}
