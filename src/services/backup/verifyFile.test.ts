import 'fake-indexeddb/auto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Donation } from '../../contexts/types';
import { monthWrite, transact } from '../storage/storageService';
import { createBackupBlob } from './backupService';
import { scanBackupFile } from './streamRestore';

const { verifyBackupFile } = createRequire(import.meta.url)('../../../electron/backupVerify.cjs') as { verifyBackupFile(file: string): Promise<void> };
const d = (id: string, date: string): Donation =>
  ({ id, date, memberId: null, donorDisplayName: '무명1', offeringTypeId: 't', amount: 1000, createdAt: `c${id}`, updatedAt: 'x' }) as Donation;

let text = '';
let dir = '';
beforeAll(async () => {
  await transact(async () => ({ writes: [monthWrite('2026-01', [d('a', '2026-01-04')])], result: 0 }));
  text = await (await createBackupBlob()).text();
  dir = mkdtempSync(join(tmpdir(), 'verify-'));
});
const tampered = () => text.replace('"amount":1000', '"amount":9000');

describe('main-process checksum check (electron/backupVerify.cjs)', () => {
  it('accepts plain and gzip line backups and rejects a tampered one', async () => {
    writeFileSync(join(dir, 'a.json'), text);
    writeFileSync(join(dir, 'a.json.gz'), gzipSync(text));
    writeFileSync(join(dir, 'bad.json'), tampered());
    await expect(verifyBackupFile(join(dir, 'a.json'))).resolves.toBeUndefined();
    await expect(verifyBackupFile(join(dir, 'a.json.gz'))).resolves.toBeUndefined();
    await expect(verifyBackupFile(join(dir, 'bad.json'))).rejects.toThrow('체크섬');
  });

  it('backup:end가 검증하는 임시 파일(….json.gz.tmp)도 압축 파일로 읽는다', async () => {
    writeFileSync(join(dir, 'autosave.json.gz.tmp'), gzipSync(text));
    await expect(verifyBackupFile(join(dir, 'autosave.json.gz.tmp'))).resolves.toBeUndefined();
  });

  it('scanBackupFile skips its own hash only when told the checksum was checked', async () => {
    const bad = new Blob([tampered()]);
    expect((await scanBackupFile(bad)).ok).toBe(false);
    expect((await scanBackupFile(bad, { hashChecked: true })).ok).toBe(true);
  });
});
