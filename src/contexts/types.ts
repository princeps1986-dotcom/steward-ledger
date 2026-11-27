// 핵심 데이터 모델 (ARCHITECTURE.md §5)

/** 성도 마스터 데이터 */
export interface Member {
  id: string;
  name: string;
  position: string;
  phoneLast4?: string;
  /** 합산 묶음 ID = 최초 대표자의 Member.id. 대표자가 바뀌어도 유지되고 isFamilyHead만 이전됩니다. */
  familyGroupId?: string;
  isFamilyHead: boolean;
  isActive: boolean;
  /** 등록일 YYYY-MM-DD. 이 필드가 생기기 전 성도는 없을 수 있습니다(registeredDateOf로 표시). */
  registeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 헌금 종류 설정 */
export interface OfferingType {
  id: string;
  name: string;
  displayArea: 'PRIMARY' | 'DROPDOWN';
  quickAmounts: number[];
  sortOrder: number;
  isActive: boolean;
}

/** 헌금 내역 (월별 샤딩: donations_{YYYY-MM}, v1.2) */
export interface Donation {
  id: string;
  date: string; // YYYY-MM-DD
  memberId: string | null;
  donorDisplayName: string;
  familyGroupIdSnapshot?: string | null;
  offeringTypeId: string;
  amount: number;
  memo?: string;
  createdAt: string;
}

/** 수정/삭제 감사 로그 (연도별 샤딩: audit_logs_{YYYY}) */
export interface AuditLog {
  id: string;
  targetId: string;
  action: 'UPDATE' | 'DELETE';
  beforeSnapshot: Donation;
  afterSnapshot: Donation | null;
  /** 필수. 사용자 입력 또는 시스템 자동 기입(합산·복구하기) */
  reason: string;
  timestamp: string;
  /** 고친 사람(구글 로그인 이메일). 로그인이 없는 브라우저 모드와 이전 이력에는 없습니다. */
  actor?: string;
}

/** 버전 호환 JSON 백업 컨테이너 */
export interface BackupEnvelope {
  appVersion: string;
  schemaVersion: number;
  exportedAt: string;
  checksum: string;
  payload: BackupPayload;
}

export interface BackupPayload {
  members: Member[];
  offeringTypes: OfferingType[];
  donationsByYear: Record<string, Donation[]>;
  auditLogsByYear: Record<string, AuditLog[]>;
}

/** 환경 설정 */
export interface AppSettings {
  recipientEmail: string;
  /** 이 금액을 초과하면 저장 전 확인창 */
  largeAmountThreshold: number;
  autoBackupEnabled: boolean;
  lastBackupAt: string | null;
  /** 마지막으로 정상 성공한 종료 자동 백업 시각(다음 실행 때 반영) */
  lastCloseBackupAt: string | null;
  /** 연도별 마지막 수동 백업([백업 파일 저장]) 시각. 키는 연도('2026') */
  manualBackupAt: Record<string, string>;
  /** 화면 글자 크기 (작게/보통/크게/매우 크게) */
  fontScale: FontScale;
  theme: AppTheme;
  printTheme: PrintTheme;
  /** 변경 내역 창을 마지막으로 확인한 데스크톱 앱 버전(업데이트 후 첫 실행에 한 번 보여 주기용) */
  seenVersion?: string;
  /** 잠긴(마감한) 연도. 잠긴 연도의 헌금은 입력·수정·삭제할 수 없습니다(걸기: 관리자·재정담당, 풀기: 관리자) */
  lockedYears: string[];
}

export type FontScale = 'SMALL' | 'NORMAL' | 'LARGE' | 'XLARGE';
/** 화면 테마: 차분한 블루(기본) / 밝고 따뜻한 / 눈이 편안한 / 어두운 */
export type AppTheme = 'BLUE' | 'WARM' | 'CALM' | 'DARK';
/** 인쇄 양식 색상: 흑백(기본) + 밝은 화면 테마 3종(어두운 테마는 인쇄에 쓰지 않음) */
export type PrintTheme = 'MONO' | 'BLUE' | 'WARM' | 'CALM';

export const DEFAULT_SETTINGS: AppSettings = {
  recipientEmail: '',
  largeAmountThreshold: 10_000_000,
  autoBackupEnabled: true,
  lastBackupAt: null,
  lastCloseBackupAt: null,
  manualBackupAt: {},
  fontScale: 'NORMAL',
  theme: 'BLUE',
  printTheme: 'MONO',
  lockedYears: [],
};

/** 헌금 저장 입력 (한 봉투의 한 종류) */
export interface DonationDraft {
  date: string;
  memberId: string | null;
  donorDisplayName: string;
  familyGroupIdSnapshot: string | null;
  offeringTypeId: string;
  amount: number;
  memo?: string;
}

/** 한 번의 저장 묶음 (입력 이력 패널·복구하기 단위, 메모리 전용) */
export interface SaveBatch {
  batchId: string;
  savedAt: string;
  date: string;
  donorDisplayName: string;
  createdIds: string[];
  /** 저장 직후의 새 내역(createdIds와 같은 순서). 복구하기 전에 그 뒤로 수정됐는지 확인하는 데 씁니다. */
  createdAfter: Donation[];
  mergedBefore: Donation[];
  /** 합산 직후의 내역(mergedBefore와 같은 id). 복구하기 전에 그 뒤로 수정됐는지 확인하는 데 씁니다. */
  mergedAfter: Donation[];
  lines: { offeringTypeId: string; amount: number; merged: boolean }[];
}

export type DuplicateResolution = 'MERGE' | 'SEPARATE';

export const APP_VERSION = '1.1.0';
export const SCHEMA_VERSION = 2;
