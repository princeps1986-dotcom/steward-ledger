// Electron preload(contextBridge)가 노출하는 최소 API. 일반 브라우저(개발용)에서는 undefined입니다.

export interface AutoBackupStatus {
  ok: boolean;
  at: string;
  file?: string;
  error?: string;
}

/** 자동 백업이 끝난 뒤 저장된 파일 경로(내용은 backupWrite로 이미 main에 보냄) */
export interface AutoBackupPayload {
  file: string;
}

/** close = 종료 때 · periodic = 앱을 쓰는 동안 · emergency = 복원·초기화 직전(name 필요) · manual = 저장 위치를 고름(name 필요) */
export interface BackupSessionSpec {
  kind: 'close' | 'periodic' | 'emergency' | 'manual';
  /** close·periodic에서 사용자가 고른 폴더(설정값). main이 허용한 폴더가 아니면 무시됩니다. */
  dir?: string;
  /** emergency·manual의 파일 이름(영문·숫자·_- 와 .json.gz) */
  name?: string;
  /** emergency에서 기본 백업 폴더 아래 별도 폴더에 저장(허용: before-demo = 시연 데이터 생성 직전의 원래 데이터) */
  folder?: 'before-demo';
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
  /** 엑셀(.xlsx) 저장이 끝나면 저장된 경로를 알려 줍니다. 구독 해제 함수를 반환합니다. */
  onDownloadDone(handler: (info: SavedFileInfo) => void): () => void;
  getDefaultBackupDir(): Promise<string>;
  selectBackupDir(): Promise<string | null>;
  getAutoBackupStatus(): Promise<AutoBackupStatus | null>;
  ackAutoBackupStatus(): Promise<void>;
  /**
   * 백업을 줄 단위로 main에 보내 gzip 파일로 씁니다: begin(세션 번호, manual에서 사용자가 취소하면 null) → write(여러 번)
   * → end(검증 후 저장된 경로). 내역이 달을 넘어 옮겨져 다시 읽어야 하면 restart, 실패하면 abort. 다른 백업이 시작되면 이전 세션은 취소됩니다.
   * 폴더는 main이 정합니다: close·periodic은 사용자가 고른 폴더 또는 기본 폴더(그 밖의 dir은 무시), emergency는 기본 폴더, manual은 저장 대화상자.
   */
  backupBegin(spec: BackupSessionSpec): Promise<number | null>;
  backupWrite(id: number, line: string): Promise<boolean>;
  backupRestart(id: number): Promise<number>;
  backupAbort(id: number): Promise<boolean>;
  backupEnd(id: number): Promise<string>;
  /** before-demo 폴더의 백업 파일을 조각(최대 4MB)씩 읽습니다: open(파일 이름) → chunk(id, 시작 위치; 빈 조각이면 끝) → close */
  backupReadOpen(name: string): Promise<{ id: number; size: number }>;
  backupReadChunk(id: number, offset: number): Promise<Uint8Array>;
  backupReadClose(id: number): Promise<boolean>;
  /** 종료 직전 main이 요청하면 handler가 백업을 저장하고 결과를 반환합니다(null = 백업 생략). */
  onBackupRequest(handler: () => Promise<AutoBackupPayload | null>): () => void;
  /** 종료 중 자동 백업을 기다리다 사용자가 [백업 없이 종료]를 누른 경우 */
  skipBackup(): void;
  /** 백업 실패 후 사용자가 종료를 취소해 앱을 계속 쓰게 된 경우 main이 알려 줍니다. */
  onBackupCancelled(handler: () => void): () => void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export const desktop = (): DesktopApi | undefined => window.desktop;
