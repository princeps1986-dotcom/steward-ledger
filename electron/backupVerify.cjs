// 자동 백업 파일(gzip, 줄 단위 JSON) 검증: 마지막 줄의 SHA-256이 앞 줄 전체의 해시와 같은지 다시 읽어 확인합니다.
const fsSync = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

async function verifyBackupFile(file) {
  const hash = crypto.createHash('sha256');
  let prev = null;
  let carry = '';
  const stream = fsSync.createReadStream(file).pipe(zlib.createGunzip());
  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    carry += chunk;
    let i;
    while ((i = carry.indexOf(String.fromCharCode(10))) >= 0) {
      const line = carry.slice(0, i + 1);
      carry = carry.slice(i + 1);
      if (prev !== null) hash.update(prev);
      prev = line;
    }
  }
  if (carry !== '' || prev === null) throw new Error('백업 파일 검증 실패: 내용이 잘렸습니다.');
  let end;
  try {
    end = JSON.parse(prev);
  } catch {
    throw new Error('백업 파일 검증 실패: 끝 줄을 읽을 수 없습니다.');
  }
  if (end.t !== 'end' || end.sha256 !== hash.digest('hex')) throw new Error('백업 파일 검증 실패: 체크섬이 맞지 않습니다.');
}

module.exports = { verifyBackupFile };
