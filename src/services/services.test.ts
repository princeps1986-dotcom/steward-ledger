import { describe, expect, it } from 'vitest';
import type { Member } from '../contexts/types';
import { selectFilesToPrune } from './backup/autoBackupService';
import { computeChecksum, parseAndValidateBackup } from './backup/validation';
import { sanitizeFileName } from './excel/downloadBridge';
import { stripBirthDate } from './domain/memberRules';
import { applyImport, buildPreview, decodeCsvBytes, normalizeRows } from './import/memberImportService';

const member = (p: Partial<Member>): Member => ({
  id: 'm1',
  name: '김철수',
  position: '집사',
  isFamilyHead: false,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  ...p,
});

describe('download helpers', () => {
  it('sanitizes file names', () => {
    expect(sanitizeFileName('a/b:c*?.xlsx')).toBe('a_b_c__.xlsx');
  });
});

describe('backup validation', () => {
  it('round-trips a v2 envelope and rejects tampering', async () => {
    const payload = { members: [member({})], offeringTypes: [], donationsByYear: {}, auditLogsByYear: {} };
    const env = { appVersion: '2.0.0', schemaVersion: 2, exportedAt: '2026-01-01T00:00:00Z', checksum: await computeChecksum(payload), payload };
    const ok = await parseAndValidateBackup(JSON.stringify(env));
    expect(ok.ok).toBe(true);
    const tampered = JSON.stringify({ ...env, payload: { ...payload, members: [member({ name: '변조' })] } });
    const bad = await parseAndValidateBackup(tampered);
    expect(bad.ok).toBe(false);
  });

  it('migrates v1 into year shards with snapshots', async () => {
    const payload = {
      members: [member({ id: 'm1', familyGroupId: 'g1' })],
      offeringTypes: [{ id: 't1', name: '십일조', displayArea: 'PRIMARY', quickAmounts: [], sortOrder: 1, isActive: true }],
      donations: [
        { id: 'd1', date: '2025-12-28', memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't1', amount: 1000, createdAt: '' },
        { id: 'd2', date: '2026-01-04', memberId: 'm1', donorDisplayName: '김철수', offeringTypeId: 't1', amount: 2000, createdAt: '' },
      ],
    };
    const res = await parseAndValidateBackup(JSON.stringify({ schemaVersion: 1, payload }));
    if (!res.ok) throw new Error(res.error);
    expect(res.migratedFrom).toBe(1);
    expect(Object.keys(res.envelope.payload.donationsByYear).sort()).toEqual(['2025', '2026']);
    expect(res.envelope.payload.donationsByYear['2026'][0].familyGroupIdSnapshot).toBe('g1');
  });
});

describe('auto backup retention', () => {
  it('keeps the newest 10 and ignores other files', () => {
    const names = Array.from({ length: 12 }, (_, i) => `backup_202601${String(i + 1).padStart(2, '0')}_120000.json`);
    expect(selectFilesToPrune([...names, 'emergency_before_restore_20260101_000000.json'])).toEqual(names.slice(0, 2));
  });
});

describe('member import', () => {
  it('decodes CP949 and UTF-8 BOM', () => {
    const utf8 = new TextEncoder().encode('﻿이름\r\n김철수');
    expect(decodeCsvBytes(utf8)).toBe('이름\r\n김철수');
    // "이름" in CP949
    const cp949 = new Uint8Array([0xc0, 0xcc, 0xb8, 0xa7]);
    expect(decodeCsvBytes(cp949)).toBe('이름');
  });

  it('previews errors, duplicates and head links, then applies heads first', () => {
    const existing = [member({ id: 'e1', name: '박민수', phoneLast4: '1234', isFamilyHead: true, familyGroupId: 'e1' })];
    const rows = normalizeRows([
      { 이름: '이영희', 세대주여부: 'N', 세대주이름: '김철수' },
      { 이름: '김철수', 세대주여부: 'Y' },
      { 이름: '', 직분: '집사' },
      { 이름: '박민수', 연락처뒷4자리: '1234', 직분: '집사' },
      { 이름: '최수진', 세대주이름: '박민수' },
      { 이름: '정하나', 세대주이름: '없는사람' },
    ]);
    const preview = buildPreview(rows, existing);
    const status = Object.fromEntries(preview.map((r) => [r.name || '(빈칸)', r.status]));
    expect(status).toEqual({ 이영희: 'OK', 김철수: 'OK', '(빈칸)': 'ERROR', 박민수: 'DUPLICATE', 최수진: 'OK', 정하나: 'ERROR' });

    const { members, stats } = applyImport(preview, new Set([5]), existing);
    expect(stats).toEqual({ created: 3, skipped: 0, overwritten: 1, errors: 2 });
    const kim = members.find((m) => m.name === '김철수')!;
    expect(members.find((m) => m.name === '이영희')!.familyGroupId).toBe(kim.id);
    expect(members.find((m) => m.name === '최수진')!.familyGroupId).toBe('e1');
    expect(members.find((m) => m.id === 'e1')!.position).toBe('집사');
  });
});

describe('birth date removal', () => {
  it('strips stored birth dates and reports whether anything changed', () => {
    const old = [{ ...member({ id: 'a' }), birthDate: '1975-03-02' }] as unknown as Member[];
    const r = stripBirthDate(old);
    expect(r.changed).toBe(true);
    expect('birthDate' in r.members[0]).toBe(false);
    const clean = [member({ id: 'b' })];
    const r2 = stripBirthDate(clean);
    expect(r2.changed).toBe(false);
    expect(r2.members).toBe(clean);
  });

  it('ignores birth dates in an old backup file on restore', async () => {
    const payload = { members: [{ ...member({ id: 'm1' }), birthDate: '1975-03-02' }], offeringTypes: [], donations: [] };
    const res = await parseAndValidateBackup(JSON.stringify({ schemaVersion: 1, payload }));
    if (!res.ok) throw new Error(res.error);
    expect('birthDate' in res.envelope.payload.members[0]).toBe(false);
  });
});
