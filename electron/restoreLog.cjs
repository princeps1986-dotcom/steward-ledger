// 화면이 보낸 복원 기록(restore:log)을 검사합니다. 개인정보 없이 파일 이름·연도·건수만 받고, 형식이 틀리면 null(기록하지 않음).
const isCount = (n) => n === undefined || (Number.isSafeInteger(n) && n >= 0);

/** 올바르면 로그에 남길 { stage, entry }, 아니면 null */
function parseRestoreLog(e) {
  if (!e || typeof e !== 'object') return null;
  if (!['start', 'done', 'fail'].includes(e.stage) || typeof e.file !== 'string' || e.file.length > 255) return null;
  if (!Array.isArray(e.years) || e.years.length > 100 || !e.years.every((y) => typeof y === 'string' && /^\d{4}$/.test(y))) return null;
  if (![e.count, e.current, e.addedMembers, e.addedTypes].every(isCount)) return null;
  if (e.error !== undefined && (typeof e.error !== 'string' || e.error.length > 500)) return null;
  const { file, years, count, current, addedMembers, addedTypes, error } = e;
  return { stage: e.stage, entry: { file, years, count, current, addedMembers, addedTypes, error } };
}

module.exports = { parseRestoreLog };
