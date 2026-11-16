import { describe, expect, it } from 'vitest';
import type { AuditLog, Donation } from '../../contexts/types';
import { auditLogsForPeriod, isInReportPeriod, type ReportPeriod } from './auditFilter';

const don = (date: string): Donation => ({ id: date, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: '' }) as Donation;
const log = (id: string, ts: string, before: string | null, after: string | null): AuditLog =>
  ({ id, targetId: id, action: after ? 'UPDATE' : 'DELETE', beforeSnapshot: before ? don(before) : null, afterSnapshot: after ? don(after) : null, reason: 'r', timestamp: ts }) as AuditLog;

const week: ReportPeriod = { isWeek: true, week: { start: '2026-11-15', end: '2026-11-21' }, year: '2026', months: [] };
const november: ReportPeriod = { isWeek: false, week: week.week, year: '2026', months: [11] };

describe('isInReportPeriod', () => {
  it('week includes both ends and excludes outside', () => {
    expect(isInReportPeriod('2026-11-15', week)).toBe(true);
    expect(isInReportPeriod('2026-11-21', week)).toBe(true);
    expect(isInReportPeriod('2026-11-22', week)).toBe(false);
    expect(isInReportPeriod(undefined, week)).toBe(false);
  });
  it('month/year periods check year and month together', () => {
    expect(isInReportPeriod('2026-11-03', november)).toBe(true);
    expect(isInReportPeriod('2025-11-03', november)).toBe(false);
    expect(isInReportPeriod('2026-12-03', november)).toBe(false);
  });
});

describe('auditLogsForPeriod', () => {
  const logs = [
    log('a', '2026-11-16T01:00:00Z', '2026-11-15', '2026-11-15'), // 이번 주
    log('b', '2026-11-16T02:00:00Z', '2026-10-04', null), // 10월 삭제
    log('c', '2026-11-16T03:00:00Z', '2026-11-08', '2026-11-15'), // 지난 주 → 이번 주로 이동
  ];
  it('keeps only logs touching the period, newest first', () => {
    expect(auditLogsForPeriod(logs, week).map((l) => l.id)).toEqual(['c', 'a']);
    expect(auditLogsForPeriod(logs, november).map((l) => l.id)).toEqual(['c', 'a']);
    expect(auditLogsForPeriod(logs, { ...november, months: [10] }).map((l) => l.id)).toEqual(['b']);
  });
  it('returns nothing when no log matches', () => {
    expect(auditLogsForPeriod(logs, { ...november, year: '2024' })).toEqual([]);
  });
});

describe('formatPrintStamp', () => {
  it('shows date, Korean weekday and HH:mm', async () => {
    const { formatPrintStamp } = await import('./dates');
    expect(formatPrintStamp(new Date(2026, 10, 16, 8, 5))).toBe('2026-11-16 (월) 08:05');
    expect(formatPrintStamp(new Date(2026, 10, 15, 23, 59))).toBe('2026-11-15 (일) 23:59');
  });
});

describe('theme defaults (v2.9)', () => {
  it('defaults to calm blue on screen and black-and-white in print, with 3 + 4 options', async () => {
    const { DEFAULT_SETTINGS } = await import('../../contexts/types');
    const { THEME_OPTIONS, PRINT_THEME_OPTIONS } = await import('../theme');
    expect(DEFAULT_SETTINGS.theme).toBe('BLUE');
    expect(DEFAULT_SETTINGS.printTheme).toBe('MONO');
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['BLUE', 'WARM', 'CALM']);
    expect(PRINT_THEME_OPTIONS.map((o) => o.value)).toEqual(['MONO', 'BLUE', 'WARM', 'CALM']);
  });
});
