import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { resolveUserDataDir, resolveBackupDir, pickBackupDir } = createRequire(import.meta.url)('../../electron/dataPaths.cjs') as {
  resolveUserDataDir(appData: string): string;
  resolveBackupDir(documents: string): string;
  pickBackupDir(requested: unknown, chosen: string | null, fallback: string): string;
};

const tmp = () => mkdtempSync(join(tmpdir(), 'steward-'));

describe('데이터·백업 폴더는 영문 경로', () => {
  it('새 설치는 StewardLedger를 쓴다', () => {
    const appData = tmp();
    expect(resolveUserDataDir(appData)).toBe(join(appData, 'StewardLedger'));
  });

  it('이전 한글 폴더의 데이터는 새 폴더로 옮겨 그대로 이어 쓴다', () => {
    const appData = tmp();
    mkdirSync(join(appData, '교회헌금회계', 'IndexedDB'), { recursive: true });
    writeFileSync(join(appData, '교회헌금회계', 'IndexedDB', 'data'), 'x');
    const dir = resolveUserDataDir(appData);
    expect(dir).toBe(join(appData, 'StewardLedger'));
    expect(existsSync(join(dir, 'IndexedDB', 'data'))).toBe(true);
    expect(existsSync(join(appData, '교회헌금회계'))).toBe(false);
  });

  it('새 폴더에 이미 데이터가 있으면 건드리지 않는다', () => {
    const appData = tmp();
    mkdirSync(join(appData, 'StewardLedger', 'IndexedDB'), { recursive: true });
    mkdirSync(join(appData, '교회헌금회계', 'IndexedDB'), { recursive: true });
    expect(resolveUserDataDir(appData)).toBe(join(appData, 'StewardLedger'));
    expect(existsSync(join(appData, '교회헌금회계'))).toBe(true);
  });

  it('새 폴더가 데이터 없이 껍데기만 있어도 이전 데이터를 옮겨 온다', () => {
    const appData = tmp();
    mkdirSync(join(appData, 'StewardLedger', 'Cache'), { recursive: true });
    mkdirSync(join(appData, '교회헌금회계', 'IndexedDB'), { recursive: true });
    const dir = resolveUserDataDir(appData);
    expect(existsSync(join(dir, 'IndexedDB'))).toBe(true);
  });

  it('기본 백업 폴더도 영문이고 이전 한글 백업 폴더는 이름을 바꿔 잇는다', () => {
    const docs = tmp();
    mkdirSync(join(docs, '교회헌금백업'));
    writeFileSync(join(docs, '교회헌금백업', 'backup_20260101_000000.json'), '{}');
    const dir = resolveBackupDir(docs);
    expect(dir).toBe(join(docs, 'StewardLedgerBackup'));
    expect(existsSync(join(dir, 'backup_20260101_000000.json'))).toBe(true);
  });
});

describe('자동 백업 폴더 허용', () => {
  const fallback = 'C:/Users/me/Documents/StewardLedgerBackup';
  const chosen = 'D:/Backups/church';
  // Windows 경로(D:/…) 기준 시험이라 Windows에서만 의미가 있습니다(앱은 Windows용, CI는 Linux).
  it.skipIf(process.platform !== 'win32')('사용자가 선택한 폴더와 같은 경로만 쓰고(대소문자 무시) 나머지는 기본 폴더로 바꾼다', () => {
    expect(pickBackupDir(chosen, chosen, fallback)).toBe(chosen);
    expect(pickBackupDir('d:/backups/CHURCH', chosen, fallback)).toBe(chosen);
    expect(pickBackupDir('C:/Windows/System32', chosen, fallback)).toBe(fallback);
    expect(pickBackupDir('../../evil', chosen, fallback)).toBe(fallback);
    expect(pickBackupDir(undefined, chosen, fallback)).toBe(fallback);
    expect(pickBackupDir(chosen, null, fallback)).toBe(fallback); // 선택한 적이 없으면 어떤 경로도 허용하지 않음
  });
});
