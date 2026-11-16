import type { Table } from 'dexie';
import type { AppSettings, Donation, Member, OfferingType } from '../../contexts/types';
import { migrateOfferingTypesV22, migrateOfferingTypesV23, migrateOfferingTypesV24, migrateSettingsV22 } from '../domain/migrations';
import { migrateOfferingTypesV21 } from '../domain/offeringDefaults';
import { clearLegacyPosition } from '../domain/positions';
import { donationKey, KEYS, LEGACY_DONATION_KEY_RE, monthOfDate } from './keys';

type Kv = Table<unknown, string>;

/**
 * 순수 계산(보정 규칙)이 예상 못 한 모양의 데이터 때문에 오류를 내도 업그레이드 전체가 실패해
 * 데이터베이스를 못 여는 일이 없도록, 그 보정만 건너뜁니다(데이터는 건드리지 않고 남습니다).
 */
function safely<T>(label: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    console.error(`[업그레이드] ${label} 보정을 건너뜁니다`, e);
    return null;
  }
}

/**
 * 이전 버전에서 오는 데이터를 현재 형식으로 맞추는 1회 보정을 모두 모았습니다.
 * 데이터베이스가 업그레이드될 때(db.ts의 version(2).upgrade) 화면이 뜨기 전에 하나의 트랜잭션 안에서 실행되며,
 * 각 보정은 '완료 표시' 키(meta_migration_*)가 없을 때만 실행하고 끝나면 표시를 남깁니다.
 * 새로 만든 데이터베이스는 이미 최신 형식이라 실행되지 않습니다.
 * Dexie 업그레이드 트랜잭션 안에서는 이 파일의 저장소 읽기·쓰기만 기다려야 합니다.
 */
export async function applyPendingMigrations(kv: Kv): Promise<void> {
  const isDone = async (flag: string): Promise<boolean> => (await kv.get(flag)) === true;

  // 헌금 종류: v2.1(기본 나열 이동) → v2.2·v2.3(금액 단추 추가) → v2.14(구제·특별헌금 추가)
  const stored = (await kv.get(KEYS.offeringTypes)) as OfferingType[] | undefined;
  if (stored) {
    let list = stored;
    let changed = false;
    const steps: [string, (t: readonly OfferingType[]) => OfferingType[] | null][] = [
      [KEYS.migrationOfferingV21, migrateOfferingTypesV21],
      [KEYS.migrationOfferingV22, migrateOfferingTypesV22],
      [KEYS.migrationOfferingV23, migrateOfferingTypesV23],
      [KEYS.migrationOfferingV24, migrateOfferingTypesV24],
    ];
    for (const [flag, migrate] of steps) {
      if (await isDone(flag)) continue;
      const next = safely('헌금 종류', () => migrate(list));
      if (next) {
        list = next;
        changed = true;
      }
      await kv.put(true, flag);
    }
    if (changed) await kv.put(list, KEYS.offeringTypes);
  }

  // 설정: 큰 금액 확인 기준 이전 기본값(1억 원) → 새 기본값(1천만 원)
  if (!(await isDone(KEYS.migrationSettingsV22))) {
    const storedSettings = ((await kv.get(KEYS.settings)) as Partial<AppSettings> | undefined) ?? null;
    const migrated = safely('설정', () => migrateSettingsV22(storedSettings));
    if (migrated) await kv.put(migrated, KEYS.settings);
    await kv.put(true, KEYS.migrationSettingsV22);
  }

  // 성도: 이전 기본값 직분 '성도'를 직분 없음으로
  if (!(await isDone(KEYS.migrationPositionV25))) {
    const members = ((await kv.get(KEYS.members)) as Member[] | undefined) ?? [];
    const cleaned = safely('직분', () => clearLegacyPosition(members));
    if (cleaned) await kv.put(cleaned, KEYS.members);
    await kv.put(true, KEYS.migrationPositionV25);
  }

  // 헌금 내역: 연도별 키(donations_YYYY)를 월별 키(donations_YYYY-MM)로
  if (!(await isDone(KEYS.migrationDonationsMonthly))) {
    for (const k of (await kv.toCollection().primaryKeys()).map(String).filter((x) => LEGACY_DONATION_KEY_RE.test(x))) {
      const yearList = ((await kv.get(k)) as Donation[] | undefined) ?? [];
      const grouped = safely('헌금 월별 이전', () => {
        const byMonth = new Map<string, Donation[]>();
        for (const d of yearList) {
          const ym = monthOfDate(d.date);
          if (!byMonth.has(ym)) byMonth.set(ym, []);
          byMonth.get(ym)!.push(d);
        }
        return byMonth;
      });
      if (!grouped) continue; // 이상한 데이터는 옮기지 않고 그대로 둡니다(지우지 않음)
      const yms = [...grouped.keys()];
      const existing = (await kv.bulkGet(yms.map(donationKey))) as (Donation[] | undefined)[];
      if (yms.length > 0) await kv.bulkPut(yms.map((ym, i) => [...(existing[i] ?? []), ...grouped.get(ym)!]), yms.map(donationKey));
      await kv.delete(k);
    }
    await kv.put(true, KEYS.migrationDonationsMonthly);
  }
}
