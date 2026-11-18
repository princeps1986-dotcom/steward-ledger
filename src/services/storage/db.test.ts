import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import type { AuditLog, Donation } from '../../contexts/types';
import { db } from './db';
import { auditAppend, getItem, listAuditKeys, transact } from './storageService';

const don = (id: string, date: string): Donation =>
  ({ id, date, memberId: null, donorDisplayName: '무명1', familyGroupIdSnapshot: null, offeringTypeId: 't', amount: 1000, createdAt: 'c' }) as Donation;
const log = (id: string, date: string): AuditLog => ({ id, targetId: 'd', action: 'DELETE', beforeSnapshot: don('d', date), afterSnapshot: null, reason: '시험 삭제 사유', timestamp: `2025-01-0${id}T00:00:00Z` });

describe('이력 테이블(v2)', () => {
  it('v1의 연도별 이력 배열을 순서대로 행으로 옮기고 kv에서는 지운다', async () => {
    db.close();
    await Dexie.delete('church-offering-ledger');
    const v1 = new Dexie('church-offering-ledger');
    v1.version(1).stores({ kv: '', donations: '[date+id], memberId, offeringTypeId, [date+memberId+offeringTypeId]' });
    await v1.table('kv').put([log('2', '2025-03-02'), log('1', '2025-03-01')], 'audit_logs_2025');
    await v1.table('kv').put([log('3', '2026-01-04')], 'audit_logs_2026');
    await v1.table('kv').put(['m'], 'members');
    v1.close();

    await db.open();
    expect(await listAuditKeys()).toEqual(['audit_logs_2025', 'audit_logs_2026']);
    expect((await getItem<AuditLog[]>('audit_logs_2025'))!.map((l) => l.id)).toEqual(['2', '1']); // 기록 순서 유지
    expect(await getItem<AuditLog[]>('audit_logs_2025')).toEqual([log('2', '2025-03-02'), log('1', '2025-03-01')]); // year·seq는 밖으로 나오지 않음
    expect(await db.kv.get('audit_logs_2025')).toBeUndefined();
    expect(await db.kv.get('members')).toEqual(['m']);
  });

  it('덧붙이기는 그 해 이력을 다시 쓰지 않고 행만 더하며, 전체 교체는 그 해만 바꾼다', async () => {
    await db.audits.clear();
    await transact(async () => ({ writes: [{ key: 'audit_logs_2025', value: [log('1', '2025-03-01')] }, { key: 'audit_logs_2026', value: [log('3', '2026-01-04')] }], result: 0 }));
    const firstSeq = (await db.audits.where('year').equals('2025').first())!.seq;
    await transact(async () => ({ writes: [auditAppend('2025', [log('2', '2025-03-02')])], result: 0 }));
    expect((await db.audits.where('year').equals('2025').first())!.seq).toBe(firstSeq); // 기존 행은 그대로
    expect((await getItem<AuditLog[]>('audit_logs_2025'))!.map((l) => l.id)).toEqual(['1', '2']);

    await transact(async () => ({ writes: [{ key: 'audit_logs_2025', value: null }], result: 0 }));
    expect(await getItem('audit_logs_2025')).toBeNull();
    expect(await listAuditKeys()).toEqual(['audit_logs_2026']);
  });
});
