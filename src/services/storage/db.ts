import Dexie, { type Table } from 'dexie';
import type { AuditLog, Donation } from '../../contexts/types';
import { AUDIT_KEY_RE } from './keys';

/**
 * 암호화된 행은 enc(IV + AES-GCM 암호문)에 비밀 칸을 담고 그 칸들은 비웁니다(cipher.ts). 읽을 때는 storageService가 풀어 평문 객체로 돌려줍니다.
 * 헌금: amount·donorDisplayName·memo가 enc 안에 · 이력: reason·beforeSnapshot·afterSnapshot·actor가 enc 안에. 그 밖의 칸은 색인·키라 평문입니다.
 * 열쇠가 없던 때의 평문 행(enc 없음)도 그대로 읽힙니다(첫 암호화 이전 중·브라우저 모드).
 */
export type Sealable = { enc?: Uint8Array };

/** 이력 한 건이 한 행. year = 이력 장부의 연도('YYYY'), seq = 기록 순서(자동 증가) */
export type AuditRow = AuditLog & Sealable & { year: string; seq?: number };

/**
 * 저장소(IndexedDB) 정의.
 *  - kv: 성도·헌금 종류·설정 같은 값. 키는 값 바깥에 있습니다('' = 외부 키).
 *  - donations: 헌금 한 건이 한 행. 기본키 [날짜, id](월·연 로드는 날짜 범위 읽기), 색인은 성도·헌금 종류·[날짜+성도+종류](중복 검사).
 *  - audits(v2): 수정/삭제 이력 한 건이 한 행. 기본키는 자동 증가 번호(기록 순서), 색인은 연도.
 *    v1은 연도별 배열(kv의 audit_logs_YYYY)이라 수정할 때마다 그 해 이력 전체를 다시 썼습니다.
 */
class LedgerDB extends Dexie {
  kv!: Table<unknown, string>;
  donations!: Table<Donation & Sealable, [string, string]>;
  audits!: Table<AuditRow, number>;

  constructor() {
    super('church-offering-ledger');
    this.version(1).stores({ kv: '', donations: '[date+id], memberId, offeringTypeId, [date+memberId+offeringTypeId]' });
    // v1 → v2: 연도별 이력 배열을 행으로 옮깁니다. 업그레이드는 트랜잭션 하나라 도중에 꺼지면 v1 그대로 남습니다.
    this.version(2)
      .stores({ audits: '++seq, year' })
      .upgrade(async (tx) => {
        const kv = tx.table('kv');
        const keys = ((await kv.toCollection().primaryKeys()) as string[]).filter((k) => AUDIT_KEY_RE.test(String(k)));
        for (const k of keys) {
          const year = AUDIT_KEY_RE.exec(k)![1];
          const list = ((await kv.get(k)) as AuditLog[] | undefined) ?? [];
          if (list.length) await tx.table('audits').bulkAdd(list.map((l) => ({ ...l, year })));
          await kv.delete(k);
        }
      });
  }
}

export const db = new LedgerDB();
