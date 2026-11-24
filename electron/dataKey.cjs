// 저장 데이터를 잠그는 데이터 열쇠(무작위 256비트): 처음 쓸 때 만들어 Windows 보안 저장소(DPAPI)로 잠가 둡니다. 같은 PC·같은 Windows 계정에서만 풀립니다.
// 백업 키(pcKey.cjs)와 달리 풀 수 없다고 새로 만들지 않습니다: 새 열쇠로는 기존 데이터를 영구히 열 수 없기 때문입니다.
// 풀 수 없으면 code가 DATA_KEY_UNREADABLE인 오류를 던지고 파일은 그대로 둡니다(복구는 수동 백업 복원).
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeKeyFile } = require('./pcKey.cjs');

const coded = (code, msg) => Object.assign(new Error(msg), { code });

function createDataKeyStore({ safeStorage, dir, log }) {
  const file = path.join(dir, 'data-key.bin');
  let promise = null; // 동시에 불려도 한 번만 만들고, 실패하면 다음 호출 때 다시 시도
  const getDataKey = () => (promise ??= load().catch((err) => ((promise = null), Promise.reject(err))));

  async function load() {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw coded('DATA_KEY_UNAVAILABLE', '이 PC에서 데이터 암호화를 쓸 수 없습니다.');
    let locked = null;
    try {
      locked = await fs.readFile(file);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // 읽기 오류로 새 열쇠를 만들면 기존 데이터를 못 열게 되므로 실패로 알립니다.
    }
    if (!locked) {
      const key = crypto.randomBytes(32);
      await writeKeyFile(file, await safeStorage.encryptStringAsync(key.toString('base64')));
      return key;
    }
    let result = null;
    let shouldReEncrypt = false;
    try {
      ({ result, shouldReEncrypt } = await safeStorage.decryptStringAsync(locked));
    } catch {
      /* 아래에서 알립니다 */
    }
    const key = result ? Buffer.from(result, 'base64') : null;
    if (!key || key.length !== 32) {
      throw coded('DATA_KEY_UNREADABLE', '데이터 열쇠를 풀 수 없습니다(Windows 계정이 바뀌었거나 다시 설치됨). 수동 백업으로 복원하세요.');
    }
    if (shouldReEncrypt) {
      try {
        await writeKeyFile(file, await safeStorage.encryptStringAsync(result));
      } catch (e) {
        log.warn('data key re-encrypt', e); // 다시 잠그지 못해도 열쇠는 멀쩡하므로 그대로 씁니다.
      }
    }
    return key;
  }

  return { getDataKey };
}

module.exports = { createDataKeyStore };
