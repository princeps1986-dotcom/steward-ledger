// 로그인 직후 저장 데이터를 열 준비: 데이터 열쇠를 받아 저장소에 넣고, 평문으로 남은 데이터가 있으면 백업 뒤 건별 암호화로 옮깁니다.
// 이 일이 끝나기 전에는 앱 화면과 저장소를 그리지 않습니다(AuthGate).
import { backupLines, hasAnyData } from '../backup/backupService';
import type { DesktopApi } from '../desktopBridge';
import { can, type Role } from './roles';
import { keyFromBase64, setDataKey } from '../storage/cipher';
import { dataKeyOpensStorage, encryptAllPlaintext, encryptionPending, storageHasRows, wipeAllStorage } from '../storage/storageService';

/** keyLost: 열쇠를 풀 수 없는데 저장소에 데이터가 있어 자동으로 새로 시작할 수 없음(사용자가 새로 시작을 고르거나 수동 백업 복원) */
export type PrepareOutcome = { ok: true } | { ok: false; keyLost: boolean; error: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const KEY_MISMATCH = '데이터 열쇠가 저장된 데이터와 맞지 않습니다(열쇠 파일이 지워졌거나 바뀌었습니다). 수동 백업 파일이 있으면 새로 시작한 뒤 복원하세요.';

/** 이 열쇠로 저장된 데이터가 풀리는지 확인하고, 맞으면 열쇠를 넣어 둔 채 true */
async function tryDataKey(b64: string): Promise<boolean> {
  await setDataKey(keyFromBase64(b64));
  if (await dataKeyOpensStorage()) return true;
  await setDataKey(null);
  return false;
}

/** 암호화로 옮기기 전에 지금(평문) 데이터를 이 PC의 키로 자동 백업합니다. 실패하면 옮기지 않고 오류로 알립니다. */
async function backupBeforeEncrypt(api: DesktopApi): Promise<void> {
  if (!(await hasAnyData())) return;
  const id = await api.backupBegin({ kind: 'close' });
  if (id === null) return;
  try {
    for await (const line of backupLines()) await api.backupWrite(id, line);
    await api.backupEnd(id);
  } catch (e) {
    await api.backupAbort(id).catch(() => undefined);
    throw new Error(`암호화하기 전 백업에 실패했습니다: ${messageOf(e)}`);
  }
}

export async function prepareData(api: DesktopApi, onProgress?: (done: number, total: number) => void): Promise<PrepareOutcome> {
  try {
    let r = await api.dataKey();
    if ('error' in r) {
      if (r.code !== 'DATA_KEY_UNREADABLE') return { ok: false, keyLost: false, error: r.error };
      // 새 열쇠를 만들면 기존 데이터를 영구히 열 수 없으므로, 저장소가 비어 있을 때만 자동으로 새로 만듭니다.
      if (await storageHasRows()) return { ok: false, keyLost: true, error: r.error };
      r = await api.dataKeyReplace();
      if ('error' in r) return { ok: false, keyLost: false, error: r.error };
    }
    // 열쇠 파일을 잃어 main이 새 열쇠를 만들었으면 열쇠는 읽혀도 데이터가 풀리지 않습니다: 그대로 열면 새 입력이 다른 열쇠로 섞이므로 막습니다.
    if (!(await tryDataKey(r.key))) return { ok: false, keyLost: true, error: KEY_MISMATCH };
    if (await encryptionPending()) {
      await backupBeforeEncrypt(api);
      await encryptAllPlaintext(onProgress);
    }
    return { ok: true };
  } catch (e) {
    await setDataKey(null);
    return { ok: false, keyLost: false, error: messageOf(e) };
  }
}

// 새 열쇠를 만든 뒤 데이터 삭제가 실패했을 때(이제 열쇠는 멀쩡해 보임) 다시 시도하면 삭제부터 이어 가게 하는 표시
let wipePending = false;

/**
 * 열쇠를 잃어 풀 수 없는 데이터를 모두 지우고 새로 시작합니다(수동 백업이 있어야 되살릴 수 있음). 호출 전에 사용자 확인이 필요합니다.
 * 관리자(data:reset)만 할 수 있고, 열쇠가 풀리지 않거나 데이터와 맞지 않을 때만 진행하며(풀리지 않으면 main이 새 열쇠를 만든 것을 확인한 뒤) 데이터를 지웁니다.
 */
export async function startOver(api: DesktopApi, role: Role | null | undefined, onProgress?: (done: number, total: number) => void): Promise<PrepareOutcome> {
  const refuse = (error: string): PrepareOutcome => ({ ok: false, keyLost: true, error });
  if (!can(role, 'data:reset')) return refuse('모든 데이터를 지우는 일은 관리자만 할 수 있습니다.');
  try {
    if (!wipePending) {
      const cur = await api.dataKey();
      if (!('error' in cur)) {
        // 열쇠는 읽히지만 데이터와 맞지 않으면(열쇠 파일을 잃음) 그 열쇠로 새로 시작합니다. 맞으면 지우지 않습니다.
        const opens = await tryDataKey(cur.key);
        await setDataKey(null);
        if (opens) return refuse('데이터 열쇠가 정상이라 지우지 않습니다. 앱을 다시 시작해 보세요.');
      } else {
        if (cur.code !== 'DATA_KEY_UNREADABLE') return refuse('데이터 열쇠가 정상이라 지우지 않습니다. 앱을 다시 시작해 보세요.');
        const rep = await api.dataKeyReplace();
        if ('error' in rep) return refuse(rep.error);
      }
      wipePending = true;
    }
    await wipeAllStorage();
    wipePending = false;
  } catch (e) {
    return refuse(messageOf(e));
  }
  return prepareData(api, onProgress);
}
