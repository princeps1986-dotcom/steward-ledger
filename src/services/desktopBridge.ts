// Electron preload(contextBridge)가 노출하는 최소 API. 일반 브라우저(개발용)에서는 undefined입니다.
import type { Role } from './auth/roles';

interface AutoBackupStatus {
  ok: boolean;
  at: string;
  file?: string;
  error?: string;
}

/** 자동 백업이 끝난 뒤 저장된 파일 경로(내용은 backupWrite로 이미 main에 보냄) */
export interface AutoBackupPayload {
  file: string;
}

/** close = 종료 때 · periodic = 앱을 쓰는 동안 · manual = 저장 위치를 고름(name 필요) */
export interface BackupSessionSpec {
  kind: 'close' | 'periodic' | 'manual';
  /** manual의 파일 이름(영문·숫자·_- 와 .slbk) */
  name?: string;
  /** manual: 사용자가 정한 암호(6자 이상). 자동 백업은 이 PC의 키로 잠그므로 필요 없음 */
  password?: string;
}

/** 백업 파일 종류: plain(예전 일반 파일) · pc(이 PC의 자동 백업) · password(암호가 필요한 직접 백업). error면 열 수 없음 */
interface BackupFileInfo {
  kind?: 'plain' | 'pc' | 'password';
  error?: string;
}

/** 복원 기록(main이 오류 로그에 남김). 개인정보 없이 파일 이름·연도·건수만 */
export interface RestoreLogEntry {
  stage: 'start' | 'done' | 'fail';
  file: string;
  years: string[];
  /** 백업 파일의 그 연도 헌금 건수 */
  count?: number;
  /** 복원 전 현재 데이터의 그 연도 헌금 건수 */
  current?: number;
  addedMembers?: number;
  addedTypes?: number;
  error?: string;
}

export interface SavedFileInfo {
  path: string;
  name: string;
}

