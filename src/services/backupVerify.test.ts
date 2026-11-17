import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const { verifyBackupFile } = createRequire(import.meta.url)('../../electron/backupVerify.cjs') as { verifyBackupFile(file: string): Promise<void> };

const NL = String.fromCharCode(10);
const dir = mkdtempSync(join(tmpdir(), 'steward-verify-'));
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const lines = [{ ndjson: 3 }, { t: 'members', data: [{ name: '김철수' }] }, { t: 'donations', ym: '2026-01', data: [] }].map((o) => JSON.stringify(o) + NL);
const body = lines.join('');
const write = (name: string, text: string) => {
  const f = join(dir, name);
  writeFileSync(f, gzipSync(Buffer.from(text, 'utf8')));
  return f;
};

describe('verifyBackupFile', () => {
  it('accepts a complete file whose end line matches the checksum of the lines before it', async () => {
    await expect(verifyBackupFile(write('ok.gz', body + JSON.stringify({ t: 'end', sha256: sha(body) }) + NL))).resolves.toBeUndefined();
  });
  it('rejects a tampered file', async () => {
    const bad = body.replace('김철수', '김영희');
    await expect(verifyBackupFile(write('bad.gz', bad + JSON.stringify({ t: 'end', sha256: sha(body) }) + NL))).rejects.toThrow('체크섬');
  });
  it('rejects a truncated file (no end line, or cut in the middle of a line)', async () => {
    await expect(verifyBackupFile(write('noend.gz', body))).rejects.toThrow();
    await expect(verifyBackupFile(write('cut.gz', body + '{"t":"en'))).rejects.toThrow('잘렸');
  });
});
