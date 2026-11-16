/** 저장소 키 이름과 키 규칙. 데이터베이스 정의(db.ts)와 저장소 서비스가 함께 쓰므로 별도 파일로 둡니다. */

export const KEYS = {
  members: 'members',
  offeringTypes: 'offering_types',
  settings: 'settings',
  dirty: 'meta_dirty_since_backup',
} as const;

/** 헌금 내역 키: ym = 'YYYY-MM' */
export const donationKey = (ym: string): string => `donations_${ym}`;
export const auditKey = (year: string): string => `audit_logs_${year}`;
/** 월별 헌금 키. 첫 그룹 = 'YYYY-MM' */
export const DONATION_KEY_RE = /^donations_(\d{4}-\d{2})$/;
export const AUDIT_KEY_RE = /^audit_logs_(\d{4})$/;
export const monthOfDate = (date: string): string => date.slice(0, 7);
export const monthsOfYear = (year: string): string[] => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
