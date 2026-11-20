import 'fake-indexeddb/auto';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync, gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { monthWrite, transact } from '../storage/storageService';
import { createBackupBlob } from './backupService';

type Header = { mode: 'pc' | 'password'; keyId?: Buffer; salt?: Buffer; iterations?: number; bytes: Buffer };
type GetKey = (h: Header) => Buffer | Promise<Buffer>;
const req = createRequire(import.meta.url);
const bc = req('../../../electron/backupCrypto.cjs') as {
  pcHeader(key: Buffer): Buffer;
  passwordHeader(pw: string): Promise<{ header: Buffer; key: Buffer }>;
  deriveKey(pw: string, salt: Buffer, it: number): Promise<Buffer>;
  keyIdOf(key: Buffer): Buffer;
  createEncryptStream(header: Buffer, key: Buffer): NodeJS.ReadWriteStream;
  createDecryptStream(getKey: GetKey): NodeJS.ReadWriteStream;
  CHUNK: number;
};
const { verifyBackupFile } = req('../../../electron/backupVerify.cjs') as { verifyBackupFile(file: string, getKey?: GetKey): Promise<void> };

const collect = async (s: NodeJS.ReadableStream): Promise<Buffer> => {
  const parts: Buffer[] = [];
  for await (const c of s) parts.push(c as Buffer);
  return Buffer.concat(parts);
};
const encrypt = (plain: Buffer, header: Buffer, key: Buffer) => collect(Readable.from([plain]).pipe(bc.createEncryptStream(header, key)));
const decrypt = (data: Buffer, getKey: GetKey) => collect(Readable.from([data]).pipe(bc.createDecryptStream(getKey)));
const pcKey = randomBytes(32);
const pcGetKey: GetKey = (h) => {
  if (h.mode !== 'pc' || !h.keyId!.equals(bc.keyIdOf(pcKey))) throw new Error('백업 파일 검증 실패: 다른 PC');
  return pcKey;
};
const pwGetKey =
  (pw: string): GetKey =>
  (h) =>
    bc.deriveKey(pw, h.salt!, h.iterations!);

let text = '';
let dir = '';
beforeAll(async () => {
  const d = { id: 'a', date: '2026-01-04', memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: 'c', updatedAt: 'x' } as Donation;
  await transact(async () => ({ writes: [monthWrite('2026-01', [d])], result: 0 }));
  text = await (await createBackupBlob()).text();
  dir = mkdtempSync(join(tmpdir(), 'slbk-'));
});

describe('암호화한 백업(electron/backupCrypto.cjs)', () => {
  it('PC 키로 암호화한 내용은 같은 키로만 풀린다(여러 조각 포함)', async () => {
    const big = randomBytes(bc.CHUNK * 2 + 123); // 조각 3개
    const enc = await encrypt(big, bc.pcHeader(pcKey), pcKey);
    expect(enc.includes(big.subarray(0, 64))).toBe(false);
    expect((await decrypt(enc, pcGetKey)).equals(big)).toBe(true);
    const other = randomBytes(32);
    await expect(decrypt(await encrypt(big, bc.pcHeader(other), other), pcGetKey)).rejects.toThrow('다른 PC');
  });

  it('빈 내용도 왕복된다', async () => {
    expect((await decrypt(await encrypt(Buffer.alloc(0), bc.pcHeader(pcKey), pcKey), pcGetKey)).length).toBe(0);
  });

  it('암호 방식: 맞는 암호로만 풀리고 틀리면 "암호가 맞지 않습니다"', async () => {
    const { header, key } = await bc.passwordHeader('교회1234');
    const enc = await encrypt(Buffer.from('hello'), header, key);
    expect((await decrypt(enc, pwGetKey('교회1234'))).toString()).toBe('hello');
    await expect(decrypt(enc, pwGetKey('교회12345'))).rejects.toThrow('암호가 맞지 않습니다');
  });

  it('조작된 머리말의 반복 횟수(PBKDF2)가 허용 범위를 벗어나면 키를 만들지 않고 거부한다', async () => {
    const { header, key } = await bc.passwordHeader('교회1234');
    const enc = await encrypt(Buffer.from('hello'), header, key);
    enc.writeUInt32BE(0xffffffff, 22);
    let called = false;
    await expect(decrypt(enc, () => ((called = true), key))).rejects.toThrow('알 수 없는 백업 형식');
    expect(called).toBe(false);
  });

  it('변조·잘림·조각 순서 바꿈·뒤에 덧붙임을 거부한다', async () => {
    const plain = randomBytes(bc.CHUNK + 10); // 조각 2개
    const header = bc.pcHeader(pcKey);
    const enc = await encrypt(plain, header, pcKey);
    const flipped = Buffer.from(enc);
    flipped[header.length + 40] ^= 1;
    await expect(decrypt(flipped, pcGetKey)).rejects.toThrow('손상');
    // 첫 조각만 남기기(마지막 표시가 없음) → 잘림
    const firstLen = 17 + enc.readUInt32BE(header.length);
    await expect(decrypt(enc.subarray(0, header.length + firstLen), pcGetKey)).rejects.toThrow('잘렸습니다');
    // 두 조각 순서 바꾸기
    const f1 = enc.subarray(header.length, header.length + firstLen);
    const f2 = enc.subarray(header.length + firstLen);
    await expect(decrypt(Buffer.concat([header, f2, f1]), pcGetKey)).rejects.toThrow('백업 파일 검증 실패');
    await expect(decrypt(Buffer.concat([enc, Buffer.from('x')]), pcGetKey)).rejects.toThrow('백업 파일 검증 실패');
  });

  it('main의 검증이 .slbk를 풀어서 체크섬까지 확인하고, 예전 .json.gz도 그대로 확인한다', async () => {
    const good = join(dir, 'a.slbk');
    writeFileSync(good, await encrypt(gzipSync(text), bc.pcHeader(pcKey), pcKey));
    await expect(verifyBackupFile(good, pcGetKey)).resolves.toBeUndefined();
    await expect(verifyBackupFile(good)).rejects.toThrow('키가 없습니다');
    // 임시 파일 이름(.slbk.tmp)도 내용으로 판단합니다
    writeFileSync(join(dir, 'a.slbk.tmp'), readFileSync(good));
    await expect(verifyBackupFile(join(dir, 'a.slbk.tmp'), pcGetKey)).resolves.toBeUndefined();
    // 내용(평문)이 변조된 채 올바르게 암호화된 파일 → 체크섬에서 걸림
    const bad = join(dir, 'bad.slbk');
    writeFileSync(bad, await encrypt(gzipSync(text.replace('"amount":1000', '"amount":9000')), bc.pcHeader(pcKey), pcKey));
    await expect(verifyBackupFile(bad, pcGetKey)).rejects.toThrow('체크섬');
    writeFileSync(join(dir, 'old.json.gz'), gzipSync(text));
    await expect(verifyBackupFile(join(dir, 'old.json.gz'))).resolves.toBeUndefined();
    // 파일을 gzip으로 열려 해도 읽히지 않습니다(사용자가 임의로 열 수 없음)
    expect(() => gunzipSync(readFileSync(good))).toThrow();
  });
});
