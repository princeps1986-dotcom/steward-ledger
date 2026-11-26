// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Ev = { sender: object };
const req = createRequire(import.meta.url);
const { createBackupReaders } = req('../../electron/backupReader.cjs') as {
  createBackupReaders(o: { roleIs(...r: string[]): Promise<boolean>; notAllowed: string; resolvePath(f: string): string | null; keyForFile(pw?: string): () => Buffer; verifyMessage(e: Error): string }): {
    open(e: Ev, file: string, pw?: string): Promise<number>;
    read(e: Ev, id: number): Promise<Buffer | null>;
    close(e: Ev, id: number): boolean;
  };
};
const bc = req('../../electron/backupCrypto.cjs') as { pcHeader(k: Buffer): Buffer; createEncryptStream(h: Buffer, k: Buffer): NodeJS.ReadWriteStream };

const key = randomBytes(32);
const NOT_ALLOWED = '이 작업을 할 권한이 없습니다.';
let dir = '';
let file = '';
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'slbk-reader-'));
  file = join(dir, 'a.slbk');
  const parts: Buffer[] = [];
  for await (const c of Readable.from([gzipSync('장부 내용')]).pipe(bc.createEncryptStream(bc.pcHeader(key), key))) parts.push(c as Buffer);
  writeFileSync(file, Buffer.concat(parts));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const setup = () => {
  const state = { role: 'admin' as string | null };
  const readers = createBackupReaders({
    roleIs: async (...roles) => roles.includes(state.role ?? ''),
    notAllowed: NOT_ALLOWED,
    resolvePath: (f) => f,
    keyForFile: () => () => key,
    verifyMessage: (e) => e.message,
  });
  return { state, readers, event: { sender: {} } };
};

describe('풀린 백업 읽기(electron/backupReader.cjs)', () => {
  it('관리자는 끝까지 읽는다', async () => {
    const { readers, event } = setup();
    const id = await readers.open(event, file);
    expect((await readers.read(event, id))?.toString()).toBe('장부 내용');
    expect(await readers.read(event, id)).toBeNull();
  });

  it('로그인이 없거나 관리자가 아니면 열 수 없다', async () => {
    const { state, readers, event } = setup();
    for (const role of [null, 'finance', 'viewer']) {
      state.role = role;
      await expect(readers.open(event, file)).rejects.toThrow(NOT_ALLOWED);
    }
  });

  it('열어 둔 뒤 로그아웃하면 읽을 수 없다', async () => {
    const { state, readers, event } = setup();
    const id = await readers.open(event, file);
    state.role = null;
    await expect(readers.read(event, id)).rejects.toThrow(NOT_ALLOWED);
    readers.close(event, id);
  });

  it('다른 화면은 남의 읽기를 이어받지 못한다', async () => {
    const { readers, event } = setup();
    const id = await readers.open(event, file);
    await expect(readers.read({ sender: {} }, id)).rejects.toThrow('시작되지 않았습니다');
    readers.close(event, id);
  });
});
