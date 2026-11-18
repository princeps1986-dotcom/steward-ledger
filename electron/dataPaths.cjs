// 데이터·백업 폴더 위치 결정 (영문 경로). 이전 버전의 한글 폴더가 있으면 한 번 옮겨 기존 데이터를 그대로 이어서 씁니다.
const fs = require('node:fs');
const path = require('node:path');

const USER_DATA_NAME = 'StewardLedger';
const LEGACY_USER_DATA_NAME = '교회헌금회계';
const BACKUP_DIR_NAME = 'StewardLedgerBackup';
const LEGACY_BACKUP_DIR_NAME = '교회헌금백업';

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

/** 앱 데이터(IndexedDB 등)가 실제로 들어 있는 폴더인지 */
const hasData = (dir) => exists(path.join(dir, 'IndexedDB'));

/**
 * 앱 데이터 폴더를 정합니다. 반드시 앱이 데이터를 열기 전(=app ready 이전)에 호출합니다.
 * - 새 폴더에 데이터가 이미 있으면 그대로 사용
 * - 이전 한글 폴더에 데이터가 있으면 새 이름으로 옮김(실패하면 데이터를 잃지 않도록 이전 폴더를 계속 사용)
 */
function resolveUserDataDir(appData) {
  const next = path.join(appData, USER_DATA_NAME);
  const legacy = path.join(appData, LEGACY_USER_DATA_NAME);
  if (hasData(next) || !exists(legacy)) return next;
  try {
    // 새 폴더가 데이터 없이 비어 있는 껍데기(캐시 등)로만 있으면 치우고 옮깁니다.
    if (exists(next)) fs.rmSync(next, { recursive: true, force: true });
    fs.renameSync(legacy, next);
    return next;
  } catch {
    return legacy; // 다른 프로그램이 폴더를 쓰고 있는 등: 데이터가 있는 이전 폴더를 계속 사용
  }
}

/** 기본 자동 백업 폴더(문서\StewardLedgerBackup). 이전 한글 백업 폴더가 있고 새 폴더가 없으면 이름을 바꿔 옮깁니다. */
function resolveBackupDir(documents) {
  const next = path.join(documents, BACKUP_DIR_NAME);
  const legacy = path.join(documents, LEGACY_BACKUP_DIR_NAME);
  if (!exists(next) && exists(legacy)) {
    try {
      fs.renameSync(legacy, next);
    } catch {
      return legacy;
    }
  }
  return next;
}

/**
 * 자동 백업을 쓸 폴더. 화면(렌더러)이 보낸 경로는 사용자가 [폴더 선택]으로 지정한 폴더와 같을 때만 쓰고,
 * 그 밖의 경로(침해된 화면이 임의 위치에 쓰려는 경우 포함)는 기본 폴더로 바꿉니다.
 */
function pickBackupDir(requested, chosen, fallback) {
  if (typeof requested !== 'string' || !chosen || !path.isAbsolute(requested)) return fallback;
  return path.resolve(requested).toLowerCase() === path.resolve(chosen).toLowerCase() ? chosen : fallback;
}

module.exports = { pickBackupDir, resolveUserDataDir, resolveBackupDir, USER_DATA_NAME, BACKUP_DIR_NAME };
