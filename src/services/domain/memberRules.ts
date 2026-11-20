import type { Member } from '../../contexts/types';
import { formatDateTime, isValidDateString, todayString } from './dates';
import { newId, nowIso } from './ids';
import { normalizePosition } from './positions';

export interface MemberDraft {
  name: string;
  position: string;
  phoneLast4: string;
  isFamilyHead: boolean;
  /** 세대원일 때 연결할 세대주의 Member.id ('' = 연결 없음) */
  headMemberId: string;
  /** 등록일 YYYY-MM-DD ('' = 새 등록 시 오늘 날짜) */
  registeredAt: string;
}

export const EMPTY_MEMBER_DRAFT: MemberDraft = {
  name: '',
  position: '',
  phoneLast4: '',
  isFamilyHead: false,
  headMemberId: '',
  registeredAt: '',
};

export type MemberSaveResult = { ok: true; members: Member[]; saved: Member } | { ok: false; error: string };

export function validateDraft(d: MemberDraft): string | null {
  if (!d.name.trim()) return '이름을 입력하세요.';
  if (d.phoneLast4 && !/^\d{4}$/.test(d.phoneLast4)) return '연락처 뒷자리는 숫자 4자리입니다.';
  if (d.registeredAt && !isValidDateString(d.registeredAt)) return '등록일이 올바른 날짜가 아닙니다.';
  return null;
}

/** 화면에 보여 줄 등록일. 등록일이 없는 기존 성도는 처음 저장된 날짜(createdAt, 서울 기준)로 대신합니다. */
export function registeredDateOf(m: Member): string {
  return m.registeredAt ?? (m.createdAt ? formatDateTime(m.createdAt).slice(0, 10) : '');
}

/** 옛 데이터에 남은 생년월일(개인정보)을 뺍니다. 바뀐 게 없으면 같은 배열과 changed=false를 돌려줍니다. */
export function stripBirthDate(members: Member[]): { members: Member[]; changed: boolean } {
  let changed = false;
  const out = members.map((m) => {
    if (!('birthDate' in m)) return m;
    changed = true;
    const { birthDate: _removed, ...rest } = m as Member & { birthDate?: unknown };
    return rest;
  });
  return { members: changed ? out : members, changed };
}

/** 그룹의 현재 세대주 (없으면 그룹 ID와 같은 id의 성도) */
export function currentHeadOf(members: Member[], groupId: string): Member | undefined {
  return (
    members.find((m) => m.familyGroupId === groupId && m.isFamilyHead && m.isActive) ??
    members.find((m) => m.familyGroupId === groupId && m.isFamilyHead) ??
    members.find((m) => m.id === groupId)
  );
}

/** 편집 폼 초기값으로 쓰는 현재 연결 세대주 id */
export function linkedHeadIdOf(members: Member[], m: Member): string {
  if (m.isFamilyHead || !m.familyGroupId) return '';
  return currentHeadOf(members, m.familyGroupId)?.id ?? '';
}

function base(d: MemberDraft): Pick<Member, 'name' | 'position' | 'phoneLast4'> {
  return {
    name: d.name.trim(),
    position: normalizePosition(d.position),
    phoneLast4: d.phoneLast4 || undefined,
  };
}

/**
 * 성도 저장 규칙 (PRD §3.2 세대 그룹 규칙)
 * - 세대주 지정: 그룹이 없으면 familyGroupId = 본인 id
 * - 기존 그룹 구성원을 세대주로 지정: 그룹 ID는 유지하고 isFamilyHead만 이전
 * - 세대원이 남아 있는 세대주는 해제 불가
 */
export function applyMemberSave(members: Member[], draft: MemberDraft, editingId?: string): MemberSaveResult {
  const err = validateDraft(draft);
  if (err) return { ok: false, error: err };
  const now = nowIso();
  // 배열만 복사하고, 바꾸는 성도만 그 자리에서 복사합니다(가져오기처럼 여러 번 부를 때 전체를 매번 복사하지 않도록).
  const list = [...members];
  const own = (i: number): Member => (list[i] = { ...list[i] });
  const headIdx = draft.headMemberId ? list.findIndex((m) => m.id === draft.headMemberId) : -1;
  if (draft.headMemberId && headIdx < 0) return { ok: false, error: '연결할 세대주를 찾을 수 없습니다.' };
  const head = headIdx >= 0 ? list[headIdx] : undefined;

  const ensureHeadGroup = (): string => {
    if (list[headIdx].familyGroupId) return list[headIdx].familyGroupId!;
    const h = own(headIdx);
    h.familyGroupId = h.id;
    h.updatedAt = now;
    return h.familyGroupId;
  };

  if (!editingId) {
    const id = newId();
    const m: Member = {
      id,
      ...base(draft),
      isFamilyHead: draft.isFamilyHead,
      familyGroupId: draft.isFamilyHead ? id : head ? ensureHeadGroup() : undefined,
      isActive: true,
      registeredAt: draft.registeredAt || todayString(),
      createdAt: now,
      updatedAt: now,
    };
    list.push(m);
    return { ok: true, members: list, saved: m };
  }

  const idx = list.findIndex((x) => x.id === editingId);
  if (idx < 0) return { ok: false, error: '성도를 찾을 수 없습니다.' };
  if (head && head.id === editingId) return { ok: false, error: '본인을 세대주로 연결할 수 없습니다.' };
  const m = own(idx);
  Object.assign(m, base(draft), { updatedAt: now });
  if (draft.registeredAt) m.registeredAt = draft.registeredAt;

  if (draft.isFamilyHead && !m.isFamilyHead) {
    if (m.familyGroupId) {
      // 세대주 변경: 그룹 ID 유지, 기존 세대주 플래그 해제
      list.forEach((o, i) => {
        if (o.id !== m.id && o.familyGroupId === m.familyGroupId && o.isFamilyHead) Object.assign(own(i), { isFamilyHead: false, updatedAt: now });
      });
    } else {
      m.familyGroupId = m.id;
    }
    m.isFamilyHead = true;
  } else if (!draft.isFamilyHead && m.isFamilyHead) {
    const others = list.filter((o) => o.id !== m.id && o.isActive && o.familyGroupId && o.familyGroupId === m.familyGroupId);
    if (others.length > 0) {
      return { ok: false, error: '세대원이 있는 세대주는 해제할 수 없습니다. 다른 구성원을 세대주로 지정하세요.' };
    }
    m.isFamilyHead = false;
    m.familyGroupId = head ? ensureHeadGroup() : undefined;
  } else if (!draft.isFamilyHead) {
    m.familyGroupId = head ? ensureHeadGroup() : undefined;
  }
  return { ok: true, members: list, saved: m };
}

/** 비활성화(Soft Delete) 가능 여부 */
export function canDeactivate(members: Member[], m: Member): string | null {
  if (!m.isFamilyHead || !m.familyGroupId) return null;
  const others = members.filter((o) => o.id !== m.id && o.isActive && o.familyGroupId === m.familyGroupId);
  return others.length > 0 ? '세대원이 있는 세대주입니다. 먼저 다른 구성원을 세대주로 지정하세요.' : null;
}