export interface DesktopApi {
  /** 저장한 파일을 기본 프로그램으로 엽니다. 성공 시 빈 문자열, 실패 시 오류 문구. */
  openFile(path: string): Promise<string>;
  showInFolder(path: string): Promise<boolean>;
  /** 현재 화면을 PDF로 저장합니다(저장 창에서 취소하면 false). 저장되면 onDownloadDone으로도 알립니다. */
  savePdf(name: string): Promise<boolean>;
  /** PDF 저장이 끝나면 저장된 경로를 알려 줍니다. 구독 해제 함수를 반환합니다. */
  onDownloadDone(handler: (info: SavedFileInfo) => void): () => void;
  getAutoBackupStatus(): Promise<AutoBackupStatus | null>;
  ackAutoBackupStatus(): Promise<void>;
  /**
   * 백업을 줄 단위로 main에 보내 gzip 파일로 씁니다: begin(세션 번호, manual에서 사용자가 취소하면 null) → write(여러 번)
   * → end(검증 후 저장된 경로). 내역이 달을 넘어 옮겨져 다시 읽어야 하면 restart, 실패하면 abort. 다른 백업이 시작되면 이전 세션은 취소됩니다.
   * 폴더는 main이 정합니다: close·periodic은 기본 백업 폴더, manual은 저장 대화상자.
   */
  backupBegin(spec: BackupSessionSpec): Promise<number | null>;
  backupWrite(id: number, line: string): Promise<boolean>;
  backupRestart(id: number): Promise<number>;
  backupAbort(id: number): Promise<boolean>;
  backupEnd(id: number): Promise<string>;
  /** 복원할 백업 파일의 체크섬을 main이 확인합니다(암호화한 파일은 풀어서). ''=통과, 문구=실패 사유, null=확인하지 않음(경로를 모르는 파일 등) */
  verifyBackupFile?(file: File | string, password?: string): Promise<string | null>;
  /** 백업 파일이 암호화됐는지·암호가 필요한지(null = 경로를 모르는 파일). 파일 대신 latestAutoBackup이 준 표식도 받음 */
  inspectBackupFile(file: File | string): Promise<BackupFileInfo | null>;
  /** 전체 복원용: 백업 폴더의 가장 최근 종료 전체 백업(없으면 null). path는 실제 경로가 아니라 main이 해석하는 표식 */
  latestAutoBackup(): Promise<SavedFileInfo | null>;
  /** 암호화한 백업을 main이 풀어 줄 단위 평문 조각으로 건넵니다: open → read(끝이면 null) → close */
  openBackupReader(file: File | string, password?: string): Promise<number>;
  readBackup(id: number): Promise<Uint8Array | null>;
  closeBackupReader(id: number): Promise<boolean>;
  /** 종료 직전 main이 요청하면 handler가 백업을 저장하고 결과를 반환합니다(null = 백업 생략, blocked = 복원 중이라 닫지 않음). */
  onBackupRequest(handler: () => Promise<AutoBackupPayload | { blocked: true } | null>): () => void;
  /** 종료 중 자동 백업을 기다리다 사용자가 [백업 없이 종료]를 누른 경우 */
  skipBackup(): void;
  /** 백업 실패 후 사용자가 종료를 취소해 앱을 계속 쓰게 된 경우 main이 알려 줍니다. */
  onBackupCancelled(handler: () => void): () => void;
  /** [업데이트 확인]: 이때만 인터넷에 접속합니다. 실패하면 error에 안내 문구. */
  checkForUpdate(): Promise<UpdateCheck>;
  /** 바뀐 부분만 내려받습니다. ready면 앱을 닫을 때 설치됩니다. */
  downloadUpdate(): Promise<{ ready?: true; error?: string }>;
  /** 내려받기 진행률(0~100) */
  onUpdateProgress(handler: (percent: number) => void): () => void;
  /** 복원 기록을 main의 오류 로그에 남깁니다. */
  logRestore?(entry: RestoreLogEntry): void;
  /** 구글 로그인 상태: configured=로그인 설정(클라이언트 ID)이 있음, email=지금 로그인한 계정(없으면 null) */
  authStatus(): Promise<AuthStatus>;
  /** 시스템 브라우저로 구글 로그인을 엽니다. 토큰은 화면에 넘기지 않고 계정(이메일)만 돌려줍니다. */
  /** reauth: 잠금 해제용 재로그인(구글이 비밀번호를 다시 묻게 함) */
  authLogin(opts?: { reauth?: boolean }): Promise<{ email: string; role: Role } | { error: string }>;
  /** 자동 잠금 해제용 PIN(숫자 6자리)을 만듭니다. 로그인한 계정의 것만 다룹니다. */
  authSetPin(pin: string): Promise<{ ok: true } | { error: string }>;
  /** ok:false의 left=남은 시도 · locked=5회 실패로 로그아웃됨(구글 재로그인 필요) · noPin=PIN이 아직 없음 */
  authVerifyPin(pin: string): Promise<{ ok: true } | { ok: false; left: number } | { ok: false; locked: true } | { ok: false; noPin: true } | { ok: false; disabled: true } | { error: string }>;
  /** 계정·역할 관리(관리자만, main이 확인). 화면은 6단계 관리자 탭. 실패하면 { error }. */
  usersList(): Promise<{ users: UserEntry[] } | { error: string }>;
  usersLog(): Promise<{ log: AccountLogEntry[] } | { error: string }>;
  usersAdd(user: { email: string; role: Role }): Promise<{ ok: true } | { error: string }>;
  usersSetRole(email: string, role: Role): Promise<{ ok: true } | { error: string }>;
  usersSetDisabled(email: string, disabled: boolean): Promise<{ ok: true } | { error: string }>;
  /** 저장 데이터 열쇠(base64, 로그인 뒤에만). 풀 수 없으면 code가 DATA_KEY_UNREADABLE(Windows 계정이 바뀌었거나 다시 설치됨). */
  dataKey(): Promise<{ key: string } | { error: string; code?: string }>;
  /** 풀 수 없는 열쇠를 .old로 남기고 새로 만듭니다(화면이 저장소가 비었거나 새로 시작하기로 확인한 뒤에만). 멀쩡한 열쇠는 그대로 둡니다. */
  dataKeyReplace(): Promise<{ key: string } | { error: string }>;
  /** 브라우저 응답을 기다리는 로그인을 멈춥니다(그 로그인은 '취소했습니다' 오류로 끝남). */
  authCancel(): Promise<void>;
  authLogout(): Promise<void>;
}

/** 계정 목록의 한 줄(sub·PIN 해시는 화면에 주지 않음). registered=false는 한 번도 로그인하지 않은 사전 등록 */
export interface UserEntry {
  email: string;
  role: Role;
  addedAt: string;
  disabled: boolean;
  registered: boolean;
  hasPin: boolean;
}

/** 로그인·계정 변경 기록의 한 줄(who = 한 사람의 이메일) */
export interface AccountLogEntry {
  at: string;
  who: string;
  text: string;
}

export interface AuthStatus {
  configured: boolean;
  email: string | null;
  role: Role | null;
  hasPin: boolean;
}

export interface UpdateCheck {
  current: string;
  latest?: string;
  available?: boolean;
  error?: string;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export const desktop = (): DesktopApi | undefined => window.desktop;
