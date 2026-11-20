import Dexie, { type Table } from 'dexie';
import type { AuditLog, Donation } from '../../contexts/types';
import { AUDIT_KEY_RE } from './keys';

/** 이력 한 건이 한 행. year = 이력 장부의 연도('YYYY'), seq = 기록 순서(자동 증가) */
export type AuditRow = AuditLog & { year: string; seq?: number };

/**
 * 저장소(IndexedDB) 정의.
 *  - kv: 성도·헌금 종류·설정 같은 값. 키는 값 바깥에 있습니다('' = 외부 키).
 *  - donations: 헌금 한 건이 한 행. 기본키 [날짜, id](월·연 로드는 날짜 범위 읽기), 색인은 성도·헌금 종류·[날짜+성도+종류](중복 검사).
 *  - audits(v2): 수정/삭제 이력 한 건이 한 행. 기본키는 자동 증가 번호(기록 순서), 색인은 연도.
 *    v1은 연도별 배열(kv의 audit_logs_YYYY)이라 수정할 때마다 그 해 이력 전체를 다시 썼습니다.
 */
class LedgerDB extends Dexie {
  kv!: Table<unknown, string>;
  donations!: Table<Donation, [string, string]>;
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
