import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

interface FakeSafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(t: string): Promise<Buffer>;
  decryptStringAsync(b: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
interface Store {
  getPcKey(): Promise<Buffer>;
  pcKeyFor(id: Buffer): Promise<Buffer | null>;
}
const req = createRequire(import.meta.url);
const { createPcKeyStore } = req('../../electron/pcKey.cjs') as { createPcKeyStore(o: { safeStorage: FakeSafeStorage; dir: string; log: { warn(...a: unknown[]): void }; stamp(): string }): Store };
const { keyIdOf } = req('../../electron/backupCrypto.cjs') as { keyIdOf(k: Buffer): Buffer };

const PREFIX = 'ENC:';
/** 가짜 safeStorage: 'ENC:' 머리가 붙은 것만 풀립니다. fail로 풀기·잠그기를 실패시킬 수 있습니다. */
function fakeStorage(opts: { reEncrypt?: boolean } = {}) {
  const fail = { decrypt: false, encrypt: false };
  const storage: FakeSafeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (t) => {
      if (fail.encrypt) throw new Error('encrypt 실패');
      return Buffer.from(PREFIX + t);
    },
    decryptStringAsync: async (b) => {
      const s = b.toString();
      if (fail.decrypt || !s.startsWith(PREFIX)) throw new Error('decrypt 실패');
      return { result: s.slice(PREFIX.length), shouldReEncrypt: !!opts.reEncrypt };
    },
  };
  return { storage, fail };
}
const tmpDir = () => mkdtempSync(join(tmpdir(), 'steward-pckey-'));
const make = (dir: string, storage: FakeSafeStorage, warn = vi.fn()) => ({ store: createPcKeyStore({ safeStorage: storage, dir, log: { warn }, stamp: () => '20260101_000000' }), warn });
const files = (dir: string) => readdirSync(dir).sort();

describe('PC 키(electron/pcKey.cjs)', () => {
  it('처음에는 키를 만들어 잠가 두고, 다시 열면 같은 키를 쓴다(임시 파일은 남지 않는다)', async () => {
    const dir = tmpDir();
    const { storage } = fakeStorage();
    const a = await make(dir, storage).store.getPcKey();
    expect(a).toHaveLength(32);
    expect(files(dir)).toEqual(['backup-key.bin']);
    expect(readFileSync(join(dir, 'backup-key.bin')).toString().startsWith(PREFIX)).toBe(true);
    expect((await make(dir, storage).store.getPcKey()).equals(a)).toBe(true);
  });

  it('동시에 여러 번 불러도 키를 한 번만 만든다', async () => {
    const dir = tmpDir();
    const { store } = make(dir, fakeStorage().storage);
    const keys = await Promise.all([store.getPcKey(), store.getPcKey(), store.getPcKey()]);
    expect(keys[1].equals(keys[0]) && keys[2].equals(keys[0])).toBe(true);
    expect(files(dir)).toEqual(['backup-key.bin']);
  });

  it('키 파일을 읽을 수 없으면(잠김 등) 새 키를 만들지 않고 실패한다', async () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'backup-key.bin')); // 읽으면 ENOENT가 아닌 오류
    await expect(make(dir, fakeStorage().storage).store.getPcKey()).rejects.toThrow();
    expect(files(dir)).toEqual(['backup-key.bin']);
  });

  it('풀 수 없는 키 파일은 .old로 남기고 새 키를 만들며, 예전 키로 만든 백업의 키 식별값도 찾아 준다', async () => {
    const dir = tmpDir();
    const { storage, fail } = fakeStorage();
    const old = await make(dir, storage).store.getPcKey();
    fail.decrypt = true; // 잠깐의 오류로 풀지 못함
    const { store } = make(dir, storage);
    const fresh = await store.getPcKey();
    fail.decrypt = false;
    expect(fresh.equals(old)).toBe(false);
    expect(files(dir)).toEqual(['backup-key.bin', 'backup-key.bin.20260101_000000.old']);
    expect((await store.pcKeyFor(keyIdOf(fresh)))?.equals(fresh)).toBe(true);
    expect((await store.pcKeyFor(keyIdOf(old)))?.equals(old)).toBe(true);
    expect(await store.pcKeyFor(keyIdOf(Buffer.alloc(32, 7)))).toBeNull();
  });

  it('보호 방식이 바뀌어 다시 잠그면 같은 키를 새로 잠가 저장한다', async () => {
    const dir = tmpDir();
    const first = await make(dir, fakeStorage().storage).store.getPcKey();
    const { storage } = fakeStorage({ reEncrypt: true });
    const enc = vi.spyOn(storage, 'encryptStringAsync');
    const again = await make(dir, storage).store.getPcKey();
    expect(again.equals(first)).toBe(true);
    expect(enc).toHaveBeenCalledOnce();
    expect(files(dir)).toEqual(['backup-key.bin']);
  });

  it('다시 잠그다 실패해도 멀쩡한 키를 바꾸지 않고 경고만 남긴다', async () => {
    const dir = tmpDir();
    const first = await make(dir, fakeStorage().storage).store.getPcKey();
    const { storage, fail } = fakeStorage({ reEncrypt: true });
    fail.encrypt = true;
    const { store, warn } = make(dir, storage);
    expect((await store.getPcKey()).equals(first)).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(files(dir)).toEqual(['backup-key.bin']); // .old도 새 키도 없음
  });
});
