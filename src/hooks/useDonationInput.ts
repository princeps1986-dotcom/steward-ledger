import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createExclusive } from './exclusive';
import { useDonationActions, useNextAnonymousName, useSaveHistory } from '../contexts/DonationContext';
import { useMembers } from '../contexts/MemberContext';
import { useActiveOfferingTypes, useOfferingTypeById } from '../contexts/OfferingTypeContext';
import { useSettings } from '../contexts/SettingsContext';
import type { Donation, DonationDraft, DuplicateResolution, Member } from '../contexts/types';
import { addQuickAmount, formatAmountInput, formatWon, parseAmount } from '../services/domain/amount';
import { shiftWeek } from '../services/domain/calendar';
import { isDateInRange, isValidDateString, lastSunday, withWeekday } from '../services/domain/dates';
import { compactName, memberLabel, searchMembers } from '../services/domain/search';

interface DuplicateItem {
  typeName: string;
  newAmount: number;
  existing: Donation;
}

interface PendingDuplicate {
  drafts: DonationDraft[];
  items: DuplicateItem[];
}

interface PendingLarge {
  drafts: DonationDraft[];
  items: { typeName: string; amount: number }[];
  firstFieldId: string;
}

type Message = { kind: 'error' | 'info'; text: string; undoable?: boolean } | null;

const EXTRA_FIELD = '__extra__';
const MEMO_FIELD = '__memo__';

const isComposing = (e: KeyboardEvent): boolean => e.nativeEvent.isComposing || e.keyCode === 229;

