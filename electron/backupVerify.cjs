// 백업 파일(줄 단위 JSON. 암호화한 .slbk는 풀고 압축을 풀어서, 예전 .gz는 압축만 풀어서) 검증: 마지막 줄의 SHA-256이 앞 줄 전체의 해시와 같은지 다시 읽어 확인합니다.
// 글자로 바꾸지 않고 바이트를 그대로 해시합니다(한 줄이 한 달치라 수 MB여서, 글자를 이어 붙이며 줄을 찾으면 크게 느려짐).
const fsSync = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream');
const { MAGIC, createDecryptStream } = require('./backupCrypto.cjs');

const NL = 10;

/** 파일이 암호화한 백업(.slbk)인지: 앞 4바이트로 판단합니다(이름이 아니라 내용으로). */
function isEncryptedFile(file) {
  const fd = fsSync.openSync(file, 'r');
  try {
    const b = Buffer.alloc(MAGIC.length);
    return fsSync.readSync(fd, b, 0, b.length, 0) === b.length && b.equals(MAGIC);
  } finally {
    fsSync.closeSync(fd);
  }
}

/** 백업 파일의 내용(줄 단위 평문)을 읽는 스트림: 암호화한 파일은 getKey로 풀고 압축을 풉니다. 예전 파일은 .gz면 압축만 풉니다. */
function openPlainStream(file, getKey) {
  const raw = fsSync.createReadStream(file);
  if (isEncryptedFile(file)) {
    if (!getKey) throw new Error('백업 파일 검증 실패: 암호화한 백업을 열 키가 없습니다.');
    const out = zlib.createGunzip();
    pipeline(raw, createDecryptStream(getKey), out, () => undefined); // 어느 단계의 오류든 out을 오류로 끝냅니다.
    return out;
  }
  // backup:end는 이름을 바꾸기 전의 임시 파일(….json.gz.tmp)을 검증하므로 .tmp가 붙어도 압축 파일로 읽습니다.
  const stream = /\.gz(\.tmp)?$/i.test(file) ? raw.pipe(zlib.createGunzip()) : raw;
  raw.on('error', (err) => stream.destroy(err));
  return stream;
}

async function verifyBackupFile(file, getKey) {
  const hash = crypto.createHash('sha256');
  let last = []; // 가장 최근에 끝난 줄(다음 줄이 끝나야 끝 줄이 아님을 알고 해시함)
  let partial = []; // 마지막 줄바꿈 뒤의 바이트
  const stream = openPlainStream(file, getKey);
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

module.exports = { verifyBackupFile, openPlainStream, isEncryptedFile };
