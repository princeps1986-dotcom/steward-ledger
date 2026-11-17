// Electron preload(contextBridge)가 노출하는 최소 API. 일반 브라우저(개발용)에서는 undefined입니다.

export interface AutoBackupStatus {
  ok: boolean;
  at: string;
  file?: string;
  error?: string;
}

/** 자동 백업이 끝난 뒤 저장된 파일 경로(내용은 autoBackupWrite로 이미 main에 보냄) */
export interface AutoBackupPayload {
  file: string;
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
   * 자동 백업을 줄 단위로 main에 보내 파일로 씁니다: begin(세션 번호 반환) → write(여러 번) → end(검증 후 저장된 경로 반환).
   * 다른 백업이 시작되면 이 세션은 취소되어 write·end가 reject됩니다. dir은 main이 허용한 폴더가 아니면 기본 폴더로 바뀝니다.
   * kind 'periodic'은 앱을 쓰는 동안의 주기 백업(autosave_*, 최근 3개만 보관)입니다.
   */
  autoBackupBegin(dir: string, kind?: 'periodic'): Promise<number>;
  autoBackupWrite(id: number, line: string): Promise<boolean>;
  autoBackupEnd(id: number): Promise<string>;
  /** 종료 직전 main이 요청하면 handler가 백업을 저장하고 결과를 반환합니다(null = 백업 생략). */
  onBackupRequest(handler: () => Promise<AutoBackupPayload | null>): () => void;
  /** 긴급 백업을 백업 폴더에 대화상자 없이 저장합니다. 실패하면 reject. 저장된 전체 경로를 돌려줍니다. */
  saveEmergencyBackup(name: string, json: string): Promise<string>;
  /** 저장 위치를 고르게 해 백업을 저장합니다. 사용자가 취소하면 null. */
  saveBackupAs(name: string, json: string): Promise<string | null>;
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
