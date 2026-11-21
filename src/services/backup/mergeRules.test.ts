import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuditLog, BackupPayload, Donation, Member, OfferingType } from '../../contexts/types';
import { KEYS, getItem, transact } from '../storage/storageService';
import { previewMerge, restoreBackup } from './backupService';
import { payloadNow } from './testPayload';
import { planMerge, remapAudits, remapDonations } from './mergeRules';

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

describe('restoreBackup(YEARS) — 다른 PC 백업', () => {
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
    const pre = await previewMerge(backup);
    expect(pre.memberIdMap.get('b1')).toBe('c1');
    expect(pre.sameNameAdded).toBe(1);
    await restoreBackup(backup, { years: ['2025'], mode: 'YEARS' });
    const after = await payloadNow();
    expect(after.members.map((x) => x.id)).toEqual(['c1', 'b2']);
    expect(after.offeringTypes.map((x) => x.id)).toEqual(['ct1', 'bt2']);
    const byId = Object.fromEntries(after.donationsByYear['2025'].map((x) => [x.id, x]));
    expect(byId.d1).toMatchObject({ memberId: 'c1', offeringTypeId: 'ct1' });
    expect(byId.d2).toMatchObject({ memberId: 'b2', offeringTypeId: 'bt2' });
    expect(await getItem(KEYS.members)).toHaveLength(2);
  });
});
