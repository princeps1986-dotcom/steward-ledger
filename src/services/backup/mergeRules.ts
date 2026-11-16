import type { AuditLog, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';

/**
 * 다른 PC에서 만든 백업을 [선택한 연도만 교체]로 합칠 때, 같은 성도·헌금 종류가 중복되지 않도록
 * 백업의 id를 현재 PC의 id로 대응시키는 규칙(순수 함수).
 *
 * - 헌금 종류: id가 같거나, 이름이 같으면 같은 종류.
 * - 성도: id가 같거나, 이름 + 연락처 뒷4자리가 모두 같으면 같은 사람.
 *   이름만 같고 연락처가 다르거나 없으면 동명이인일 수 있으므로 합치지 않고 새 성도로 추가합니다.
 */
export interface MergePlan {
  /** 백업 성도 id → 현재 성도 id (대응된 항목만) */
  memberIdMap: Map<string, string>;
  /** 백업 헌금 종류 id → 현재 종류 id (대응된 항목만) */
  typeIdMap: Map<string, string>;
  /** 현재 데이터에 새로 추가할 성도(familyGroupId는 대응 결과가 반영됨) */
  addMembers: Member[];
  /** 현재 데이터에 새로 추가할 헌금 종류 */
  addTypes: OfferingType[];
  /** 새로 추가되는 성도 중 현재 데이터에 같은 이름이 이미 있는 성도 수(동명이인 가능) */
  sameNameAdded: number;
}

const norm = (s: string | undefined): string => (s ?? '').trim();

export function planMerge(current: { members: readonly Member[]; offeringTypes: readonly OfferingType[] }, backup: Pick<BackupPayload, 'members' | 'offeringTypes'>): MergePlan {
  const typeIdMap = new Map<string, string>();
  const addTypes: OfferingType[] = [];
  const curTypeById = new Set(current.offeringTypes.map((t) => t.id));
  const curTypeByName = new Map<string, OfferingType>();
  for (const t of current.offeringTypes) if (!curTypeByName.has(norm(t.name))) curTypeByName.set(norm(t.name), t);
  for (const t of backup.offeringTypes) {
    if (curTypeById.has(t.id)) continue; // 같은 id: 그대로 사용
    const same = curTypeByName.get(norm(t.name));
    if (same) typeIdMap.set(t.id, same.id);
    else addTypes.push(t);
  }

  const memberIdMap = new Map<string, string>();
  const curMemberById = new Set(current.members.map((m) => m.id));
  const curByKey = new Map<string, Member>();
  const curNames = new Set<string>();
  for (const m of current.members) {
    curNames.add(norm(m.name));
    if (norm(m.phoneLast4)) {
      const k = `${norm(m.name)}|${norm(m.phoneLast4)}`;
      if (!curByKey.has(k)) curByKey.set(k, m);
    }
  }
  const added: Member[] = [];
  let sameNameAdded = 0;
  for (const m of backup.members) {
    if (curMemberById.has(m.id)) continue;
    const same = norm(m.phoneLast4) ? curByKey.get(`${norm(m.name)}|${norm(m.phoneLast4)}`) : undefined;
    if (same) memberIdMap.set(m.id, same.id);
    else {
      added.push(m);
      if (curNames.has(norm(m.name))) sameNameAdded++;
    }
  }
  // 새로 추가되는 성도가 가리키는 세대 그룹·세대주도 대응 결과로 바꿉니다.
  const addMembers = added.map((m) => {
    const group = m.familyGroupId ? (memberIdMap.get(m.familyGroupId) ?? m.familyGroupId) : m.familyGroupId;
    return group === m.familyGroupId ? m : { ...m, familyGroupId: group };
  });
  return { memberIdMap, typeIdMap, addMembers, addTypes, sameNameAdded };
}

function remapDonation(d: Donation, plan: MergePlan): Donation {
  const memberId = d.memberId ? (plan.memberIdMap.get(d.memberId) ?? d.memberId) : d.memberId;
  const family = d.familyGroupIdSnapshot ? (plan.memberIdMap.get(d.familyGroupIdSnapshot) ?? d.familyGroupIdSnapshot) : d.familyGroupIdSnapshot;
  const typeId = plan.typeIdMap.get(d.offeringTypeId) ?? d.offeringTypeId;
  if (memberId === d.memberId && family === d.familyGroupIdSnapshot && typeId === d.offeringTypeId) return d;
  return { ...d, memberId, familyGroupIdSnapshot: family, offeringTypeId: typeId };
}

export function remapDonations(list: readonly Donation[], plan: MergePlan): Donation[] {
  if (plan.memberIdMap.size === 0 && plan.typeIdMap.size === 0) return list as Donation[];
  return list.map((d) => remapDonation(d, plan));
}

export function remapAudits(list: readonly AuditLog[], plan: MergePlan): AuditLog[] {
  if (plan.memberIdMap.size === 0 && plan.typeIdMap.size === 0) return list as AuditLog[];
  return list.map((a) => ({
    ...a,
    beforeSnapshot: remapDonation(a.beforeSnapshot, plan),
    afterSnapshot: a.afterSnapshot ? remapDonation(a.afterSnapshot, plan) : a.afterSnapshot,
  }));
}
