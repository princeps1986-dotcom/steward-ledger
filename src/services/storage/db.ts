import Dexie, { type Table } from 'dexie';
import type { Donation } from '../../contexts/types';

/**
 * 저장소(IndexedDB) 정의.
 *  - kv: 성도·헌금 종류·설정·수정/삭제 이력(연도별) 같은 값. 키는 값 바깥에 있습니다('' = 외부 키).
 *  - donations: 헌금 한 건이 한 행. 기본키 [날짜, id](월·연 로드는 날짜 범위 읽기), 색인은 성도·헌금 종류·[날짜+성도+종류](중복 검사).
 */
export class LedgerDB extends Dexie {
  kv!: Table<unknown, string>;
  donations!: Table<Donation, [string, string]>;

  constructor() {
    super('church-offering-ledger');
    this.version(1).stores({ kv: '', donations: '[date+id], memberId, offeringTypeId, [date+memberId+offeringTypeId]' });
  }
}

export const db = new LedgerDB();
