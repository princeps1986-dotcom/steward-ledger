import type { AuditLog, Donation, Member, OfferingType } from '../../contexts/types';
import { assertNoDemo } from '../demo/demoState';
import { setRestoreProgress, withRestoring } from './backupBusy';
import { stripBirthDate } from '../domain/memberRules';
import { AUDIT_KEY_RE, auditKey, KEYS } from '../storage/keys';
import { getItem, listAuditKeys, listDonationMonths, monthWrite, strayRowWrites, transact, type Write } from '../storage/storageService';
import { planMerge, remapAudits, remapDonations, type MergePlan } from './mergeRules';
import { Sha256 } from './sha256';
import { fillReason, isAuditLike, isDonation, isMember, isOfferingType, NDJSON_PREFIX, NDJSON_VERSION } from './validation';

/**
 * 큰 백업을 파일째 메모리에 올리지 않고 줄 단위로 읽어 복원합니다(줄 단위 형식 .json/.json.gz 전용; 오래된 한 덩어리 JSON은 기존 방식).
 * 1단계(scanBackupFile): 파일 전체를 한 번 읽으며 SHA-256과 각 줄의 형식을 검증하고 연도별 건수를 셉니다. 아무것도 쓰지 않습니다.
 * 2단계(restoreFromFile): 검증된 파일을 다시 읽으며 달마다 따로 저장합니다(한 달치만 메모리에 둠).
 * 달마다 따로 저장하므로 전체가 하나의 트랜잭션은 아니며, 시작할 때 '복원 중' 표시를 남기고 끝나면 지웁니다. 중간에 꺼지면 표시가 남아
 * 다음 실행 때 알려 줍니다(같은 백업으로 다시 복원하면 됨).
 */

/** 줄 단위로 읽을 수 있는 백업 파일(브라우저 File·Blob) */
export interface ReadableBackup {
  name?: string;
  stream(): ReadableStream<Uint8Array>;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

/** 파일을 줄 단위로 읽습니다(.gz는 압축을 풂). 각 줄은 끝의 줄바꿈 문자를 포함합니다. */
export async function* readFileLines(file: ReadableBackup): AsyncGenerator<string> {
  let stream: ReadableStream<Uint8Array> = file.stream() as ReadableStream<Uint8Array>;
  if (/\.gz$/i.test(file.name ?? '')) stream = stream.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  // 줄바꿈은 새로 받은 조각에서만 찾고, 줄의 조각들은 모아 두었다가 한 번에 합칩니다
  // (한 줄이 한 달치라 수 MB여서, 받을 때마다 이어 붙인 전체에서 찾으면 압축 파일처럼 조각이 작을 때 크게 느려짐).
  let parts: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let start = 0;
      for (let nl = value.indexOf('\n'); nl >= 0; nl = value.indexOf('\n', start)) {
        parts.push(value.slice(start, nl + 1));
        yield parts.join('');
        parts = [];
        start = nl + 1;
      }
      if (start < value.length) parts.push(value.slice(start));
    }
    if (parts.length) yield parts.join('');
  } finally {
    await reader.cancel().catch(() => undefined); // 중간에 멈춰도 파일 읽기를 정리합니다.
  }
}

/** 줄 단위 형식(v3) 백업인지: 첫 줄만 읽어 확인합니다. */
export async function isNdjsonFile(file: ReadableBackup): Promise<boolean> {
  for await (const line of readFileLines(file)) return line.startsWith(NDJSON_PREFIX);
  return false;
}

export interface BackupScan {
  appVersion?: string;
  exportedAt?: string;
  members: Member[];
  offeringTypes: OfferingType[];
  /** 연도 → 헌금 건수(이력만 있는 연도는 0) */
  yearCounts: Record<string, number>;
  /** 연도 → 헌금이 있는 달 수(복원 진행 표시용) */
  monthCounts: Record<string, number>;
}

export type ScanResult = ({ ok: true } & BackupScan) | { ok: false; error: string };

