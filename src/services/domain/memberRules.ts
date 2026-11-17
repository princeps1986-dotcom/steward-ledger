import type { Member } from '../../contexts/types';
import { newId, nowIso } from './ids';
import { normalizePosition } from './positions';

export interface MemberDraft {
  name: string;
  position: string;
  phoneLast4: string;
  isFamilyHead: boolean;
  /** 세대원일 때 연결할 세대주의 Member.id ('' = 연결 없음) */
  headMemberId: string;
}

export const EMPTY_MEMBER_DRAFT: MemberDraft = {
  name: '',
  position: '',
  phoneLast4: '',
  isFamilyHead: false,
  headMemberId: '',
};

export type MemberSaveResult = { ok: true; members: Member[]; saved: Member } | { ok: false; error: string };

export function validateDraft(d: MemberDraft): string | null {
  if (!d.name.trim()) return '이름을 입력하세요.';
  if (d.phoneLast4 && !/^\d{4}$/.test(d.phoneLast4)) return '연락처 뒷자리는 숫자 4자리입니다.';
  return null;
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
  const list = members.map((m) => ({ ...m }));
  const head = draft.headMemberId ? list.find((m) => m.id === draft.headMemberId) : undefined;
  if (draft.headMemberId && !head) return { ok: false, error: '연결할 세대주를 찾을 수 없습니다.' };

  const ensureHeadGroup = (h: Member): string => {
    if (!h.familyGroupId) {
      h.familyGroupId = h.id;
      h.updatedAt = now;
    }
    return h.familyGroupId;
  };

  if (!editingId) {
    const id = newId();
    const m: Member = {
      id,
      ...base(draft),
      isFamilyHead: draft.isFamilyHead,
      familyGroupId: draft.isFamilyHead ? id : head ? ensureHeadGroup(head) : undefined,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    list.push(m);
    return { ok: true, members: list, saved: m };
  }

  const m = list.find((x) => x.id === editingId);
  if (!m) return { ok: false, error: '성도를 찾을 수 없습니다.' };
  if (head && head.id === m.id) return { ok: false, error: '본인을 세대주로 연결할 수 없습니다.' };
  Object.assign(m, base(draft), { updatedAt: now });

  if (draft.isFamilyHead && !m.isFamilyHead) {
    if (m.familyGroupId) {
      // 세대주 변경: 그룹 ID 유지, 기존 세대주 플래그 해제
      for (const o of list) {
        if (o.id !== m.id && o.familyGroupId === m.familyGroupId && o.isFamilyHead) {
          o.isFamilyHead = false;
          o.updatedAt = now;
        }
      }
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
    m.familyGroupId = head ? ensureHeadGroup(head) : undefined;
  } else if (!draft.isFamilyHead) {
    m.familyGroupId = head ? ensureHeadGroup(head) : undefined;
  }
  return { ok: true, members: list, saved: m };
}

/** 비활성화(Soft Delete) 가능 여부 */
export function canDeactivate(members: Member[], m: Member): string | null {
  if (!m.isFamilyHead || !m.familyGroupId) return null;
  const others = members.filter((o) => o.id !== m.id && o.isActive && o.familyGroupId === m.familyGroupId);
  return others.length > 0 ? '세대원이 있는 세대주입니다. 먼저 다른 구성원을 세대주로 지정하세요.' : null;
}
