// 암호화한 백업을 화면이 줄 단위로 읽도록 main이 풀어서 조각(최대 1MB)으로 건넵니다. 화면은 키를 모릅니다.
// 풀린 내용은 장부 전체이므로 열기·읽기 모두 관리자 로그인을 확인합니다(복원은 관리자만, src/services/auth/roles.ts의 backup:restore).
// Electron 없이 시험할 수 있도록 main.cjs에서 떼어 냈습니다(src/services/backupReader.test.ts).
const { openPlainStream, isEncryptedFile } = require('./backupVerify.cjs');

/** resolvePath: 화면이 준 값을 읽어도 되는 경로로(안 되면 null) · keyForFile(password): 머리말로 키를 찾는 함수 */
function createBackupReaders({ roleIs, notAllowed, resolvePath, keyForFile, verifyMessage }) {
  const readers = new Map();
  let counter = 0;
  const requireAdmin = async () => {
    if (!(await roleIs('admin'))) throw new Error(notAllowed);
  };
  const drop = (id, r) => {
    readers.delete(id);
    r.stream.destroy();
  };
  const own = (event, id) => {
    const r = readers.get(id);
    return r && r.sender === event.sender ? r : null;
  };

  return {
    open: async (event, file, password) => {
      await requireAdmin();
      const p = resolvePath(file);
      if (!p) throw new Error('백업 파일을 읽을 수 없습니다.');
      // 닫지 않은 읽기(화면을 다시 불러온 경우 등)가 쌓이지 않게 가장 오래된 것부터 닫습니다.
      for (const [oldId, r] of readers) {
        if (readers.size < 8) break;
        drop(oldId, r);
      }
      let stream;
      try {
        // 암호화한 백업만 풀어 건넵니다(예전 일반 파일은 화면이 직접 읽으므로, 여기서 임의 파일 내용을 넘기지 않음).
        if (!isEncryptedFile(p)) throw new Error('백업 파일 검증 실패: 암호화한 백업 파일이 아닙니다.');
        stream = openPlainStream(p, keyForFile(password));
      } catch (err) {
        throw new Error(verifyMessage(err));
      }
      const id = ++counter;
      readers.set(id, { stream, it: stream[Symbol.asyncIterator](), sender: event.sender });
      return id;
    },
    read: async (event, id) => {
      await requireAdmin();
      const r = own(event, id);
      if (!r) throw new Error('백업 파일 읽기가 끝났거나 시작되지 않았습니다.');
      const parts = [];
      let size = 0;
      try {
        while (size < 1024 * 1024) {
          const { value, done } = await r.it.next();
          if (done) break;
          parts.push(value);
          size += value.length;
        }
      } catch (err) {
        drop(id, r);
        throw new Error(verifyMessage(err));
      }
      if (parts.length === 0) {
        readers.delete(id);
        return null;
      }
      return Buffer.concat(parts);
    },
    // 닫기는 내용을 내주지 않으므로 로그인과 상관없이 받습니다.
    close: (event, id) => {
      const r = own(event, id);
      if (r) drop(id, r);
      return true;
    },
  };
}

module.exports = { createBackupReaders };
