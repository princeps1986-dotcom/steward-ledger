// @vitest-environment node
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const dirs: string[] = [];
/** authConfig.cjs만 빈 임시 폴더에 복사해 불러옵니다(작업 폴더의 실제 로컬 값에 영향받지 않게). */
function load(local?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'authcfg-'));
  dirs.push(dir);
  copyFileSync(join(__dirname, '../../electron/authConfig.cjs'), join(dir, 'authConfig.cjs'));
  if (local !== undefined) writeFileSync(join(dir, 'authConfig.local.cjs'), local);
  return createRequire(join(dir, 'x.cjs'))('./authConfig.cjs') as { clientId: string; clientSecret: string };
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('authConfig 로컬 덮어쓰기', () => {
  it('로컬 파일이 없으면 커밋된 빈 값 그대로다', () => {
    expect(load()).toEqual({ clientId: '', clientSecret: '' });
  });
  it('로컬 파일 값이 덮어쓴다', () => {
    expect(load("module.exports = { clientId: 'id-1' };").clientId).toBe('id-1');
  });
  it('로컬 파일이 깨졌으면 조용히 넘기지 않고 오류를 낸다', () => {
    expect(() => load('throw new Error("깨짐");')).toThrow('깨짐');
  });
});
