import type { AuditLog, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';
import { compact } from '../import/memberImportService';

/**
 * 다른 PC에서 만든 백업을 [선택한 연도만 교체]로 합칠 때, 같은 성도·헌금 종류가 중복되지 않도록
 * 백업의 id를 현재 PC의 id로 대응시키는 규칙(순수 함수).
 *
 * - 헌금 종류: id가 같거나, 이름이 같으면 같은 종류. 이름·연락처는 띄어쓰기를 빼고 비교합니다(불러오기와 같은 규칙).
 * - 성도: id가 같거나, 이름 + 연락처 뒷4자리가 모두 같으면 같은 사람.
 *   이름만 같고 연락처가 다르거나 없으면 동명이인일 수 있으므로 합치지 않고 새 성도로 추가합니다.
 */
export interface MergePlan {
  /** 백업 성도 id → 현재 성도 id (대응된 항목만) */
  memberIdMap: Map<string, string>;
  /** 백업 헌금 종류 id → 현재 종류 id (대응된 항목만) */
  typeIdMap: Map<string, string>;
  /** 백업 성도 id → 그 성도가 이 PC에서 속한 묶음 번호(대표자를 바꿨으면 성도 id와 다름). 헌금·성도의 묶음 값을 바꿀 때 씁니다. */
  groupIdMap: Map<string, string>;
  /** 현재 데이터에 새로 추가할 성도(familyGroupId는 대응 결과가 반영됨) */
  addMembers: Member[];
  /** 현재 데이터에 새로 추가할 헌금 종류 */
  addTypes: OfferingType[];
  /** 새로 추가되는 성도 중 현재 데이터에 같은 이름이 이미 있는 성도 수(동명이인 가능) */
  sameNameAdded: number;
}

const norm = (s: string | undefined): string => compact(s ?? '');

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
  // 새로 추가되는 성도가 가리키는 합산 묶음·대표자도 대응 결과로 바꿉니다.
  // 대응된 성도는 지금 속한 묶음 번호를 씁니다(이 PC에서 대표자를 바꿨으면 묶음 번호는 예전 대표자의 id로 남아 있으므로).
  const curGroupOf = new Map(current.members.map((m) => [m.id, m.familyGroupId]));
  const groupIdMap = new Map([...memberIdMap].map(([from, to]) => [from, curGroupOf.get(to) ?? to]));
  const addMembers = added.map((m) => {
    const group = (m.familyGroupId && groupIdMap.get(m.familyGroupId)) || m.familyGroupId;
    return group === m.familyGroupId ? m : { ...m, familyGroupId: group };
  });
  return { memberIdMap, groupIdMap, typeIdMap, addMembers, addTypes, sameNameAdded };
}

function remapDonation(d: Donation, plan: MergePlan): Donation {
  const memberId = d.memberId ? (plan.memberIdMap.get(d.memberId) ?? d.memberId) : d.memberId;
  const family = d.familyGroupIdSnapshot ? (plan.groupIdMap.get(d.familyGroupIdSnapshot) ?? d.familyGroupIdSnapshot) : d.familyGroupIdSnapshot;
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

/** 복원할 때 현재 성도·헌금 종류를 백업 내용으로 덮어쓸지(기본: 덮어쓰지 않고 백업에만 있는 항목만 추가) */
export interface RestoreOverwrite {
  members?: boolean;
  types?: boolean;
}

/**
 * 복원 후의 성도·헌금 종류 목록: 백업에만 있는 항목을 추가하고, 덮어쓰기를 고른 쪽은 백업과 같은 항목(id 또는 대응 규칙)을
 * 백업 내용으로 바꿉니다(id는 현재 것 유지 → 다른 연도 헌금의 연결이 그대로). 백업에 없는 현재 항목은 지우지 않습니다.
 */
export function restoredLists(
  current: { members: readonly Member[]; offeringTypes: readonly OfferingType[] },
  backup: Pick<BackupPayload, 'members' | 'offeringTypes'>,
  plan: MergePlan,
  overwrite: RestoreOverwrite = {},
): { members: Member[]; offeringTypes: OfferingType[]; updatedMembers: number; updatedTypes: number } {
  const replace = <T extends { id: string }>(cur: readonly T[], from: readonly T[], idMap: Map<string, string>, fix: (x: T) => T): [T[], number] => {
    const byCurId = new Map(from.map((b) => [idMap.get(b.id) ?? b.id, b]));
    let n = 0;
    const list = cur.map((c) => {
      const b = byCurId.get(c.id);
      if (!b) return c;
      n++;
      return fix({ ...b, id: c.id });
    });
    return [list, n];
  };
  const [members, updatedMembers] = overwrite.members
    ? replace(current.members, backup.members, plan.memberIdMap, (m) => (m.familyGroupId ? { ...m, familyGroupId: plan.groupIdMap.get(m.familyGroupId) ?? m.familyGroupId } : m))
    : [[...current.members], 0];
  const [offeringTypes, updatedTypes] = overwrite.types ? replace(current.offeringTypes, backup.offeringTypes, plan.typeIdMap, (t) => t) : [[...current.offeringTypes], 0];
  return { members: [...members, ...plan.addMembers], offeringTypes: [...offeringTypes, ...plan.addTypes], updatedMembers, updatedTypes };
}
