import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuditLog, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';
import { KEYS, getItem, transact } from '../storage/storageService';
import { planFor } from './streamRestore';
import { payloadNow, restorePayload } from './testPayload';
import { planMerge, remapAudits, remapDonations, restoredLists } from './mergeRules';

const m = (id: string, name: string, phoneLast4?: string, extra: Partial<Member> = {}): Member =>
  ({ id, name, position: '', phoneLast4, isFamilyHead: true, isActive: true, createdAt: '', updatedAt: '', ...extra }) as Member;
const t = (id: string, name: string): OfferingType => ({ id, name, displayArea: 'PRIMARY', quickAmounts: [], sortOrder: 1, isActive: true });
const d = (id: string, date: string, memberId: string | null, typeId: string): Donation =>
  ({ id, date, memberId, donorDisplayName: 'x', offeringTypeId: typeId, amount: 1000, createdAt: '' }) as Donation;

describe('planMerge (다른 PC 백업 합치기 규칙)', () => {
  const cur = { members: [m('c1', '김영수', '1234'), m('c2', '이철수')], offeringTypes: [t('ct1', '십일조')] };

  it('같은 이름의 헌금 종류는 현재 종류에 연결하고 없는 종류만 추가한다', () => {
    const p = planMerge(cur, { members: [], offeringTypes: [t('b1', '십일조'), t('b2', '감사')] });
    expect(p.typeIdMap.get('b1')).toBe('ct1');
    expect(p.addTypes.map((x) => x.id)).toEqual(['b2']);
  });

  it('id가 같으면 같은 항목이라 아무것도 하지 않는다', () => {
    const p = planMerge(cur, { members: [m('c1', '김영수', '1234')], offeringTypes: [t('ct1', '십일조')] });
    expect(p.memberIdMap.size + p.typeIdMap.size + p.addMembers.length + p.addTypes.length).toBe(0);
  });

  it('이름 + 연락처 뒷4자리가 같으면 같은 성도로 연결한다', () => {
    const p = planMerge(cur, { members: [m('b1', '김영수', '1234')], offeringTypes: [] });
    expect(p.memberIdMap.get('b1')).toBe('c1');
    expect(p.addMembers).toHaveLength(0);
  });

  it('이름만 같고 연락처가 다르거나 없으면 새 성도로 추가하고 동명이인으로 센다', () => {
    const p = planMerge(cur, { members: [m('b1', '김영수', '9999'), m('b2', '이철수'), m('b3', '박민수')], offeringTypes: [] });
    expect(p.addMembers.map((x) => x.id)).toEqual(['b1', 'b2', 'b3']);
    expect(p.sameNameAdded).toBe(2);
  });

  it('새로 추가되는 성도의 세대 그룹이 연결된 성도를 가리키면 현재 id로 바꾼다', () => {
    const p = planMerge(cur, { members: [m('b1', '김영수', '1234'), m('b2', '김영희', undefined, { isFamilyHead: false, familyGroupId: 'b1' })], offeringTypes: [] });
    expect(p.addMembers).toHaveLength(1);
    expect(p.addMembers[0].familyGroupId).toBe('c1');
  });

  it('연결된 성도가 이 PC에서 다른 세대 번호(세대주를 바꾼 세대)에 있으면 그 번호를 쓴다', () => {
    const here = { members: [m('c0', '김부친', undefined, { familyGroupId: 'c0' }), m('c1', '김영수', '1234', { isFamilyHead: true, familyGroupId: 'c0' })], offeringTypes: [] };
    const p = planMerge(here, { members: [m('b1', '김영수', '1234', { isFamilyHead: true, familyGroupId: 'b1' }), m('b2', '김영희', undefined, { familyGroupId: 'b1' })], offeringTypes: [] });
    expect(p.addMembers.map((x) => [x.id, x.familyGroupId])).toEqual([['b2', 'c0']]);
  });
});

describe('remap', () => {
  const plan = planMerge(
    { members: [m('c1', '김영수', '1234')], offeringTypes: [t('ct1', '십일조')] },
    { members: [m('b1', '김영수', '1234')], offeringTypes: [t('bt1', '십일조')] },
  );

  it('헌금의 성도·종류·세대 스냅샷 id를 현재 id로 바꾼다', () => {
    const list = [{ ...d('1', '2025-01-05', 'b1', 'bt1'), familyGroupIdSnapshot: 'b1' }, d('2', '2025-01-05', null, 'bt1')];
    const out = remapDonations(list, plan);
    expect(out[0]).toMatchObject({ memberId: 'c1', offeringTypeId: 'ct1', familyGroupIdSnapshot: 'c1' });
    expect(out[1]).toMatchObject({ memberId: null, offeringTypeId: 'ct1' });
  });

  it('연결된 성도가 다른 세대 번호(세대주를 바꾼 세대)에 있으면 헌금의 세대 스냅샷도 그 번호를 쓴다', () => {
    const here = { members: [m('c0', '김부친', undefined, { familyGroupId: 'c0' }), m('c1', '김영수', '1234', { familyGroupId: 'c0' })], offeringTypes: [] };
    const p = planMerge(here, { members: [m('b1', '김영수', '1234', { familyGroupId: 'b1' })], offeringTypes: [] });
    const out = remapDonations([{ ...d('1', '2025-01-05', 'b1', 'x'), familyGroupIdSnapshot: 'b1' }], p);
    expect(out[0]).toMatchObject({ memberId: 'c1', familyGroupIdSnapshot: 'c0' });
  });

  it('수정/삭제 이력의 이전·이후 스냅샷도 바꾼다', () => {
    const a: AuditLog = { id: 'a', targetId: '1', action: 'UPDATE', beforeSnapshot: d('1', '2025-01-05', 'b1', 'bt1'), afterSnapshot: null, reason: 'r', timestamp: '' };
    expect(remapAudits([a], plan)[0].beforeSnapshot).toMatchObject({ memberId: 'c1', offeringTypeId: 'ct1' });
  });

  it('대응이 없으면 같은 배열을 그대로 돌려준다', () => {
    const empty = planMerge({ members: [], offeringTypes: [] }, { members: [], offeringTypes: [] });
    const list = [d('1', '2025-01-05', 'x', 'y')];
    expect(remapDonations(list, empty)).toBe(list);
  });
});

