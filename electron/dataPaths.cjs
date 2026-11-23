// 데이터 폴더 위치 결정 (영문 경로). 이전 버전의 한글 폴더가 있으면 한 번 옮겨 기존 데이터를 그대로 이어서 씁니다.
const fs = require('node:fs');
const path = require('node:path');

const USER_DATA_NAME = 'StewardLedger';
const LEGACY_USER_DATA_NAME = '교회헌금회계';

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

// 자동 백업 파일 이름. 지금 자동 백업은 암호화한 .slbk로만 만듭니다. 예전 .json(.gz)는 직접 백업과 이름이 같았으므로
// (연도 표시가 생기기 전 직접 백업 = backup_YYYYMMDD_HHMMSS.json) 보관 개수 정리에서 세지도 지우지도 않습니다.
const AUTO_BACKUP_KEEP = 10;
const PERIODIC_BACKUP_KEEP = 3;
const AUTO_BACKUP_FILE_RE = /^backup_\d{8}_\d{6}\.slbk$/;
const PERIODIC_BACKUP_FILE_RE = /^autosave_\d{8}_\d{6}\.slbk$/;
const TEMP_BACKUP_FILE_RE = /^(backup|autosave)_\d{8}_\d{6}\.(slbk|json(\.gz)?)\.tmp$/;

/** 백업 폴더의 파일 이름 중 지울 것: 쓰다 중단된 임시 파일, 종료 백업은 최근 10개·주기 백업은 최근 3개를 넘는 오래된 것 */
function backupsToPrune(names) {
  const out = names.filter((n) => TEMP_BACKUP_FILE_RE.test(n));
  for (const [re, keep] of [[AUTO_BACKUP_FILE_RE, AUTO_BACKUP_KEEP], [PERIODIC_BACKUP_FILE_RE, PERIODIC_BACKUP_KEEP]]) {
    const matched = names.filter((n) => re.test(n)).sort();
    out.push(...matched.slice(0, Math.max(0, matched.length - keep)));
  }
  return out;
}

/** 백업 폴더의 파일 이름 중 가장 최근 종료 전체 백업(backup_*.slbk). 없으면 null. 10분 주기 autosave_*는 바뀐 연도만 담으므로 제외 */
function latestFullBackup(names) {
  return names.filter((n) => AUTO_BACKUP_FILE_RE.test(n)).sort().pop() ?? null;
}

/** 앱 데이터 폴더의 파일 이름 중 풀지 못해 남겨 둔 예전 PC 키(backup-key.bin.<시각>.old), 최근 것부터 */
function oldPcKeyFiles(names) {
  return names.filter((n) => /^backup-key\.bin\.\d{8}_\d{6}\.old$/.test(n)).sort().reverse();
}

module.exports = { resolveUserDataDir, backupsToPrune, latestFullBackup, oldPcKeyFiles, USER_DATA_NAME };
