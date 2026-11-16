// Electron preload(contextBridge)가 노출하는 최소 API. 일반 브라우저(개발용)에서는 undefined입니다.

export interface AutoBackupStatus {
  ok: boolean;
  at: string;
  file?: string;
  error?: string;
}

export interface AutoBackupPayload {
  dir: string;
  json: string;
}

export interface SavedFileInfo {
  path: string;
  name: string;
}

export interface DesktopApi {
  /** 저장한 파일을 기본 프로그램으로 엽니다. 성공 시 빈 문자열, 실패 시 오류 문구. */
  openFile(path: string): Promise<string>;
  showInFolder(path: string): Promise<boolean>;
  /** 엑셀(.xlsx) 저장이 끝나면 저장된 경로를 알려 줍니다. 구독 해제 함수를 반환합니다. */
  onDownloadDone(handler: (info: SavedFileInfo) => void): () => void;
  getDefaultBackupDir(): Promise<string>;
  selectBackupDir(): Promise<string | null>;
  getAutoBackupStatus(): Promise<AutoBackupStatus | null>;
  ackAutoBackupStatus(): Promise<void>;
  /** 종료 직전 main이 요청하면 handler가 백업 내용을 반환합니다(null = 백업 생략). */
  onBackupRequest(handler: () => Promise<AutoBackupPayload | null>): () => void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export const desktop = (): DesktopApi | undefined => window.desktop;
