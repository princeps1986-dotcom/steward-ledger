/** 저장소 키 이름과 키 규칙. 데이터베이스 정의(db.ts)와 저장소 서비스가 함께 쓰므로 별도 파일로 둡니다. */

export const KEYS = {
  members: 'members',
  offeringTypes: 'offering_types',
  settings: 'settings',
  /** v2.1 헌금 종류 기본값 보정을 이미 수행했는지 */
  migrationOfferingV21: 'meta_migration_offering_v21',
  /** v2.2 건축·선교헌금 금액 단추 추가를 이미 수행했는지 */
  migrationOfferingV22: 'meta_migration_offering_v22',
  migrationOfferingV23: 'meta_migration_offering_v23',
  /** v2.14 구제헌금·특별헌금 추가를 이미 수행했는지 */
  migrationOfferingV24: 'meta_migration_offering_v24',
  /** v2.15 직분 '성도'(이전 기본값) 정리를 이미 수행했는지 */
  migrationPositionV25: 'meta_migration_position_v25',
  /** v2.2 큰 금액 확인 기준 기본값(1천만 원) 보정을 이미 수행했는지 */
  migrationSettingsV22: 'meta_migration_settings_v22',
  /** v1.2 헌금 내역 저장 단위를 연도 → 월로 바꾸는 이전을 이미 수행했는지 */
  migrationDonationsMonthly: 'meta_migration_donations_monthly_v1',
  /** 행 단위 헌금 테이블이 월 배열과 같은 내용으로 채워졌음을 확인한 표시(백업 대상 아님) */
  donationRowsReady: 'meta_donation_rows_ready_v1',
  dirty: 'meta_dirty_since_backup',
  /** 이전(localForage) 버전이 커밋 도중 종료되어 남긴 저널. 시작할 때 recoverJournal()이 한 번 마저 적용하고 지웁니다. */
  journal: 'meta_journal',
} as const;

/** 헌금 내역 키: ym = 'YYYY-MM' */
export const donationKey = (ym: string): string => `donations_${ym}`;
export const auditKey = (year: string): string => `audit_logs_${year}`;
/** 월별 헌금 키. 첫 그룹 = 'YYYY-MM' */
export const DONATION_KEY_RE = /^donations_(\d{4}-\d{2})$/;
/** 이전 버전(연도별) 헌금 키 — 데이터베이스를 업그레이드할 때 월별로 이전합니다. */
export const LEGACY_DONATION_KEY_RE = /^donations_(\d{4})$/;
export const AUDIT_KEY_RE = /^audit_logs_(\d{4})$/;
export const monthOfDate = (date: string): string => date.slice(0, 7);
export const monthsOfYear = (year: string): string[] => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
