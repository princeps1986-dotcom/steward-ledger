import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseAndValidateBackup } from './validation';

const dir = mkdtempSync(join(tmpdir(), 'ledger-testdata-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function generate(date: string, name: string): string {
  const out = join(dir, name);
  execFileSync(process.execPath, ['scripts/generate-test-data.mjs', '--out', out, '--date', date, '--seed', '7'], { stdio: 'pipe' });
  return readFileSync(out, 'utf8');
}

describe('test data generator (scripts/generate-test-data.mjs)', () => {
  it('creates a backup that passes the app validation with the requested counts', async () => {
    const text = generate('2026-11-16', 'a.json');
    const res = await parseAndValidateBackup(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.envelope.payload;
    expect(res.migratedFrom).toBeNull(); // 현재 스키마(v2) 그대로
    expect(p.members).toHaveLength(150);
    const day = (d: string) => (p.donationsByYear['2026'] ?? []).filter((x) => x.date === d);
    expect(day('2026-11-15')).toHaveLength(300); // 어제
    expect(day('2026-11-16')).toHaveLength(100); // 오늘
  });

  it('is internally consistent and covers the varied cases', async () => {
    const res = await parseAndValidateBackup(generate('2026-11-16', 'b.json'));
    if (!res.ok) throw new Error(res.error);
    const { members, offeringTypes, donationsByYear } = res.envelope.payload;
    const memberIds = new Set(members.map((m) => m.id));
    const typeIds = new Set(offeringTypes.map((t) => t.id));
    const donations = Object.values(donationsByYear).flat();

    expect(new Set(members.map((m) => m.id)).size).toBe(150);
    expect(new Set(donations.map((d) => d.id)).size).toBe(donations.length);
    expect(donations.every((d) => typeIds.has(d.offeringTypeId))).toBe(true);
    expect(donations.filter((d) => d.memberId).every((d) => memberIds.has(d.memberId!))).toBe(true);
    // 익명 내역은 성도 연결이 없고, 성도 내역은 이름이 성도 이름과 같다.
    const byId = new Map(members.map((m) => [m.id, m]));
    expect(donations.filter((d) => d.memberId).every((d) => d.donorDisplayName === byId.get(d.memberId!)!.name)).toBe(true);

    // 다양한 사례
    const nameCount = new Map<string, number>();
    members.forEach((m) => nameCount.set(m.name, (nameCount.get(m.name) ?? 0) + 1));
    expect([...nameCount.values()].filter((c) => c > 1).length).toBeGreaterThanOrEqual(5); // 동명이인
    expect(members.filter((m) => !m.isActive)).toHaveLength(12);
    expect(members.some((m) => m.position === '장로')).toBe(true); // 목록에 없는 직분 값
    expect(members.some((m) => !m.phoneLast4) && members.every((m) => !('birthDate' in m))).toBe(true); // 생년월일은 만들지 않음
    expect(members.some((m) => m.isFamilyHead && m.familyGroupId && m.familyGroupId !== m.id)).toBe(true); // 대표자 변경
    expect(donations.some((d) => d.memberId === null && /^무명\d+$/.test(d.donorDisplayName))).toBe(true);
    expect(donations.some((d) => d.amount > 10_000_000)).toBe(true); // 큰 금액 확인창 대상
    expect(donations.some((d) => d.memo?.startsWith('='))).toBe(true); // 수식 주입 방어 확인용 메모
    expect(offeringTypes.some((t) => !t.isActive)).toBe(true);
    expect(offeringTypes.some((t) => t.displayArea === 'DROPDOWN' && t.isActive)).toBe(true);
    expect(offeringTypes.find((t) => t.name === '구제헌금')).toMatchObject({ displayArea: 'PRIMARY', isActive: true, quickAmounts: [1000, 5000, 10000, 30000, 50000, 100000] });
    expect(offeringTypes.find((t) => t.name === '특별헌금')).toMatchObject({ displayArea: 'DROPDOWN', isActive: true });
  });

  it('splits yesterday and today into two year shards across New Year', async () => {
    const res = await parseAndValidateBackup(generate('2027-01-01', 'c.json'));
    if (!res.ok) throw new Error(res.error);
    const { donationsByYear } = res.envelope.payload;
    expect(donationsByYear['2026']).toHaveLength(300);
    expect(donationsByYear['2027']).toHaveLength(100);
  });

  it('is reproducible for the same seed', () => {
    const a = JSON.parse(generate('2026-11-16', 'd1.json')).payload;
    const b = JSON.parse(generate('2026-11-16', 'd2.json')).payload;
    expect(a.members.map((m: { name: string }) => m.name)).toEqual(b.members.map((m: { name: string }) => m.name));
  });
});
