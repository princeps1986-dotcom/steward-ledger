import type { AuditLog, Donation, DonationDraft } from '../../contexts/types';
import { currentUser } from '../auth/currentUser';
import { newId, nowIso } from './ids';

/**
 * 메모리에 있는 한 달 목록에 행 단위 변경을 반영합니다. 같은 id를 바꾸면 그 자리에서 교체하고(날짜만 바뀐 경우 포함),
 * 지우기만 한 id는 빼며, 새 내역은 끝에 붙입니다.
 */
export function applyRowOps(list: Donation[], puts: Donation[], deletes: readonly (readonly [string, string])[]): Donation[] {
  const putById = new Map(puts.map((p) => [p.id, p]));
  const del = new Set(deletes.map(([, id]) => id));
  const out: Donation[] = [];
  const used = new Set<string>();
  for (const d of list) {
    const p = putById.get(d.id);
    if (p) {
      out.push(p);
      used.add(d.id);
    } else if (!del.has(d.id)) out.push(d);
  }
  for (const p of puts) if (!used.has(p.id)) out.push(p);
  return out;
}

export function buildDonation(draft: DonationDraft, id = newId(), now = nowIso()): Donation {
  const memo = draft.memo?.trim();
  return {
    id,
    date: draft.date,
    memberId: draft.memberId,
    donorDisplayName: draft.donorDisplayName,
    familyGroupIdSnapshot: draft.familyGroupIdSnapshot,
    offeringTypeId: draft.offeringTypeId,
    amount: draft.amount,
    ...(memo ? { memo } : {}),
    createdAt: now,
  };
}

function joinMemo(a?: string, b?: string): string | undefined {
  const parts = [a?.trim(), b?.trim()].filter((s): s is string => !!s);
  return parts.length ? parts.join(' / ') : undefined;
}

/** 기존 내역에 금액을 합산하고 메모를 병기합니다. */
export function mergeDonation(existing: Donation, draft: DonationDraft): Donation {
  const memo = joinMemo(existing.memo, draft.memo);
  const merged: Donation = { ...existing, amount: existing.amount + draft.amount };
  if (memo) merged.memo = memo;
  else delete merged.memo;
  return merged;
}

export function makeAudit(
  action: AuditLog['action'],
  before: Donation,
  after: Donation | null,
  reason: string,
  now = nowIso(),
): AuditLog {
  const r = reason.trim();
  if (!r) throw new Error('감사 로그 사유는 필수입니다.');
  const actor = currentUser()?.email; // 로그인이 없는 브라우저 모드에서는 기록하지 않습니다.
  return { id: newId(), targetId: before.id, action, beforeSnapshot: before, afterSnapshot: after, reason: r, timestamp: now, ...(actor ? { actor } : {}) };
}

export const REASON_MERGE = '동일 내역 복수 헌금 합산';
export const REASON_UNDO = '입력 직후 복구하기';

/** 수정·삭제 사유에 들어가야 하는 한글 글자 수(공백·숫자·영문은 세지 않음) */
const MIN_REASON_HANGUL = 4;

/** 사유 검사: 양 옆 공백을 뺀 글자가 비어 있지 않고 한글이 4글자 이상이어야 합니다. 통과하면 null, 아니면 안내 문구. */
export function validateReason(raw: string): string | null {
  const r = raw.trim();
  if (!r) return '사유를 입력하세요. (필수)';
  const hangul = (r.match(/[가-힣]/g) ?? []).length;
  return hangul < MIN_REASON_HANGUL ? `사유에는 한글이 ${MIN_REASON_HANGUL}글자 이상 들어가야 합니다.` : null;
}
