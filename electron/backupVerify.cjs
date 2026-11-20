// 백업 파일(줄 단위 JSON, .gz면 압축을 풀어서) 검증: 마지막 줄의 SHA-256이 앞 줄 전체의 해시와 같은지 다시 읽어 확인합니다.
// 글자로 바꾸지 않고 바이트를 그대로 해시합니다(한 줄이 한 달치라 수 MB여서, 글자를 이어 붙이며 줄을 찾으면 크게 느려짐).
const fsSync = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const NL = 10;

async function verifyBackupFile(file) {
  const hash = crypto.createHash('sha256');
  let last = []; // 가장 최근에 끝난 줄(다음 줄이 끝나야 끝 줄이 아님을 알고 해시함)
  let partial = []; // 마지막 줄바꿈 뒤의 바이트
  const raw = fsSync.createReadStream(file);
  // backup:end는 이름을 바꾸기 전의 임시 파일(….json.gz.tmp)을 검증하므로 .tmp가 붙어도 압축 파일로 읽습니다.
  const stream = /\.gz(\.tmp)?$/i.test(file) ? raw.pipe(zlib.createGunzip()) : raw;
  raw.on('error', (err) => stream.destroy(err));
  for await (const chunk of stream) {
    let start = 0;
    for (let p = chunk.indexOf(NL); p >= 0; p = chunk.indexOf(NL, start)) {
      for (const b of last) hash.update(b);
      partial.push(chunk.subarray(start, p + 1));
      last = partial;
      partial = [];
      start = p + 1;
    }
    if (start < chunk.length) partial.push(chunk.subarray(start));
  }
  if (partial.length || last.length === 0) throw new Error('백업 파일 검증 실패: 내용이 잘렸습니다.');
  let end;
  try {
    end = JSON.parse(Buffer.concat(last).toString('utf8'));
  } catch {
    throw new Error('백업 파일 검증 실패: 끝 줄을 읽을 수 없습니다.');
  }
  if (end.t !== 'end' || end.sha256 !== hash.digest('hex')) throw new Error('백업 파일 검증 실패: 체크섬이 맞지 않습니다.');
}

module.exports = { verifyBackupFile };
