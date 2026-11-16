import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { collectPayload, replaceAllData, restoreBackup, yearsInPayload } from '../backup/backupService';
import {
  listDonationMonths,
  monthWrite,
  readMonth,
  rowWrite,
  transact,
} from './storageService';

const d = (id: string, date: string): Donation =>
  ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: '', updatedAt: '' }) as unknown as Donation;

describe('monthly donation storage', () => {
  it('writes only the touched month and the month disappears when its last row is deleted', async () => {
    const { writes } = await transact(async () => ({ writes: [rowWrite('2026-03', { puts: [d('n', '2026-03-01')], deletes: [] })], result: 0 }));
    expect(writes.map((w) => w.key)).toEqual(['donations_2026-03']);
    expect((await readMonth('2026-03')).map((x) => x.id)).toEqual(['n']);
    await transact(async () => ({ writes: [rowWrite('2026-03', { puts: [], deletes: [['2026-03-01', 'n']] })], result: 0 }));
    expect(await listDonationMonths()).not.toContain('2026-03');
  });

  it('backup round-trips through the donation rows (collect → replace → collect)', async () => {
    await transact(async () => ({ writes: [monthWrite('2025-12', [d('a', '2025-12-28')]), monthWrite('2026-02', [d('e', '2026-02-01')])], result: 0 }));
    const before = await collectPayload();
    expect(Object.keys(before.donationsByYear).sort()).toEqual(['2025', '2026']);
    await replaceAllData({ ...before, donationsByYear: { '2024': [d('x', '2024-06-02'), d('y', '2024-07-07')] } });
    expect(await listDonationMonths()).toEqual(['2024-06', '2024-07']);
    const after = await collectPayload();
    expect(Object.fromEntries(Object.entries(after.donationsByYear).map(([y, l]) => [y, l.map((x) => x.id)]))).toEqual({ '2024': ['x', 'y'] });
  });
});

describe('year-selectable backup and restore', () => {
  const m = (id: string, name: string) => ({ id, name, position: '', isFamilyHead: false, isActive: true, createdAt: '', updatedAt: '' });
  const t = (id: string) => ({ id, name: id, displayArea: 'PRIMARY' as const, quickAmounts: [], sortOrder: 1, isActive: true });
  const ids = (l: Donation[] | undefined) => (l ?? []).map((x) => x.id).sort();

  it('collectPayload(years) keeps only the chosen years but always all members and types', async () => {
    await replaceAllData({
      members: [m('a', '가'), m('b', '나')],
      offeringTypes: [t('t')],
      donationsByYear: { '2024': [d('a1', '2024-03-03')], '2025': [d('b1', '2025-05-04'), d('b2', '2025-12-28')] },
      auditLogsByYear: { '2024': [], '2025': [] },
    });
    const only = await collectPayload(['2025']);
    expect(Object.keys(only.donationsByYear)).toEqual(['2025']);
    expect(ids(only.donationsByYear['2025'])).toEqual(['b1', 'b2']);
    expect(only.members).toHaveLength(2);
    expect(yearsInPayload(await collectPayload())).toEqual(['2024', '2025']);
  });

  it('YEARS mode replaces only the chosen year, keeps other years, and only adds missing members/types', async () => {
    await replaceAllData({
      members: [m('a', '가'), m('b', '나')],
      offeringTypes: [t('t')],
      donationsByYear: { '2024': [d('keep24', '2024-03-03')], '2025': [d('old25', '2025-05-04')] },
      auditLogsByYear: {},
    });
    const backup = {
      members: [m('a', '이름이바뀐가'), m('c', '다')], // a는 현재 값 유지, c만 추가
      offeringTypes: [t('t'), t('t2')],
      donationsByYear: { '2025': [d('new25a', '2025-01-05'), d('new25b', '2025-02-02')], '2026': [d('skip26', '2026-01-04')] },
      auditLogsByYear: {},
    };
    await restoreBackup(backup, { years: ['2025'], mode: 'YEARS' });
    const after = await collectPayload();
    expect(ids(after.donationsByYear['2024'])).toEqual(['keep24']); // 다른 연도 유지
    expect(ids(after.donationsByYear['2025'])).toEqual(['new25a', 'new25b']); // 선택 연도 교체
    expect(after.donationsByYear['2026']).toBeUndefined(); // 선택하지 않은 연도는 가져오지 않음
    expect(after.members.map((x) => [x.id, x.name]).sort()).toEqual([['a', '가'], ['b', '나'], ['c', '다']]);
    expect(after.offeringTypes.map((x) => x.id).sort()).toEqual(['t', 't2']);
  });

  it('FULL mode wipes everything and restores only the chosen years', async () => {
    const backup = {
      members: [m('z', '자')],
      offeringTypes: [t('t')],
      donationsByYear: { '2023': [d('x23', '2023-06-04')], '2025': [d('x25', '2025-06-01')] },
      auditLogsByYear: {},
    };
    await restoreBackup(backup, { years: ['2023'], mode: 'FULL' });
    const after = await collectPayload();
    expect(Object.keys(after.donationsByYear)).toEqual(['2023']);
    expect(after.members.map((x) => x.id)).toEqual(['z']);
  });
});

