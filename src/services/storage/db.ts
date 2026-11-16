import Dexie, { type Table } from 'dexie';
import type { Donation } from '../../contexts/types';
import { applyPendingMigrations, moveDonationsToRows } from './schemaUpgrades';

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
  /** 행 단위 헌금 테이블(기본키 [날짜, id]). 저장·수정·삭제는 해당 행만 바꿉니다(storageService). */
  donations!: Table<Donation, [string, string]>;

  constructor() {
    super('church-offering-ledger');
    this.version(1).stores({ kv: '' });
    // 버전 2: 이전 버전에서 오는 데이터를 현재 형식으로 맞추는 1회 보정(헌금 종류·설정·직분·연도→월 키)을 화면이 뜨기 전에 실행합니다.
    this.version(2)
      .stores({ kv: '' })
      .upgrade((tx) => applyPendingMigrations(tx.table('kv')));
    // 버전 3: 행 단위 헌금 테이블만 추가(비어 있음). 데이터는 건드리지 않습니다.
    this.version(3).stores({ kv: '', donations: 'id, date, memberId, [date+memberId+offeringTypeId]' });
    // 버전 4~6: 헌금을 월 배열이 아니라 행 단위 테이블(기본키 [날짜+id])에 저장합니다. 월·연 로드가 날짜 범위 읽기라
    // 기본키를 날짜 앞세운 복합키로 두는 편이 id 키보다 2배 가까이 빠릅니다. Dexie는 기본키를 직접 못 바꿔 지웠다가 다시 만듭니다.
    this.version(4).stores({ kv: '', donations: null });
    this.version(5).stores({ kv: '', donations: '[date+id], memberId, [date+memberId+offeringTypeId]' });
    // 버전 6: 헌금 종류 색인을 더하고, 기존 월 배열 전체를 행으로 옮긴 뒤 월 배열을 지웁니다(건수가 다르면 업그레이드 전체를 취소해 아무것도 바뀌지 않음).
    this.version(6)
      .stores({ kv: '', donations: '[date+id], memberId, offeringTypeId, [date+memberId+offeringTypeId]' })
      .upgrade((tx) => moveDonationsToRows(tx.table('kv'), tx.table('donations')));
  }
}

export const db = new LedgerDB();
