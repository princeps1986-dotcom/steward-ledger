import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Donation, Member, OfferingType } from '../contexts/types';
import { selectFilesToPrune } from './backup/autoBackupService';
import { computeChecksum, parseAndValidateBackup } from './backup/validation';
import { sanitizeFileName } from './excel/downloadBridge';
import { buildReportWorkbook, displayWidth, sanitizeCellText } from './excel/excelService';
import { applyImport, buildPreview, decodeCsvBytes, normalizeDate, normalizeRows } from './import/memberImportService';

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

describe('excel helpers', () => {
  it('blocks formula injection', () => {
    expect(sanitizeCellText('=1+1')).toBe("'=1+1");
    expect(sanitizeCellText('@cmd')).toBe("'@cmd");
    expect(sanitizeCellText('-10')).toBe("'-10");
    expect(sanitizeCellText('김철수')).toBe('김철수');
  });
  it('weights Hangul as width 2', () => {
    expect(displayWidth('ab')).toBe(2);
    expect(displayWidth('가나')).toBe(4);
  });
  it('sanitizes file names', () => {
    expect(sanitizeFileName('a/b:c*?.xlsx')).toBe('a_b_c__.xlsx');
  });

  it('builds 2 summary sheets (no per-donation detail) with SUM formulas and cached results', async () => {
    const types: OfferingType[] = [{ id: 't1', name: '십일조', displayArea: 'PRIMARY', quickAmounts: [], sortOrder: 1, isActive: true }];
    const head = member({ id: 'h', isFamilyHead: true, familyGroupId: 'h' });
    const donations: Donation[] = [
      { id: 'd1', date: '2026-01-04', memberId: 'h', donorDisplayName: '김철수', familyGroupIdSnapshot: 'h', offeringTypeId: 't1', amount: 100000, createdAt: '1' },
      { id: 'd2', date: '2026-02-01', memberId: null, donorDisplayName: '=HYPERLINK("x")', familyGroupIdSnapshot: null, offeringTypeId: 't1', amount: 5000, createdAt: '2' },
    ];
    const blob = await buildReportWorkbook({ year: '2026', periodType: 'YEAR', periodValue: 1, donations, members: [head], offeringTypes: types, basis: 'CURRENT' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['종합결산요약', '세대별_기부금집계']); // 개별 내역 시트 없음
    const summary = wb.getWorksheet('종합결산요약')!;
    expect(summary.getRow(5).getCell(2).value).toBe(100000); // 1월 십일조(값)
    expect(summary.getRow(5).getCell(3).value).toBe(5000); // 2월(무명 포함)
    const rowTotal = summary.getRow(5).getCell(14).value as { formula: string; result: number };
    expect(rowTotal.formula).toContain('SUM');
    expect(rowTotal.result).toBe(105000);
    const family = wb.getWorksheet('세대별_기부금집계')!;
    expect(family.rowCount).toBe(4); // 제목, 빈 줄, 헤더, 김철수 세대 (무명 제외)
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

  it('normalizes dates', () => {
    expect(normalizeDate('1975.3.2')).toBe('1975-03-02');
    expect(normalizeDate('19750302')).toBe('1975-03-02');
  });

  it('previews errors, duplicates and head links, then applies heads first', () => {
    const existing = [member({ id: 'e1', name: '박민수', birthDate: '1980-01-01', isFamilyHead: true, familyGroupId: 'e1' })];
    const rows = normalizeRows([
      { 이름: '이영희', 세대주여부: 'N', 세대주이름: '김철수' },
      { 이름: '김철수', 생년월일: '1975-03-02', 세대주여부: 'Y' },
      { 이름: '', 직분: '집사' },
      { 이름: '박민수', 생년월일: '1980-01-01', 직분: '집사' },
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