describe('atomic transactions', () => {
  it('commits all keys of one transaction together or none of them', async () => {
    await expect(
      transact(async () => {
        throw new Error('빌드 도중 실패');
      }),
    ).rejects.toThrow('빌드 도중 실패');
    expect(await readMonth('2031-01')).toEqual([]); // 실패한 트랜잭션은 아무것도 남기지 않음
    // 쓰기 도중 오류(값을 복사할 수 없는 함수)가 나면 같은 트랜잭션의 앞선 쓰기도 취소되어야 합니다.
    await expect(
      transact(async () => ({
        writes: [monthWrite('2031-02', [d('q2', '2031-02-02')]), { key: 'bad', value: () => 1 }],
        result: 0,
      })),
    ).rejects.toBeTruthy();
    expect(await readMonth('2031-02')).toEqual([]);
  });

  it('applies the last write when a key appears twice in one transaction', async () => {
    await transact(async () => ({
      writes: [
        { key: 'donations_2031-03', value: [d('r1', '2031-03-02')] },
        { key: 'donations_2031-03', value: null },
        { key: 'donations_2031-04', value: null },
        { key: 'donations_2031-04', value: [d('r2', '2031-04-06')] },
      ],
      result: 0,
    }));
    expect(await readMonth('2031-03')).toEqual([]);
    expect((await readMonth('2031-04')).map((x) => x.id)).toEqual(['r2']);
  });
});

describe('createBackupJson single-stringify', () => {
  it('produces valid JSON that passes checksum validation', async () => {
    const { createBackupJson } = await import('../backup/backupService');
    const { parseAndValidateBackup } = await import('../backup/validation');
    const text = await createBackupJson();
    expect(Object.keys(JSON.parse(text))).toEqual(['appVersion', 'schemaVersion', 'exportedAt', 'checksum', 'payload']);
    expect((await parseAndValidateBackup(text)).ok).toBe(true);
  });
});

describe('streaming (v3) backup lines', () => {
  it('round-trips through parseAndValidateBackup and detects tampering/truncation', async () => {
    const { backupLines, collectPayload } = await import('../backup/backupService');
    const { parseAndValidateBackup, sha256Hex } = await import('../backup/validation');
    await transact(async () => ({ writes: [monthWrite('2026-04', [d('x1', '2026-04-05')]), monthWrite('2026-05', [d('x2', '2026-05-03')])], result: 0 }));
    let body = '';
    for await (const l of backupLines()) body += l;
    const text = `${body}${JSON.stringify({ t: 'end', sha256: await sha256Hex(body) })}\n`;
    const res = await parseAndValidateBackup(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.envelope.payload).toEqual(await collectPayload());
    expect((await parseAndValidateBackup(text.replace('x1', 'zz'))).ok).toBe(false); // 변조
    expect((await parseAndValidateBackup(body)).ok).toBe(false); // 끝 줄 없음(잘림)
  });
});
