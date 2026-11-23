// 테스트 전용: 줄 단위 백업(v3) 텍스트를 payload로 읽습니다. 앱은 이 형식을 streamRestore.ts의 scanBackupFile로 흘려 읽으므로,
// 내용을 통째로 꺼내 비교하는 해석기는 테스트에만 둡니다. 형식 검사는 앱과 같은 parseAndValidateBackup을 거칩니다.
import type { BackupPayload } from '../../contexts/types';
import { SCHEMA_VERSION } from '../../contexts/types';
import { backupLines } from './backupService';
import type { RestoreOverwrite } from './mergeRules';
import { payloadBackup, restoreFromFile, scanBackupFile, type RestoreResult } from './streamRestore';
import { computeChecksum, isObj, isStr, parseAndValidateBackup, sha256Hex, type BackupParseResult } from './validation';

/** 끝 줄의 SHA-256을 확인하고 줄을 모아 {schemaVersion, payload} 모양으로 만듭니다. 실패하면 오류 문구 */
async function parseNdjson(text: string): Promise<{ appVersion?: string; exportedAt?: string; schemaVersion: number; payload: unknown } | string> {
  const cut = text.lastIndexOf('\n{"t":"end"');
  if (cut < 0) return '백업 파일이 끝까지 저장되지 않았습니다(끝 표시가 없음).';
  let end: unknown;
  try {
    end = JSON.parse(text.slice(cut + 1));
  } catch {
    return '백업 파일이 끝까지 저장되지 않았습니다.';
  }
  if (!isObj(end) || (await sha256Hex(text.slice(0, cut + 1))) !== end.sha256) return '무결성 검증 실패: 파일이 손상되었거나 변조되었습니다.';
  let head: Record<string, unknown> | null = null;
  let members: unknown = [];
  let offeringTypes: unknown = [];
  const donationsByYear: Record<string, unknown[]> = {};
  const auditLogsByYear: Record<string, unknown> = {};
  try {
    for (const l of text.slice(0, cut).split('\n')) {
      if (!l) continue;
      const o = JSON.parse(l) as Record<string, unknown>;
      if (head === null) head = o;
      else if (o.t === 'members') members = o.data;
      else if (o.t === 'offeringTypes') offeringTypes = o.data;
      else if (o.t === 'donations' && isStr(o.ym) && Array.isArray(o.data)) (donationsByYear[o.ym.slice(0, 4)] ??= []).push(...o.data);
      else if (o.t === 'audit' && isStr(o.year)) auditLogsByYear[o.year] = o.data;
    }
  } catch {
    return 'JSON 파일을 읽을 수 없습니다.';
  }
  return {
    appVersion: isStr(head?.appVersion) ? head.appVersion : undefined,
    exportedAt: isStr(head?.exportedAt) ? head.exportedAt : undefined,
    schemaVersion: SCHEMA_VERSION,
    payload: { members, offeringTypes, donationsByYear, auditLogsByYear },
  };
}

/** 줄 단위 백업 텍스트를 앱과 같은 규칙으로 검사해 읽습니다(체크섬·잘림 확인 후 형식 검사). */
export async function parseNdjsonBackup(text: string): Promise<BackupParseResult> {
  const r = await parseNdjson(text);
  if (typeof r === 'string') return { ok: false, error: r };
  return parseAndValidateBackup(JSON.stringify({ ...r, checksum: await computeChecksum(r.payload) }));
}

/** 지금 저장소의 내용을 실제 백업과 같은 길(backupLines)로 만들어 payload로 돌려줍니다. */
export async function payloadNow(years?: readonly string[]): Promise<BackupPayload> {
  let body = '';
  for await (const l of backupLines({ years })) body += l;
  const res = await parseNdjsonBackup(`${body}${JSON.stringify({ t: 'end', sha256: await sha256Hex(body) })}\n`);
  if (!res.ok) throw new Error(res.error);
  return res.envelope.payload;
}

/** 예전 한 덩어리 JSON 내용을 앱과 같은 길(payloadBackup → scanBackupFile → restoreFromFile)로 복원합니다. full이면 전체 교체 */
export async function restorePayload(payload: BackupPayload, years: readonly string[], opts: { full?: boolean; overwrite?: RestoreOverwrite } = {}): Promise<RestoreResult> {
  const source = payloadBackup({ appVersion: 'test', exportedAt: new Date().toISOString(), payload });
  const scan = await scanBackupFile(source, { hashChecked: true });
  if (!scan.ok) throw new Error(scan.error);
  return restoreFromFile(source, scan, years, opts.overwrite, opts.full);
}
