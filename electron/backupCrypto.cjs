// 암호화한 백업 파일(.slbk) 형식. 내용은 지금의 줄 단위 백업(끝 줄 SHA-256 포함)을 gzip한 바이트이고, 그것을 약 1MB 조각마다 AES-256-GCM으로 암호화합니다.
// 머리말: 'SLBK' + 형식 버전(1) + 방식(1=이 PC의 키, 2=사용자 암호) + [방식1: 키 식별값 8바이트 | 방식2: salt 16바이트 + 반복 횟수 4바이트]
// 조각: 길이(4) + 마지막 조각 표시(1) + IV(12) + 암호문(+인증 태그 16). 인증 데이터에 머리말·조각 번호·마지막 표시를 넣어 바꿔치기·순서 바꾸기·잘라내기를 막습니다.
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { promisify } = require("node:util");

const MAGIC = Buffer.from("SLBK");
const MODE_PC = 1;
const MODE_PASSWORD = 2;
const CHUNK = 1024 * 1024;
const PBKDF2_ITERATIONS = 600000;
const FAIL = "백업 파일 검증 실패";
const pbkdf2 = promisify(crypto.pbkdf2);

const keyIdOf = (key) =>
  crypto.createHash("sha256").update(key).digest().subarray(0, 8);
const deriveKey = (password, salt, iterations) =>
  pbkdf2(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");

/** 이 PC의 키로 잠그는 머리말 */
function pcHeader(key) {
  return Buffer.concat([MAGIC, Buffer.from([1, MODE_PC]), keyIdOf(key)]);
}
/** 사용자 암호로 잠그는 머리말과 키(salt는 파일마다 새로) */
async function passwordHeader(password) {
  const salt = crypto.randomBytes(16);
  const iter = Buffer.alloc(4);
  iter.writeUInt32BE(PBKDF2_ITERATIONS);
  return {
    header: Buffer.concat([MAGIC, Buffer.from([1, MODE_PASSWORD]), salt, iter]),
    key: await deriveKey(password, salt, PBKDF2_ITERATIONS),
  };
}

/** 머리말을 읽습니다. 암호화한 백업이 아니면 null, 머리말이 아직 덜 왔으면 undefined */
function parseHeader(buf) {
  if (buf.length < 6)
    return buf.length >= MAGIC.length && !buf.subarray(0, 4).equals(MAGIC)
      ? null
      : undefined;
  if (!buf.subarray(0, 4).equals(MAGIC)) return null;
  if (buf[4] !== 1)
    throw new Error(
      `${FAIL}: 이 프로그램보다 새 버전에서 만든 백업입니다. 프로그램을 업데이트하세요.`,
    );
  if (buf[5] === MODE_PC)
    return buf.length < 14
      ? undefined
      : { mode: "pc", keyId: buf.subarray(6, 14), bytes: buf.subarray(0, 14) };
  if (buf[5] === MODE_PASSWORD) {
    if (buf.length < 26) return undefined;
    const iterations = buf.readUInt32BE(22);
    // 조작된 파일이 반복 횟수를 터무니없이 크게 적어 앱을 멈추게 하지 못하도록 허용 범위만 받습니다.
    if (iterations < 100000 || iterations > 2000000)
      throw new Error(`${FAIL}: 알 수 없는 백업 형식입니다.`);
    return {
      mode: "password",
      salt: buf.subarray(6, 22),
      iterations,
      bytes: buf.subarray(0, 26),
    };
  }
  throw new Error(`${FAIL}: 알 수 없는 백업 형식입니다.`);
}

const aadOf = (header, index, last) => {
  const b = Buffer.alloc(5);
  b.writeUInt32BE(index);
  b[4] = last ? 1 : 0;
  return Buffer.concat([header, b]);
};

/** 평문(gzip 바이트)을 받아 .slbk 바이트를 내보내는 스트림 */
function createEncryptStream(header, key) {
  let pending = [];
  let size = 0;
  let index = 0;
  let started = false;
  const frame = (plain, last) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(aadOf(header, index++, last));
    const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
    const head = Buffer.alloc(5);
    head.writeUInt32BE(body.length);
    head[4] = last ? 1 : 0;
    return Buffer.concat([head, iv, body]);
  };
  return new Transform({
    transform(chunk, _enc, cb) {
      if (!started) (this.push(header), (started = true));
      pending.push(chunk);
      size += chunk.length;
      // 마지막 조각을 알아야 하므로 1MB를 넘게 모였을 때만 앞부분을 내보냅니다(남은 것은 끝에서 마지막 조각으로).
      if (size > CHUNK) {
        const all = Buffer.concat(pending);
        let off = 0;
        for (; all.length - off > CHUNK; off += CHUNK)
          this.push(frame(all.subarray(off, off + CHUNK), false));
        pending = [all.subarray(off)];
        size = all.length - off;
      }
      cb();
    },
    flush(cb) {
      if (!started) this.push(header);
      this.push(frame(Buffer.concat(pending), true));
      cb();
    },
  });
}

/**
 * .slbk 바이트를 받아 평문(gzip 바이트)을 내보내는 스트림. getKey(머리말)는 키(Buffer)를 돌려주거나 오류를 던집니다(비동기 가능).
 * 틀린 키·변조·잘림은 '백업 파일 검증 실패'로 시작하는 오류가 됩니다.
 */
function createDecryptStream(getKey) {
  let buf = Buffer.alloc(0);
  let header = null;
  let key = null;
  let index = 0;
  let done = false;
  return new Transform({
    // 키를 구하는 일(암호 → 키)이 비동기라 async 함수로 처리하고, 콜백은 한 번만 부릅니다.
    transform(chunk, _enc, cb) {
      void step.call(this, chunk).then(() => cb(), cb);
    },
    flush(cb) {
      cb(
        done && buf.length === 0
          ? null
          : new Error(`${FAIL}: 내용이 잘렸습니다.`),
      );
    },
  });
  async function step(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (!header) {
      const h = parseHeader(buf);
      if (h === null)
        throw new Error(`${FAIL}: 암호화한 백업 파일이 아닙니다.`);
      if (h === undefined) return;
      header = h;
      key = await getKey(h);
      buf = buf.subarray(h.bytes.length);
    }
    while (buf.length >= 17) {
      if (done) throw new Error(`${FAIL}: 끝 뒤에 다른 내용이 있습니다.`);
      const len = buf.readUInt32BE(0);
      if (len < 16 || len > CHUNK + 16)
        throw new Error(`${FAIL}: 파일이 손상되었습니다.`);
      if (buf.length < 17 + len) break;
      const last = buf[4] === 1;
      const d = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        buf.subarray(5, 17),
      );
      d.setAAD(aadOf(header.bytes, index, last));
      d.setAuthTag(buf.subarray(17 + len - 16, 17 + len));
      let plain;
      try {
        plain = Buffer.concat([
          d.update(buf.subarray(17, 17 + len - 16)),
          d.final(),
        ]);
      } catch {
        const wrongPassword = index === 0 && header.mode === "password";
        throw new Error(
          `${FAIL}: ${wrongPassword ? "암호가 맞지 않습니다." : "파일이 손상되었습니다."}`,
        );
      }
      index++;
      done = last;
      buf = buf.subarray(17 + len);
      if (plain.length) this.push(plain);
    }
  }
}

module.exports = {
  pcHeader,
  passwordHeader,
  parseHeader,
  deriveKey,
  keyIdOf,
  createEncryptStream,
  createDecryptStream,
  MAGIC,
  CHUNK,
};
