// 저장 데이터 건별 암호화(AES-256-GCM, WebCrypto). 데이터 열쇠는 main이 DPAPI로 잠가 둔 것을 로그인 뒤 받아 와 여기서 한 번만 가져옵니다
// (extractable: false라 화면 코드가 열쇠 값을 다시 꺼낼 수 없음). 열쇠가 없으면(브라우저·시연 모드) 저장소는 예전처럼 평문입니다.
// 암호문 = IV 12바이트 + AES-GCM 출력. additionalData(aad)로 행의 id를 묶어, 다른 행의 암호문을 옮겨 붙이면 풀리지 않게 합니다.

const IV_BYTES = 12;
let key: CryptoKey | null = null;

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

/** 로그인 직후 열쇠를 넣습니다. null이면 열쇠를 버립니다(로그아웃·잠금). */
export async function setDataKey(raw: Uint8Array | null): Promise<void> {
  key = raw ? await subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']) : null;
}

export const hasDataKey = (): boolean => key !== null;

export async function encryptJson(value: unknown, aad: string): Promise<Uint8Array> {
  if (!key) throw new Error('데이터 열쇠가 없어 저장할 수 없습니다.');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, utf8(JSON.stringify(value))));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

/** 암호문에서 IV와 본문을 나눕니다(WebCrypto 타입이 ArrayBuffer만 받아 복사해 둡니다). */
function split(buf: Uint8Array): { iv: Uint8Array<ArrayBuffer>; body: Uint8Array<ArrayBuffer> } {
  return { iv: new Uint8Array(buf.subarray(0, IV_BYTES)), body: new Uint8Array(buf.subarray(IV_BYTES)) };
}

export async function decryptJson<T>(buf: Uint8Array, aad: string): Promise<T> {
  if (!key) throw new Error('데이터 열쇠가 없어 내용을 풀 수 없습니다.');
  try {
    const { iv, body } = split(buf);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, body);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new Error('저장된 데이터를 풀 수 없습니다(열쇠가 다르거나 데이터가 손상됨). 수동 백업으로 복원하세요.');
  }
}

/** main이 base64로 넘긴 데이터 열쇠를 바이트로 */
export const keyFromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
