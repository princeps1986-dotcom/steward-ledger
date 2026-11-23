// 자동 백업(종료·주기)을 잠그는 이 PC의 키: 처음 쓸 때 무작위로 만들어 Windows 보안 저장소(DPAPI)로 잠근 뒤 앱 데이터 폴더(dir)에 둡니다.
// 설치 파일에는 키가 없으므로 백업 파일을 다른 곳으로 가져가면 열 수 없습니다(PC를 옮길 때는 암호를 건 직접 백업을 씀).
// Electron 45에서 동기 safeStorage가 사용 중단(46에서 삭제)되어 비동기 함수를 씁니다. 예전 동기 함수로 잠근 키 파일도 그대로 풀립니다.
// safeStorage·폴더·로그를 받아 쓰므로 Electron 없이 시험할 수 있습니다(src/services/pcKey.test.ts).
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { oldPcKeyFiles } = require('./dataPaths.cjs');
const { keyIdOf } = require('./backupCrypto.cjs');

/** 임시 파일에 쓴 뒤 이름을 바꿔, 쓰는 도중 꺼지거나 디스크가 가득 차도 기존 키 파일이 깨지지 않게 합니다. */
async function writeKeyFile(file, data) {
  const tmp = `${file}.tmp`;
  const h = await fs.open(tmp, 'w');
  try {
    await h.writeFile(data);
    await h.sync(); // 이름을 바꾸기 전에 내용을 디스크에 내려, 전원이 나가도 빈 키 파일이 남지 않게 합니다.
  } finally {
    await h.close();
  }
  await fs.rename(tmp, file);
}

/** stamp: 풀 수 없는 키 파일 이름에 붙일 시각 문자열을 돌려주는 함수 */
function createPcKeyStore({ safeStorage, dir, log, stamp }) {
  const file = path.join(dir, 'backup-key.bin');
  // 동시에 여러 번 불려도 키를 한 번만 만들도록 진행 중인 Promise를 함께 씁니다(실패하면 다음 호출 때 다시 시도).
  let pcKeyPromise = null;
  const getPcKey = () => (pcKeyPromise ??= loadPcKey().catch((err) => ((pcKeyPromise = null), Promise.reject(err))));

  async function loadPcKey() {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('이 PC에서 백업 암호화를 쓸 수 없습니다.');
    let locked = null;
    try {
      locked = await fs.readFile(file);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // 읽기 오류(잠김 등)로 새 키를 만들면 예전 백업을 못 열게 되므로 실패로 알립니다.
    }
    if (locked) {
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(locked);
        const key = Buffer.from(result, 'base64');
        if (key.length === 32) {
          // 운영체제 쪽 보호 방식이 바뀌었으면 같은 키를 새 방식으로 다시 잠가 둡니다(키 값은 그대로라 예전 백업도 열림).
          if (shouldReEncrypt) {
            try {
              await writeKeyFile(file, await safeStorage.encryptStringAsync(result));
            } catch (e) {
              log.warn('backup key re-encrypt', e); // 다시 잠그지 못해도 키는 멀쩡하므로 그대로 씁니다.
            }
          }
          return key;
        }
      } catch {
        /* Windows를 다시 설치하는 등으로 풀 수 없음: 아래에서 새 키를 만듭니다 */
      }
      await fs.rename(file, `${file}.${stamp()}.old`); // 풀 수 없는 키 파일도 지우지 않고 남겨 둡니다.
    }
    const key = crypto.randomBytes(32);
    await writeKeyFile(file, await safeStorage.encryptStringAsync(key.toString('base64')));
    return key;
  }

  /**
   * 자동 백업 머리말의 키 식별값에 맞는 PC 키(없으면 null). 지금 키가 아니면 풀지 못해 .old로 남긴 예전 키를 차례로 풀어 봅니다
   * (잠깐의 오류로 새 키가 만들어져도 그 전의 자동 백업을 열 수 있게).
   */
  async function pcKeyFor(keyId) {
    const key = await getPcKey();
    if (keyId.equals(keyIdOf(key))) return key;
    for (const name of oldPcKeyFiles(await fs.readdir(dir).catch(() => []))) {
      try {
        const old = Buffer.from((await safeStorage.decryptStringAsync(await fs.readFile(path.join(dir, name)))).result, 'base64');
        if (old.length === 32 && keyId.equals(keyIdOf(old))) return old;
      } catch {
        /* 이 PC에서 풀 수 없는 예전 키 */
      }
    }
    return null;
  }

  return { getPcKey, pcKeyFor };
}

module.exports = { createPcKeyStore };