export function useDonationInput() {
  const members = useMembers();
  const activeTypes = useActiveOfferingTypes();
  const typeById = useOfferingTypeById();
  const settings = useSettings();
  const actions = useDonationActions();
  const history = useSaveHistory();

  const [date, setDateState] = useState(lastSunday);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Member | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  // null = 직접 고치지 않음 → 선택일 기준 자동 번호(무명N)를 그대로 사용
  const [anonNameEdit, setAnonNameEdit] = useState<string | null>(null);
  const autoAnonName = useNextAnonymousName(date);
  const anonName = anonNameEdit ?? autoAnonName;
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [extraTypeId, setExtraTypeId] = useState('');
  const [extraAmount, setExtraAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** ↑↓로 직접 고른 항목인지(동명이인이면 기본 강조만으로는 Enter 선택을 막습니다) */
  const [picked, setPicked] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);
  const [pendingLarge, setPendingLarge] = useState<PendingLarge | null>(null);
  const [quickRegisterOpen, setQuickRegisterOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // 저장에 성공할 때마다 1씩 올라가, 합계·메시지에 '저장됨' 효과를 다시 보여 줍니다.
  const [savedSeq, setSavedSeq] = useState(0);
  // 저장·복구하기가 진행되는 동안의 중복 실행 차단. 상태(saving)는 다음 렌더 뒤에야 바뀌므로 연타를 막지 못해 ref로 즉시 막습니다.
  const busyRef = useRef(false);
  const exclusive = useMemo(() => createExclusive(busyRef), []);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const primaryTypes = useMemo(() => activeTypes.filter((t) => t.displayArea === 'PRIMARY'), [activeTypes]);
  const dropdownTypes = useMemo(() => activeTypes.filter((t) => t.displayArea === 'DROPDOWN'), [activeTypes]);
  const results = useMemo(() => (anonymous || selected ? [] : searchMembers(members, query)), [anonymous, selected, members, query]);

  /** Enter 연쇄 이동 순서: 주요 헌금 금액 → (기타 금액) → 메모 */
  const fieldOrder = useMemo(
    () => [...primaryTypes.map((t) => t.id), ...(dropdownTypes.length ? [EXTRA_FIELD] : []), MEMO_FIELD],
    [primaryTypes, dropdownTypes],
  );

  useEffect(() => {
    void actions.ensureMonths([date.slice(0, 7)]);
  }, [actions, date]);

  /**
   * 대상 칸이 이미 렌더되어 있으면 즉시(동기) 포커스합니다. 다음 프레임으로 미루면 빠른 타건 시
   * 다음 금액이 이전 칸에 입력되는 경쟁 상태가 생깁니다. 모달 닫힘 직후처럼 포커스를 빼앗길 수 있는
   * 경우를 위해 다음 프레임에 한 번 더 보정합니다.
   */
  const focusField = useCallback((id: string) => {
    const apply = () => {
      const el = fieldRefs.current[id];
      if (el && document.activeElement !== el) {
        el.focus();
        el.select();
      }
    };
    apply();
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) apply();
    });
  }, []);
  const focusFirstAmount = useCallback(() => focusField(fieldOrder[0]), [focusField, fieldOrder]);
  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    // 무명 전환처럼 입력 요소가 교체되면 포커스가 body로 빠지므로 다음 프레임에 보정
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) searchRef.current?.focus();
    });
  }, []);

  const bindField = useCallback(
    (id: string) => (el: HTMLInputElement | null) => {
      fieldRefs.current[id] = el;
    },
    [],
  );

  const isFormEmpty =
    !selected && query === '' && memo === '' && extraAmount === '' && Object.values(amounts).every((v) => v === '');

  const resetForm = useCallback(() => {
    setQuery('');
    setSelected(null);
    setAnonymous(false);
    setAnonNameEdit(null);
    setAmounts({});
    setExtraTypeId('');
    setExtraAmount('');
    setMemo('');
    setDropdownOpen(false);
    focusSearch();
  }, [focusSearch]);

  // ── 성도 검색 ─────────────────────────────────────────
  const selectMember = useCallback(
    (m: Member) => {
      setSelected(m);
      setQuery(m.name);
      setDropdownOpen(false);
      setMessage(null);
      focusFirstAmount();
    },
    [focusFirstAmount],
  );

  const onQueryChange = useCallback((v: string) => {
    setQuery(v);
    setSelected(null);
    setDropdownOpen(true);
    setHighlight(0);
    setPicked(false);
  }, []);

  const openQuickRegister = useCallback(() => {
    setDropdownOpen(false);
    setQuickRegisterOpen(true);
  }, []);

  const onSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (isComposing(e) || e.ctrlKey || e.metaKey) return; // Ctrl+Enter는 전역 저장 단축키
      const optionCount = results.length + 1; // + 새 성도 즉시 등록
      if (e.key === 'ArrowDown' && !anonymous) {
        e.preventDefault();
        setDropdownOpen(true);
        setHighlight((h) => (h + 1) % optionCount);
        setPicked(true);
      } else if (e.key === 'ArrowUp' && !anonymous) {
        e.preventDefault();
        setHighlight((h) => (h - 1 + optionCount) % optionCount);
        setPicked(true);
      } else if (e.key === 'Escape') {
        setDropdownOpen(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (anonymous || selected) return focusFirstAmount();
        if (dropdownOpen && highlight < results.length) {
          // 이름이 똑같은 사람이 여럿이면 기본 강조(첫 사람)로 바로 고르지 않고 직접 고르게 합니다(다른 사람에게 기록되는 실수 방지).
          const name = compactName(results[highlight]);
          const same = results.filter((m) => compactName(m) === name).length;
          if (!picked && same > 1) return setMessage({ kind: 'error', text: `같은 이름이 ${same}명 있습니다. ↓ 키로 직분·연락처를 보고 고른 뒤 Enter를 누르세요.` });
          return selectMember(results[highlight]);
        }
        if (dropdownOpen && highlight === results.length && query.trim()) return openQuickRegister();
        if (results.length === 1) return selectMember(results[0]);
        setMessage({ kind: 'error', text: '성도를 목록에서 선택하거나 F2로 무명 모드를 사용하세요.' });
      }
    },
    [anonymous, selected, dropdownOpen, highlight, picked, results, query, focusFirstAmount, selectMember, openQuickRegister],
  );

  const onQuickRegistered = useCallback(
    (m: Member) => {
      setQuickRegisterOpen(false);
      selectMember(m);
    },
    [selectMember],
  );

  const toggleAnonymous = useCallback(() => {
    setAnonymous((a) => !a);
    setSelected(null);
    setQuery('');
    setAnonNameEdit(null);
    setDropdownOpen(false);
    focusSearch();
  }, [focusSearch]);

  // ── 금액·메모 ──────────────────────────────────────────
  const onAmountChange = useCallback((typeId: string, v: string) => {
    setAmounts((prev) => ({ ...prev, [typeId]: formatAmountInput(v) }));
  }, []);
  /** 금액 단추는 누를 때마다 현재 입력값에 더해집니다. (100,000을 두 번 → 200,000) */
  const onQuickAmount = useCallback((typeId: string, n: number) => {
    setAmounts((prev) => ({ ...prev, [typeId]: addQuickAmount(prev[typeId] ?? '', n) }));
  }, []);
  const onClearAmount = useCallback((typeId: string) => {
    setAmounts((prev) => ({ ...prev, [typeId]: '' }));
  }, []);
  /** 단축 금액 버튼 클릭 시 입력 칸 포커스 유지 */
  const keepFocus = useCallback((e: MouseEvent) => e.preventDefault(), []);
  const onExtraAmountChange = useCallback((v: string) => setExtraAmount(formatAmountInput(v)), []);

  // ── 저장 흐름 ─────────────────────────────────────────
  const commit = useCallback(
    async (drafts: DonationDraft[], resolution: DuplicateResolution) => {
      setSaving(true);
      try {
        const batch = await actions.saveBatch(drafts, resolution);
        const total = batch.lines.reduce((s, l) => s + l.amount, 0);
        const merged = batch.lines.some((l) => l.merged) ? ' (합산 포함)' : '';
        setMessage({ kind: 'info', text: `${batch.donorDisplayName} ${formatWon(total)} 저장${merged}`, undoable: true });
        setSavedSeq((n) => n + 1);
        resetForm();
      } catch (err) {
        setMessage({ kind: 'error', text: `저장 실패: ${(err as Error).message}` });
      } finally {
        setSaving(false);
      }
    },
    [actions, resetForm],
  );

  const checkDuplicatesAndCommit = useCallback(
    async (drafts: DonationDraft[]) => {
      if (drafts[0].memberId === null) return commit(drafts, 'SEPARATE');
      const found = await actions.findDuplicates(drafts);
      const items: DuplicateItem[] = [];
      found.forEach((existing, i) => {
        if (existing) {
          items.push({ typeName: typeById.get(drafts[i].offeringTypeId)?.name ?? '', newAmount: drafts[i].amount, existing });
        }
      });
      if (items.length) setPendingDuplicate({ drafts, items });
      else await commit(drafts, 'SEPARATE');
    },
    [actions, commit, typeById],
  );

  const buildDrafts = useCallback((): { drafts: DonationDraft[] } | { error: string; focus?: string } => {
    if (!isValidDateString(date)) return { error: '날짜가 올바르지 않습니다.' };
    if (!isDateInRange(date)) return { error: '날짜의 연도를 확인하세요.' };
    let memberId: string | null = null;
    let donorDisplayName: string;
    let snapshot: string | null = null;
    if (anonymous) {
      donorDisplayName = anonName.trim() || autoAnonName;
    } else {
      if (!selected) return { error: '성도를 선택하세요.' };
      memberId = selected.id;
      donorDisplayName = selected.name;
      snapshot = selected.familyGroupId ?? null;
    }
    const entries: { fieldId: string; typeId: string; raw: string }[] = primaryTypes.map((t) => ({
      fieldId: t.id,
      typeId: t.id,
      raw: amounts[t.id] ?? '',
    }));
    if (extraAmount) {
      if (!extraTypeId) return { error: '기타 헌금 종류를 선택하세요.', focus: EXTRA_FIELD };
      entries.push({ fieldId: EXTRA_FIELD, typeId: extraTypeId, raw: extraAmount });
    }
    const drafts: DonationDraft[] = [];
    for (const e of entries) {
      const p = parseAmount(e.raw);
      if (p.kind === 'invalid') return { error: `${typeById.get(e.typeId)?.name}: ${p.reason}`, focus: e.fieldId };
      if (p.kind === 'ok') {
        drafts.push({
          date,
          memberId,
          donorDisplayName,
          familyGroupIdSnapshot: snapshot,
          offeringTypeId: e.typeId,
          amount: p.value,
          memo: memo.trim() || undefined,
        });
      }
    }
    if (drafts.length === 0) return { error: '저장할 금액을 입력하세요.', focus: fieldOrder[0] };
    return { drafts };
  }, [date, anonymous, anonName, autoAnonName, selected, primaryTypes, amounts, extraAmount, extraTypeId, memo, typeById, fieldOrder]);

  const requestSave = useCallback(() => exclusive(async () => {
    if (saving) return;
    const built = buildDrafts();
    if ('error' in built) {
      setMessage({ kind: 'error', text: built.error });
      if (built.focus) focusField(built.focus);
      return;
    }
    const large = built.drafts.filter((d) => d.amount > settings.largeAmountThreshold);
    if (large.length) {
      setPendingLarge({
        drafts: built.drafts,
        items: large.map((d) => ({ typeName: typeById.get(d.offeringTypeId)?.name ?? '', amount: d.amount })),
        firstFieldId: primaryTypes.some((t) => t.id === large[0].offeringTypeId) ? large[0].offeringTypeId : EXTRA_FIELD,
      });
      return;
    }
    await checkDuplicatesAndCommit(built.drafts);
  }), [exclusive, saving, buildDrafts, settings.largeAmountThreshold, typeById, primaryTypes, focusField, checkDuplicatesAndCommit]);

  const confirmLarge = useCallback(
    () =>
      exclusive(async () => {
        const p = pendingLarge;
        setPendingLarge(null);
        if (p) await checkDuplicatesAndCommit(p.drafts);
      }),
    [exclusive, pendingLarge, checkDuplicatesAndCommit],
  );

  const cancelLarge = useCallback(() => {
    const p = pendingLarge;
    setPendingLarge(null);
    if (p) focusField(p.firstFieldId);
  }, [pendingLarge, focusField]);

  const resolveDuplicate = useCallback(
    (res: DuplicateResolution) =>
      exclusive(async () => {
        const p = pendingDuplicate;
        setPendingDuplicate(null);
        if (p) await commit(p.drafts, res);
      }),
    [exclusive, pendingDuplicate, commit],
  );

  const cancelDuplicate = useCallback(() => {
    setPendingDuplicate(null);
    focusField(MEMO_FIELD);
  }, [focusField]);

  // requestSave는 입력값마다 바뀌므로 ref로 읽어 onFieldKeyDown을 고정합니다(금액 칸 memo가 키 입력마다 깨지지 않도록).
  const requestSaveRef = useRef(requestSave);
  requestSaveRef.current = requestSave;
  const onFieldKeyDown = useCallback(
    (fieldId: string) => (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter' || isComposing(e) || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const idx = fieldOrder.indexOf(fieldId);
      if (idx >= 0 && idx < fieldOrder.length - 1) focusField(fieldOrder[idx + 1]);
      else void requestSaveRef.current();
    },
    [fieldOrder, focusField],
  );

  // ── 복구하기 ──────────────────────────────────────────
  const undo = useCallback(
    () =>
      exclusive(async () => {
        try {
          const b = await actions.undoLast();
          if (b) setMessage({ kind: 'info', text: `저장 취소: ${b.donorDisplayName} (${withWeekday(b.date)})` });
        } catch (err) {
          setMessage({ kind: 'error', text: `저장 취소 실패: ${(err as Error).message}` });
        }
        focusSearch();
      }),
    [exclusive, actions, focusSearch],
  );

  const modalOpen = !!pendingDuplicate || !!pendingLarge || quickRegisterOpen;

  // 전역 단축키: F2 무명 전환, 입력 칸이 비었을 때 Ctrl+Z 복구하기
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // 이 화면의 모달뿐 아니라 수정창 같은 다른 대화상자나 잠금 화면(inert는 창 전체 키 입력을 막지 못함)이 떠 있을 때도 단축키를 막습니다.
      if (modalOpen || document.querySelector('[role="dialog"][data-state="open"], [data-lock-screen]')) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        void requestSave();
      } else if (e.key === 'F2') {
        e.preventDefault();
        toggleAnonymous();
      } else if (e.key === 'F4') {
        e.preventDefault();
        document.getElementById('cash-count-input')?.focus();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && isFormEmpty && history.length > 0) {
        // 값이 든 칸(현금 계수 등)의 Ctrl+Z는 글자 복구하기이므로 저장 복구하기로 가로채지 않습니다.
        const t = e.target as HTMLInputElement | null;
        if ((t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') && t.value !== '') return;
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, toggleAnonymous, isFormEmpty, history.length, undo, requestSave]);

  const setDate = useCallback((v: string) => setDateState(v), []);
  const prevWeek = useCallback(() => setDateState((d) => (isValidDateString(d) ? shiftWeek(d, -1) : lastSunday())), []);
  const nextWeek = useCallback(() => setDateState((d) => (isValidDateString(d) ? shiftWeek(d, 1) : lastSunday())), []);
  const goLastSunday = useCallback(() => setDateState(lastSunday()), []);
  const closeDropdown = useCallback(() => setDropdownOpen(false), []);
  const closeQuickRegister = useCallback(() => setQuickRegisterOpen(false), []);

  // 자식 컴포넌트별 묶음: 관련 값이 바뀔 때만 새 객체가 되어, memo된 자식이 금액 입력에는 다시 렌더되지 않습니다.
  const resultLabels = useMemo(() => results.map(memberLabel), [results]);
  const selectedLabel = selected ? memberLabel(selected) : '';
  const showDropdown = dropdownOpen && !anonymous && !selected && query.trim() !== '';
  const search = useMemo(
    () => ({
      searchRef,
      query,
      onQueryChange,
      onSearchKeyDown,
      results,
      resultLabels,
      selectedLabel,
      selectMember,
      dropdownOpen: showDropdown,
      closeDropdown,
      highlight,
      setHighlight,
      anonymous,
      anonName,
      setAnonName: setAnonNameEdit,
      toggleAnonymous,
      openQuickRegister,
    }),
    [query, onQueryChange, onSearchKeyDown, results, resultLabels, selectedLabel, selectMember, showDropdown, closeDropdown, highlight, anonymous, anonName, toggleAnonymous, openQuickRegister],
  );
  const quickRegisterName = query.trim();
  const quickRegister = useMemo(
    () => ({ open: quickRegisterOpen, name: quickRegisterName, onClose: closeQuickRegister, onRegistered: onQuickRegistered }),
    [quickRegisterOpen, quickRegisterName, closeQuickRegister, onQuickRegistered],
  );
  const largeAmount = useMemo(() => ({ pending: pendingLarge, onConfirm: confirmLarge, onCancel: cancelLarge }), [pendingLarge, confirmLarge, cancelLarge]);
  const duplicate = useMemo(
    () => ({ pending: pendingDuplicate, onResolve: resolveDuplicate, onCancel: cancelDuplicate }),
    [pendingDuplicate, resolveDuplicate, cancelDuplicate],
  );

  return {
    /** 저장하지 않은 입력(검색어·고른 성도·직접 적은 방문자 이름·금액·메모)이 있는지 */
    hasDraft: query.trim() !== '' || selected !== null || !!anonNameEdit?.trim() || extraAmount !== '' || memo.trim() !== '' || Object.values(amounts).some((v) => v !== ''),
    date,
    setDate,
    prevWeek,
    nextWeek,
    goLastSunday,
    search,
    quickRegister,
    largeAmount,
    duplicate,
    // 금액
    primaryTypes,
    dropdownTypes,
    amounts,
    onAmountChange,
    onQuickAmount,
    onClearAmount,
    keepFocus,
    extraTypeId,
    setExtraTypeId,
    extraAmount,
    onExtraAmountChange,
    memo,
    setMemo,
    bindField,
    onFieldKeyDown,
    extraFieldId: EXTRA_FIELD,
    memoFieldId: MEMO_FIELD,
    // 저장
    saving,
    requestSave,
    savedSeq,
    // 성도가 한 명도 없는 처음 상태(시작 안내를 보여 줌)
    isFirstRun: members.length === 0,
    message,
    // 복구하기
    canUndo: history.length > 0,
    undo,
  };
}

type DonationInputController = ReturnType<typeof useDonationInput>;
export type MemberSearchController = DonationInputController['search'];
export type QuickRegisterController = DonationInputController['quickRegister'];
export type LargeAmountController = DonationInputController['largeAmount'];
export type DuplicateController = DonationInputController['duplicate'];

/** 모달이 닫힐 때 포커스를 원래 자리로 돌려보내지 않습니다(다음 입력 칸 포커스는 훅이 직접 맞춤). */
export const preventAutoFocus = (e: Event) => e.preventDefault();