const bad = (error: string): ScanResult => ({ ok: false, error });
const parse = (line: string): Record<string, unknown> | null => {
  try {
    const o: unknown = JSON.parse(line);
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** hashChecked: 체크섬을 이미 확인했으면(데스크톱 main) 다시 계산하지 않고 형식만 검사합니다. */
export async function scanBackupFile(file: ReadableBackup, opts: { hashChecked?: boolean } = {}): Promise<ScanResult> {
  const hash = new Sha256();
  const enc = new TextEncoder();
  const scan: BackupScan = { members: [], offeringTypes: [], yearCounts: {}, monthCounts: {} };
  let first = true;
  let ended = false;
  for await (const line of readFileLines(file)) {
    if (ended) return bad('백업 파일 끝 표시 뒤에 내용이 더 있습니다.');
    if (!line.endsWith('\n')) return bad('백업 파일이 끝까지 저장되지 않았습니다.');
    const o = parse(line);
    if (!o) return bad('JSON 파일을 읽을 수 없습니다.');
    if (o.t === 'end') {
      if (!opts.hashChecked && hash.digestHex() !== o.sha256) return bad('무결성 검증 실패: 파일이 손상되었거나 변조되었습니다.');
      ended = true;
      continue;
    }
    if (!opts.hashChecked) hash.update(enc.encode(line));
    if (first) {
      first = false;
      if (typeof o.ndjson !== 'number' || o.ndjson > NDJSON_VERSION) return bad('이 앱이 읽을 수 없는 백업 형식입니다. 앱을 업데이트하세요.');
      if (typeof o.appVersion === 'string') scan.appVersion = o.appVersion;
      if (typeof o.exportedAt === 'string') scan.exportedAt = o.exportedAt;
    } else if (o.t === 'members') {
      if (!Array.isArray(o.data) || !o.data.every(isMember)) return bad('성도 명단 형식이 올바르지 않습니다.');
      scan.members = stripBirthDate(o.data).members; // 옛 백업의 생년월일은 가져오지 않습니다.
    } else if (o.t === 'offeringTypes') {
      if (!Array.isArray(o.data) || !o.data.every(isOfferingType)) return bad('헌금 종류 형식이 올바르지 않습니다.');
      scan.offeringTypes = o.data;
    } else if (o.t === 'donations') {
      const ym = o.ym;
      if (typeof ym !== 'string' || !MONTH_RE.test(ym) || !Array.isArray(o.data) || !o.data.every(isDonation)) return bad(`${String(ym)} 헌금 내역 형식이 올바르지 않습니다.`);
      if (o.data.some((d: Donation) => d.date.slice(0, 7) !== ym)) return bad(`${ym} 월에 다른 달 내역이 섞여 있습니다.`);
      scan.yearCounts[ym.slice(0, 4)] = (scan.yearCounts[ym.slice(0, 4)] ?? 0) + o.data.length;
      scan.monthCounts[ym.slice(0, 4)] = (scan.monthCounts[ym.slice(0, 4)] ?? 0) + 1;
    } else if (o.t === 'audit') {
      const y = o.year;
      if (typeof y !== 'string' || !/^\d{4}$/.test(y) || !Array.isArray(o.data) || !o.data.every(isAuditLike)) return bad(`${String(y)}년 감사 로그 형식이 올바르지 않습니다.`);
      scan.yearCounts[y] ??= 0;
    }
  }
  if (first) return bad('빈 백업 파일입니다.');
  if (!ended) return bad('백업 파일이 끝까지 저장되지 않았습니다(끝 표시가 없음).');
  return { ok: true, ...scan };
}

export interface RestoreMarker {
  startedAt: string;
  years: string[];
  /** 시연 데이터 생성이 끝나지 않았을 때 'demo'(없으면 복원) */
  kind?: 'demo';
}

/** 이전 복원이 끝나지 않고 중단됐다면 그 정보, 아니면 null */
export const interruptedRestore = (): Promise<RestoreMarker | null> => getItem<RestoreMarker>(KEYS.restoreMarker);

/** 복원 전에 보여 줄 합치기 계획(현재 성도·종류와 백업의 대응) */
export async function planFor(scan: Pick<BackupScan, 'members' | 'offeringTypes'>): Promise<MergePlan> {
  const members = (await getItem<Member[]>(KEYS.members)) ?? [];
  const offeringTypes = (await getItem<OfferingType[]>(KEYS.offeringTypes)) ?? [];
  return planMerge({ members, offeringTypes }, scan);
}

/**
 * 검증을 마친 파일(scanBackupFile)에서 선택한 연도의 헌금·이력만 복원합니다(다른 연도는 그대로, 성도·헌금 종류는 합침).
 * 실패하면 '복원 중' 표시를 남긴 채 오류를 던집니다.
 */
export const restoreFromFile = (file: ReadableBackup, scan: BackupScan, years: readonly string[]): Promise<void> => withRestoring(() => restoreFromFileNow(file, scan, years));
async function restoreFromFileNow(file: ReadableBackup, scan: BackupScan, years: readonly string[]): Promise<void> {
  await assertNoDemo();
  const want = new Set(years);
  const plan = await planFor(scan);
  // 복원할 달 수(진행 표시용)는 검사(scanBackupFile) 때 센 값을 써서 파일을 따로 한 번 더 읽지 않습니다.
  const total = years.reduce((n, y) => n + (scan.monthCounts[y] ?? 0), 0);
  // 복원한 연도의 헌금 id(한 해치 id만 메모리에 둠): 본문을 저장하며 모았다가, 마지막에 다른 연도로 옮겨진 같은 내역을 지웁니다.
  const ids = new Set<string>();
  let done = 0;
  setRestoreProgress({ done, total });
  // 시작: 표시를 남기고, 선택한 연도의 기존 헌금·이력을 지우며, 백업에만 있는 성도·종류를 추가합니다(한 트랜잭션).
  await transact(async (read) => {
    const writes: Write[] = [{ key: KEYS.restoreMarker, value: { startedAt: new Date().toISOString(), years: [...years] } satisfies RestoreMarker }];
    for (const ym of await listDonationMonths()) if (want.has(ym.slice(0, 4))) writes.push(monthWrite(ym, []));
    for (const k of await listAuditKeys()) if (want.has(AUDIT_KEY_RE.exec(k)![1])) writes.push({ key: k, value: null });
    const curMembers = (await read<Member[]>(KEYS.members)) ?? [];
    const curTypes = (await read<OfferingType[]>(KEYS.offeringTypes)) ?? [];
    if (plan.addMembers.length) writes.push({ key: KEYS.members, value: [...curMembers, ...plan.addMembers] });
    if (plan.addTypes.length) writes.push({ key: KEYS.offeringTypes, value: [...curTypes, ...plan.addTypes] });
    return { writes, result: undefined };
  });
  // 본문: 달마다 따로 저장(한 달치만 메모리에 둠)
  for await (const line of readFileLines(file)) {
    const o = parse(line);
    if (!o) continue;
    if (o.t === 'donations' && typeof o.ym === 'string' && want.has(o.ym.slice(0, 4))) {
      for (const d of o.data as Donation[]) ids.add(d.id);
      const write = monthWrite(o.ym, remapDonations(o.data as Donation[], plan));
      await transact(async () => ({ writes: [write], result: undefined }));
      setRestoreProgress({ done: ++done, total });
    } else if (o.t === 'audit' && typeof o.year === 'string' && want.has(o.year)) {
      const mapped = remapAudits(fillReason(o.data as AuditLog[]), plan);
      const key = auditKey(o.year);
      if (mapped.length) await transact(async () => ({ writes: [{ key, value: mapped }], result: undefined }));
    }
  }
  // 끝: 다른 연도에 남은 같은 내역을 지우고 '복원 중' 표시를 내립니다(한 트랜잭션). 중간에 꺼지면 표시가 남아 다시 복원하게 됩니다.
  await transact(async () => ({ writes: [...(await strayRowWrites(ids, want)), { key: KEYS.restoreMarker, value: null }], result: undefined }));
}