describe('예전 형식 연도별 복원 — 다른 PC 백업', () => {
  beforeAll(() => {
    (globalThis as unknown as { window?: unknown }).window ??= globalThis;
  });

  it('같은 성도·종류는 중복 없이 현재 id로 연결하고 동명이인은 새로 추가한다', async () => {
    await transact(async () => ({
      writes: [
        { key: KEYS.members, value: [m('c1', '김영수', '1234')] },
        { key: KEYS.offeringTypes, value: [t('ct1', '십일조')] },
      ],
      result: 0,
    }));
    const backup: BackupPayload = {
      members: [m('b1', '김영수', '1234'), m('b2', '김영수', '7777')],
      offeringTypes: [t('bt1', '십일조'), t('bt2', '선교')],
      donationsByYear: { '2025': [d('d1', '2025-03-02', 'b1', 'bt1'), d('d2', '2025-03-02', 'b2', 'bt2')] },
      auditLogsByYear: {},
    };
    const pre = await planFor(backup);
    expect(pre.memberIdMap.get('b1')).toBe('c1');
    expect(pre.sameNameAdded).toBe(1);
    await restorePayload(backup, ['2025']);
    const after = await payloadNow();
    expect(after.members.map((x) => x.id)).toEqual(['c1', 'b2']);
    expect(after.offeringTypes.map((x) => x.id)).toEqual(['ct1', 'bt2']);
    const byId = Object.fromEntries(after.donationsByYear['2025'].map((x) => [x.id, x]));
    expect(byId.d1).toMatchObject({ memberId: 'c1', offeringTypeId: 'ct1' });
    expect(byId.d2).toMatchObject({ memberId: 'b2', offeringTypeId: 'bt2' });
    expect(await getItem(KEYS.members)).toHaveLength(2);
  });
});

describe('restoredLists (복원 시 덮어쓰기 선택)', () => {
  const cur = { members: [m('c1', '김영수', '1234', { position: '집사' }), m('c2', '이철수')], offeringTypes: [t('ct1', '십일조')] };
  const backup = { members: [m('b1', '김영수', '1234', { position: '권사', familyGroupId: 'b1' }), m('b3', '박민수')], offeringTypes: [{ ...t('ct1', '십일조'), isActive: false }] };
  const plan = planMerge(cur, backup);

  it('고르지 않으면 현재 항목은 그대로 두고 백업에만 있는 항목만 추가한다', () => {
    const r = restoredLists(cur, backup, plan);
    expect(r.members.map((x) => [x.id, x.position])).toEqual([['c1', '집사'], ['c2', ''], ['b3', '']]);
    expect(r.offeringTypes[0].isActive).toBe(true);
    expect(r.updatedMembers + r.updatedTypes).toBe(0);
  });

  it('덮어쓰기를 고르면 같은 항목을 백업 내용으로 바꾸되 현재 id를 유지하고, 백업에 없는 항목은 남긴다', () => {
    const r = restoredLists(cur, backup, plan, { members: true, types: true });
    expect(r.members.map((x) => [x.id, x.position, x.familyGroupId])).toEqual([['c1', '권사', 'c1'], ['c2', '', undefined], ['b3', '', undefined]]);
    expect(r.offeringTypes).toEqual([{ ...t('ct1', '십일조'), isActive: false }]);
    expect([r.updatedMembers, r.updatedTypes]).toEqual([1, 1]);
  });

  it('덮어쓴 성도의 세대는 이 PC에서 그 세대가 쓰는 번호로 맞춘다(세대주를 바꾼 경우)', () => {
    // 이 PC: 세대주를 c0 → c1로 바꿔 세대 번호는 예전 세대주 id(c0)로 남음
    const here = { members: [m('c0', '김부친', undefined, { isFamilyHead: false, familyGroupId: 'c0' }), m('c1', '김영수', '1234', { familyGroupId: 'c0' }), m('c2', '김영희', '5678', { isFamilyHead: false, familyGroupId: 'c0' })], offeringTypes: [] };
    const bk = { members: [m('b1', '김영수', '1234', { familyGroupId: 'b1' }), m('b2', '김영희', '5678', { isFamilyHead: false, familyGroupId: 'b1' })], offeringTypes: [] };
    const r = restoredLists(here, bk, planMerge(here, bk), { members: true });
    expect(r.members.map((x) => [x.id, x.familyGroupId])).toEqual([['c0', 'c0'], ['c1', 'c0'], ['c2', 'c0']]);
  });
});
