import Dexie, { type Table } from 'dexie';

/**
 * 저장소(IndexedDB) 정의. 이름과 저장소 이름은 이전에 쓰던 localForage와 같게 둡니다(church-offering-ledger / kv).
 * 그래서 이미 입력된 데이터를 옮기지 않고 그대로 이어서 읽습니다.
 *  - 키는 값 바깥에 있고('' = 외부 키), 값은 그대로 저장됩니다(localForage의 IndexedDB 방식과 같음).
 *  - 첫 실행 때 Dexie가 데이터베이스 버전을 올리면서, localForage가 만들어 둔 빈 확인용 저장소
 *    ('local-forage-detect-blob-support')는 지워집니다. 데이터가 든 'kv'는 그대로입니다.
 * 주의: 이 버전을 한 번 연 데이터는 이전(localForage) 버전의 앱으로 다시 열 수 없습니다. 되돌리기 전에 백업 파일을 만드세요.
 */
export class LedgerDB extends Dexie {
  kv!: Table<unknown, string>;

  constructor() {
    super('church-offering-ledger');
    this.version(1).stores({ kv: '' });
  }
}

export const db = new LedgerDB();
