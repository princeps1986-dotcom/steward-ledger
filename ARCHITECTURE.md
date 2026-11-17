# 청지기 장부 — 아키텍처 명세서 v1.0

> 오프라인 우선 교회 헌금 회계 데스크톱 앱의 **구조와 설계 결정**을 설명합니다.
> 무엇을 만드는지는 [PRD.md](PRD.md), 사용법은 앱 안의 [사용 설명서]를 보세요.

## 목차
1. [한눈에 보기](#1-한눈에-보기)
2. [설계 원칙](#2-설계-원칙)
3. [기술 스택](#3-기술-스택)
4. [코드 구조](#4-코드-구조)
5. [데이터 모델](#5-데이터-모델)
6. [저장소 설계](#6-저장소-설계)
7. [화면 데이터 관리 (DonationContext)](#7-화면-데이터-관리-donationcontext)
8. [보고서](#8-보고서)
9. [엑셀](#9-엑셀)
10. [백업 · 복원 · 초기화](#10-백업--복원--초기화)
11. [입력 화면 설계](#11-입력-화면-설계)
12. [인쇄, 테마, 달력](#12-인쇄-테마-달력)
13. [Electron 셸](#13-electron-셸)
14. [저장소 버전](#14-저장소-버전)
15. [성능 측정과 설계 근거](#15-성능-측정과-설계-근거)
16. [테스트](#16-테스트)
17. [알려진 한계](#17-알려진-한계)
18. [빌드 · 실행 · 배포](#18-빌드--실행--배포)

---

## 1. 한눈에 보기

```text
┌─────────────── Electron (main.cjs, preload.cjs) ───────────────┐
│  단일 인스턴스 잠금 · CSP · 자동 백업 파일 쓰기 · 파일 열기      │
│  ┌────────────────── 렌더러 (React 19 + Vite) ──────────────┐  │
│  │ components (보기만)  ←  hooks (화면 로직)                  │  │
│  │                         ↓                                  │  │
│  │ contexts (상태)  →  services (규칙·저장·엑셀·백업)          │  │
│  │                         ↓                                  │  │
│  │ Dexie → IndexedDB (이 PC 안에만 저장)                       │  │
│  └────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

서버·네트워크가 없습니다. 모든 데이터는 렌더러의 IndexedDB에 있고, 같은 코드가 일반 브라우저(시연용 GitHub Pages, 개발용)에서도 그대로 동작합니다.

## 2. 설계 원칙

1. **오프라인 우선:** 외부 API·서버 없이 로컬에서 즉시 영구 저장.
2. **로직과 보기의 분리:** `components/`의 `.tsx`에는 비즈니스 로직이 없고 값과 이벤트 핸들러를 연결만 합니다. 판단·상태는 `hooks/`, 규칙은 `services/domain/`(순수 함수, 단위 테스트 대상).
3. **필요한 곳만 다시 그리기:** `use-context-selector`로 값이 바뀐 조각을 구독하는 컴포넌트만 렌더링합니다.
4. **전부 아니면 전무:** 여러 키를 바꾸는 작업은 IndexedDB 트랜잭션(Dexie) 하나로 원자적으로 처리합니다.
5. **회계 정합성:** 모든 수정·삭제는 이력(AuditLog)에 남고, 납부 당시 세대 정보(스냅샷)를 보존합니다.
6. **보안:** `script-src 'self'` CSP, XSS·엑셀 수식 인젝션 방어. 단 가상 스크롤 좌표·인쇄 레이아웃을 위한 제한적 인라인 스타일(`style={{…}}`)은 허용합니다.
7. **라이선스:** 상업적 이용이 자유로운 MIT 계열 패키지만 사용합니다.
8. **연타·경합에 안전:** 사용자의 반복 입력과 비동기 읽기·쓰기 겹침에도 중복 실행·옛 값 덮어쓰기가 없어야 합니다(7장, 11장).

## 3. 기술 스택

| 분류 | 사용 | 이유 |
| :--- | :--- | :--- |
| 기반 | React 19 + TypeScript + Vite | 정적 타입, 빠른 빌드 |
| 저장 | Dexie (IndexedDB) | 트랜잭션, 범위 조회, 행 단위 저장·색인 |
| 상태 | use-context-selector | 전역 리렌더링 방지 |
| 스타일 | Tailwind CSS 4 + Radix UI(Dialog·Switch·Tabs) | 접근성 있는 헤드리스 컴포넌트 |
| 가상 스크롤 | @tanstack/react-virtual | 수천 행에서도 보이는 행만 그림 |
| 엑셀 | exceljs | 브라우저에서 `.xlsx` 생성(수식 + 캐시 값) |
| CSV | papaparse | 명단 가져오기 (CP949는 `TextDecoder('euc-kr')`) |
| 날짜·유틸 | date-fns, lodash-es | 날짜 계산, 그룹화 |
| 달력 | 자체 `DatePicker` | 브라우저 기본 달력은 일요일을 빨갛게 칠할 수 없음 |
| 데스크톱 | Electron 45 + electron-builder(NSIS) | Windows 설치 파일 |
| 테스트 | Vitest, fake-indexeddb, jsdom, @testing-library/react | 저장소·화면 상태까지 자동 검증 |

## 4. 코드 구조

```text
src/
├── main.tsx            시작: 저장소 열기 → 화면 렌더 (실패 시 오류 안내)
├── App.tsx             메뉴, 페이지 전환
├── contexts/           [상태] 데이터 보관과 변경
│   ├── DonationContext.tsx   헌금: 달 단위 메모리 모델, 저장·수정·삭제·되돌리기
│   ├── MemberContext.tsx / OfferingTypeContext.tsx / SettingsContext.tsx
│   ├── AppProviders.tsx      위 컨텍스트를 한 번에 묶음
│   └── types.ts              데이터 모델·앱 버전·스키마 버전
├── hooks/              [화면 로직] useDonationInput, useReports, useSettingsPage,
│                       useMemberForm, exclusive(연타 방지) …
├── services/
│   ├── domain/         [순수 규칙] 금액·검색·세대·집계·월 캐시 …
│   ├── storage/        db(Dexie 정의)·storageService(트랜잭션·월 키), tabSyncChannel(창 간 동기화)
│   ├── backup/         backupService, mergeRules, validation(체크섬·버전 변환), autoBackupService
│   ├── excel/          excelService, downloadBridge
│   ├── import/         memberImportService (CSV·xlsx 명단)
│   ├── demo/           demoData (시연 데이터)
│   └── theme.ts, desktopBridge.ts
└── components/
    ├── shared/         DatePicker, Modal, Notice, InfoTip, ThemePicker, MemberFormFields …
    └── pages/          donation-input · reports · members · offerings · settings · help
electron/               main.cjs, preload.cjs
scripts/                testdata-core.mjs(생성 규칙), generate-test-data.mjs(파일 생성)
.github/workflows/      pages.yml (시연 페이지 자동 배포)
```

`pages/help`의 `helpContent.ts`는 사용 설명서의 정적 데이터이며, **기능이 바뀌면 이 파일도 함께 고칩니다.**

## 5. 데이터 모델

`src/contexts/types.ts`

```typescript
interface Member {            // 성도
  id: string; name: string;
  position: string;           // 직분. 빈 값 = 없음 ('성도'는 직분이 아님)
  birthDate?: string;         // YYYY-MM-DD
  phoneLast4?: string;        // 동명이인 구분
  familyGroupId?: string;     // 세대 그룹 = 최초 세대주의 id (세대주가 바뀌어도 유지)
  isFamilyHead: boolean;
  isActive: boolean;          // false = 비활성화(과거 통계 보존)
  createdAt: string; updatedAt: string;
}

interface OfferingType {      // 헌금 종류
  id: string; name: string;
  displayArea: 'PRIMARY' | 'DROPDOWN';   // 기본 나열 / 기타 선택
  quickAmounts: number[];                // 자주 쓰는 금액 단추
  sortOrder: number; isActive: boolean;
}

interface Donation {          // 헌금 1건 (종류별 1건)
  id: string;
  date: string;               // YYYY-MM-DD — 저장 위치(달)를 정하는 기준
  memberId: string | null;    // 무명·방문자는 null
  donorDisplayName: string;   // '김철수', '무명1', '방문자-홍길동'
  familyGroupIdSnapshot?: string | null;  // 입력 당시 세대 (연말정산 이력 보존)
  offeringTypeId: string; amount: number; // 원 단위 정수
  memo?: string; createdAt: string;
}

interface AuditLog {          // 수정·삭제 이력
  id: string; targetId: string;
  action: 'UPDATE' | 'DELETE';
  beforeSnapshot: Donation; afterSnapshot: Donation | null;
  reason: string;             // 필수(합산·되돌리기는 자동 기입)
  timestamp: string;
}

interface BackupEnvelope {    // 백업 파일
  appVersion: string;         // 현재 "1.1.0"
  schemaVersion: number;      // 현재 2
  exportedAt: string;
  checksum: string;           // payload의 SHA-256
  payload: { members; offeringTypes;
             donationsByYear: Record<'YYYY', Donation[]>;
             auditLogsByYear: Record<'YYYY', AuditLog[]> };
}
```

* 한 번의 저장(봉투)은 종류마다 독립된 `Donation`을 만듭니다(묶음 ID 없음). 같은 날짜·성도·종류의 중복 감지도 기록 단위입니다.
* 세대 그룹은 별도 엔티티 없이 세대주의 `Member.id`를 그룹 ID로 씁니다. 세대주 변경은 `isFamilyHead`만 옮기고, 분가·이동해도 과거 기록은 스냅샷 덕분에 영향이 없습니다.
* **백업 파일 형식(`schemaVersion` 2)은 저장 방식이 바뀌어도 그대로**입니다. 연도별 `donationsByYear`로 담고 읽을 때 월 키로 나눕니다.

## 6. 저장소 설계

`services/storage/storageService.ts`

### 6.1 키 구성
| 키 | 내용 |
| :--- | :--- |
| `members`, `offering_types`, `settings` | 성도 / 헌금 종류 / 설정 |
| (테이블 `donations`) | **한 건이 한 행**인 헌금. 기본키 `[date, id]`, 색인 `memberId`·`offeringTypeId`·`[date+memberId+offeringTypeId]`. 쓰기 목록(`Write`)의 `donations_YYYY-MM` 키는 '그 달의 행이 바뀐다'는 표시일 뿐 값은 저장되지 않음 |
| `audit_logs_YYYY` | 연도 단위 수정·삭제 이력 |
| `meta_dirty_since_backup` | 마지막 백업 이후 데이터가 바뀌었는지(백업 대상 아님) |

한 건을 저장·수정·삭제하면 **그 행만** 씁니다(`rowWrite`; 날짜가 바뀌면 이전 행을 지우고 새 행을 만듦). 달 전체 교체(`monthWrite`)는 백업 복원에서만 씁니다. 월 1.2만 건에서 저장이 월 배열 방식 약 35ms → 0.6ms입니다(fake-indexeddb 측정).

### 6.2 원자적 트랜잭션 (`transact`)
1. IndexedDB 쓰기 트랜잭션 하나를 연다(`db.transaction('rw', db.kv, …)`).
2. 그 안에서 읽기 함수로 값을 읽어 **쓸 목록(writes)을 계산**한다.
3. 쓸 목록(같은 키는 마지막 쓰기만)을 `bulkPut`·`bulkDelete`로 한 번에 쓴다. 데이터 키가 바뀌면 '마지막 백업 이후 변경' 표시도 같은 트랜잭션에 쓴다.
4. 커밋되면 다른 창에 바뀐 키를 알린다.

도중에 오류가 나거나 앱이 멈추면 **트랜잭션 전체가 취소**되어 아무것도 바뀌지 않습니다(행 테이블과 `kv`의 쓰기가 한 트랜잭션입니다).

주의: `build` 안에서는 `read`와 `storageService`의 읽기 함수(`getItem`·`getMany`·`listKeys`·`readMonth`·`readRow` 등)만 기다려야 합니다. 그 밖의 비동기 작업(`fetch`, 해시 계산 등)을 기다리면 IndexedDB 트랜잭션이 먼저 끝나 버립니다.

**저장소 구조(버전 1):** 데이터베이스 `church-offering-ledger`에 `kv`(성도·헌금 종류·설정·연도별 이력·백업 표시)와 `donations`(헌금 한 건이 한 행)가 있습니다. 헌금의 기본키는 `[date, id]`라 월·연 로드가 날짜 범위 읽기이고(월 1.2만 건에서 약 43ms), 색인 `memberId`·`offeringTypeId`·`[date+memberId+offeringTypeId]`로 중복 검사(약 0.1ms)와 헌금 종류 사용 수를 셉니다. 한 달 안의 표시 순서는 입력 시각(`createdAt`) 순입니다. 아직 실제 사용 데이터가 없는 개발 단계라 이전 형식(localForage·월 배열)에서 옮기는 코드는 두지 않았습니다.

### 6.3 연도 경계 수정
날짜를 고쳐 월·연도가 바뀌면 한 트랜잭션에서 ① 이전 달에서 제거 ② 새 달에 삽입 ③ 새 연도 이력에 기록합니다.

## 7. 화면 데이터 관리 (DonationContext)

### 7.1 달 단위 메모리 모델
* 상태: `months: Record<'YYYY-MM', Donation[]>`, `epoch`(전체 다시 읽기 때 +1), `audits`, `years`, `history`(최근 저장 10건, 메모리 전용).
* **저장 시 그 달 배열만 교체**하고 다른 달 배열은 같은 객체를 유지합니다. 이를 소비하는 훅(`useDonationMonths`)은 달 배열이 바뀌지 않으면 같은 결과 배열을 돌려주므로 다른 달에 저장해도 집계가 다시 계산되지 않습니다.
* 화면은 필요한 달만 불러옵니다: 주별 1~2달, 월별 1달, 분기 3달, 연도 12달, 입력 화면은 선택일의 달.

### 7.2 연도 해제
화면이 쓰는 연도는 `pinMonths`로 “사용 중” 표시하고, `evictOldYears`가 순수 함수 `yearsToEvict`로 **메모리에 올린 내역을 합쳐 50만 건(약 150MB) 이하**로 유지합니다(연도 수가 아니라 건수 기준이며 마지막 사용이 오래된 연도부터 해제). 화면이 연도를 놓을 때(예: 보고서에서 입력 화면으로 이동)는 예산을 10만 건으로 낮춰 큰 연도를 바로 내립니다. 한 연도의 달은 동시에 읽지 않고 한 달씩 차례로 읽되 화면에는 한 번에 반영하며(달마다 반영하면 보고서가 그때마다 다시 집계됨; 연 26만 건 실측: 로딩 3.6초·화면 갱신 13회 → 2.3초·3회), 일시적인 최대 메모리를 낮추며, `readMonth`는 같은 값의 문자열(성도 번호·종류·날짜·표기명)을 하나로 합쳐 행당 메모리를 줄입니다(시험 데이터 기준 314B → 184B). 사용 중이거나 읽는 중인 연도는 내리지 않으며, 요청한 연도는 가장 최근 사용으로 칩니다. 필요하면 다시 읽습니다.

### 7.3 경합 방어
| 상황 | 방어 |
| :--- | :--- |
| 달을 읽는 도중 저장이 커밋됨 | `staleMonths`로 표시하고 다시 읽는다 |
| 읽는 도중 복원·초기화(`reloadAll`) | `generation`이 바뀌면 읽은 결과를 버린다 |
| 읽기 실패 | `finally`에서 “읽는 중” 표시를 지워 다음에 다시 시도한다 |
| 연도 목록을 여러 번 새로 읽음 | `refreshYears` 토큰으로 마지막 요청만 반영한다 |
| 저장 후 [수정]으로 달이 바뀐 내역을 되돌리기 | 저장한 달을 먼저 읽고, 못 찾은 내역만 나머지 달에서 찾는다 |

### 7.4 연타 방지
React 상태(`saving`)는 다음 렌더 뒤에야 바뀌어 연타를 막지 못합니다. `hooks/exclusive.ts`의 `createExclusive(ref)`가 **진행 중에 들어온 호출을 즉시 무시**하고 끝나면(실패해도) 풀립니다. 헌금 저장(Enter·Ctrl+Enter·[저장]·큰 금액/중복 확인창)과 되돌리기, 성도 등록·수정 폼에 적용합니다.

## 8. 보고서

### 8.1 선택과 계산의 분리 (250ms 지연)
`useReportFilters`는 **선택 값**(`f.sel`: 연도·기간·분기/월·주)과 **적용 값**(`f.year`, `f.periodType`, `f.periodValue`, `f.week`)을 나눕니다. 적용 값은 `useDebouncedValue`로 선택이 250ms(`REPORT_DELAY_MS`) 멈춘 뒤에 바뀝니다. 이 사이(`f.pending`)에는 “불러오는 중…” 표시와 본문 흐림, 인쇄·엑셀 단추 비활성으로 **화면과 다른 기간이 저장되는 일을 막습니다.** [이전/다음 주]는 ref(`latestWeek`)로 최신 선택에서 이어 가므로 연타해도 누른 만큼 이동합니다. 연타 중에는 중간 보고서를 계산하지 않습니다(30번 연타 → 계산 1회).

### 8.2 종류별 표
| 기간 | 표 | 집계 |
| :--- | :--- | :--- |
| 주별 | 성도명 × 종류 | `buildWeeklyMatrix` |
| 월별 | 성도명 × 종류 | 같은 함수를 `personRange`(그 달 1일~말일)로 재사용 → 주별 합과 일치 |
| 분기·연도 | 종류 × 월 + 세대별 집계 | `useSummaryReport` |

* `ReportFilters.personKind('WEEK'|'MONTH'|null)`/`personRange`로 화면·엑셀이 같은 코드를 씁니다.
* 열 = 활성 종류 + 기간에 쓰인 비활성 종류(`sortOrder` 순) + 장부에만 있는 종류(`(삭제된 종류)`, 합계 일치 보장). 행 키는 `memberId`(동명이인 분리) 또는 `anon:표기명`(같은 무명 합산).
* 정렬: 이름 → 연락처 뒷4자리(없으면 뒤) → 직분 순위 → id, 이어서 무명(번호 숫자순). 화면과 엑셀이 같은 `useMemberOrderKey()`를 씁니다.
* **[표시할 헌금 종류]:** `ReportsPage`가 뒤집은 종류(`flippedIds`)만 기억하고(기본은 활성=표시) `withoutTypes`로 내역·열을 걸러 화면·인쇄·엑셀이 같은 결과를 냅니다. 보고서·탭이 바뀌면 비웁니다.
* **세대 집계 기준**(현재/납부 당시)은 분기·연도 요약과 개인별·세대별 탭에만 쓰이며, 주별·월별 종합 보고서에서는 숨깁니다.
* 탭은 `reportKey`(주별은 주 시작일, 그 외 `기간:연도:값`)가 바뀌면 [종합 보고서]로 돌아갑니다.

### 8.3 큰 표의 속도
* **가상 스크롤:** `WeeklySummary`는 `useVirtualizer`로 보이는 행만 `<tbody>`에 그리고 위·아래를 높이만 가진 빈 행(`padTop/padBottom`)으로 채웁니다. 실제 행 높이는 `measureElement`로 재어 글자 크기 125%에서도 행이 가려지지 않으며, 합계 행은 `sticky bottom-0`로 유지됩니다. `useIsPrinting`이 `beforeprint`에서 켜지면 가상화를 끄고 **모든 행**을 그립니다.
* **전체 입력 내역:** 기간의 헌금을 메모리에 올리지 않고 달 단위로 읽습니다(`ListPager`, `useReportFilters(false)`로 이 탭에서는 기간 로딩을 끔). 달마다 건수·합계만 구해 두고, 화면에 보이는 행의 달만 읽으며, 합쳐서 5만 건까지는 행을 그대로 들고 있습니다(작은 기간은 한 번만 읽고 인쇄도 전체가 나옴). 5만 건을 넘는 기간은 인쇄에 일부만 담긴다는 안내가 나옵니다. 달이 바뀌었는지는 컨텍스트의 `monthVersions`(메모리에 올리지 않은 달 포함)로 알아 바뀐 달만 다시 읽습니다. 정렬은 ISO 날짜 문자열 직접 비교입니다. 측정(Chromium, 9.6만 건): 건수·합계 약 1초, JS 힙 41~45MB. 이름 검색은 부분 일치만 지원하며 초성 검색은 없습니다.
* **메뉴 이동:** 첫 화면이 뜬 직후 다른 화면의 코드를 미리 불러와(`App.tsx`) 처음 열 때 기다리지 않습니다.
* **스크롤 영역 높이:** `useFitHeight`가 영역 위치부터 화면 아래까지 남은 높이(최소 240px)를 `--fit-h`로 정해, 위쪽 내용이 길어도 고정 합계 행이 항상 화면 안에 있습니다.
* **고정 셀:** 합계 행은 `sticky bottom-0`, 머리글 `top-0`, 번호·성도명 열 `left-0/left-10`. `border-collapse` 때문에 사라지는 윗선은 그림자(`shadow`)로 대신 그립니다.

### 8.4 수정·삭제 이력 범위
(헌금 수정창 `useDonationEditor`는 날짜·종류·금액·메모만 바꾸며 `memberId`·`donorDisplayName`·세대 스냅샷은 원본을 그대로 유지합니다. 날짜 칸은 `DatePicker`의 `pickOnly`라 달력으로만 고르고, 성도·표기명은 읽기 전용 칸(`donorLabel`)으로만 보여 줍니다. 종류 선택 목록(`typeOptions`)은 활성 종류만이며, 현재 종류가 비활성이면 `disabled` 옵션으로만 함께 보여 줍니다.)

`auditLogsForPeriod`가 변경 전·후 날짜 중 하나라도 기간에 속하면 포함합니다(연도를 옮긴 수정은 두 보고서 모두에 나옴). 이력은 새 연도의 장부에 기록되므로 모든 연도의 이력을 불러온 뒤 거릅니다.

### 8.5 동명이인 표기
`duplicateNames`(비활성 포함)와 `nameDisambiguator`(연락처 뒷4자리 → 직분)가 구분 값을 만들고 `useNameTag`가 화면에 붙입니다. 엑셀에는 넣지 않습니다(이름 열을 집계 키로 쓰기 때문).

## 9. 엑셀

`services/excel/excelService.ts`

* **파일:** 주별 `buildWeeklyWorkbook`(교차표 + 주간 상세), 월별 `buildWeeklyWorkbook({kind:'MONTH'})`(교차표 1개), 분기·연도 `buildReportWorkbook`(`종합결산요약` + `세대별_기부금집계`). 연·분기·월에는 **개별 내역 시트가 없습니다.**
* **수식 + 캐시 값:** 합계는 `SUM` 수식에 JavaScript로 계산한 `result`를 함께 넣어 한셀·구버전 뷰어에서도 0으로 보이지 않게 합니다. 본문 금액은 값입니다(행 키가 `memberId`라 같은 이름의 동명이인을 이름 기준 `SUMIFS`로 합치면 오집계되기 때문).
* **한 번만 훑기:** 종류×월·세대×종류 합계를 한 번에 Map으로 모은 뒤 값으로 기록합니다. 셀마다 전체를 훑던 방식은 18만 건에서 65초였고 지금은 0.4초입니다.
* **수식 인젝션 방어:** 텍스트가 `= + - @ \t \r`로 시작하면 앞에 `'`를 붙입니다(`sanitizeCellText`).
* **열 너비:** `fitNameColumn`이 이름 데이터만으로 폭을 정합니다(한글 2칸, 여유 6칸, 최소 18·최대 60).
* **파일명 보호:** OS 금지 문자 `\ / : * ? " < > |`를 `_`로 바꾼 뒤 UTF-8 Blob으로 내려받습니다(`downloadBridge`).
* [PDF 저장]은 데스크톱 앱에서 `report:save-pdf`(main의 `printToPDF`, `@page` 크기 사용)로 저장 창을 거쳐 저장하고, 웹은 `window.print()`로 대신합니다. 인쇄 전용 렌더링(`useIsPrinting`)을 위해 호출 전후에 `beforeprint`/`afterprint`를 직접 보냅니다.
* 데스크톱 앱에서는 저장 완료(`download:done`) 시 `showInFolder`로 저장 폴더를 자동으로 열고 [파일 열기]/[폴더 열기]도 보여 줍니다. `recipientEmail` 설정 필드는 저장 데이터 호환을 위해 남겨 두고 화면에서는 쓰지 않습니다.

## 10. 백업 · 복원 · 초기화

`services/backup/`

| 기능 | 함수 | 설명 |
| :--- | :--- | :--- |
| 만들기 | `collectPayload(years?)`, `createBackupJson`, `downloadBackup(prefix, years?)` | 선택 연도의 월 키를 연도별로 합쳐 담고 체크섬을 붙인다. 성도·종류는 항상 전부. |
| 검사 | `validation.parseAndValidateBackup` | SHA-256 체크섬과 형식 검증, 이전 스키마(v1→v2) 자동 변환 |
| 복원 | `restoreBackup(payload, {years, mode})` | 화면은 `mode: 'YEARS'`, 연도 하나 |
| 전체 교체 | `replaceAllData(payload)` | 시연 데이터·초기화용(단일 트랜잭션, 큰 데이터에는 한도 있음) |
| 초기화 | `resetAllData()` | 빈 성도·내역·이력 + 새 id의 기본 헌금 종류로 교체(설정 유지) |
| 자동 백업 | `autoBackupService` | 종료 시 변경이 있으면 전체 백업을 **줄 단위 JSON(v3, `ndjson`)**으로 만들어 저장, 최근 10개 보관. 렌더러가 `backupLines()`로 한 달치씩 만들어 `autoBackupWrite`로 보내면 main이 SHA-256을 이어 계산하며 gzip(`backup_….json.gz`)으로 바로 쓰고 마지막 줄에 해시를 붙임(메모리가 데이터 크기와 무관). 복원 화면은 `DecompressionStream`으로 `.gz`를 읽고 `parseNdjson`이 끝 줄 해시를 확인. 수동·긴급 백업은 기존 v2 JSON |

### 10.1 연도 복원(YEARS)과 다른 PC 백업 병합
한 트랜잭션에서 ① 선택 연도의 기존 월 키·이력 키를 지우고 ② 백업 내용을 월별로 쓰고 ③ 성도·종류를 **현재 데이터와 대응**시킵니다. 대응 규칙(`mergeRules.planMerge`)은 다음과 같습니다.

| 대상 | 같은 것으로 보는 조건 | 아닐 때 |
| :--- | :--- | :--- |
| 헌금 종류 | id 같음 또는 **이름 같음** | 새 종류로 추가 |
| 성도 | id 같음 또는 **이름 + 연락처 뒷4자리 같음** | 새 성도로 추가 (이름만 같으면 동명이인일 수 있어 합치지 않음) |

대응된 백업 id는 `remapDonations`/`remapAudits`로 **현재 id로 바꿔** 헌금·이력(스냅샷 포함)에 쓰므로 중복 없이 올바른 성도·종류에 연결됩니다. 새로 추가되는 성도의 세대 그룹이 대응된 성도를 가리키면 현재 id로 바꿉니다. `previewMerge`가 복원 창에 연결·추가·동명이인 가능 수를 미리 보여 줍니다.

### 10.2 원칙
* 복원·초기화·시연 데이터 교체 전에는 **항상 긴급 백업**(`emergency_before_*`)을 백업 폴더에 먼저 저장합니다(데스크톱 앱은 대화상자 없이 저장하고 실패하면 중단)(시연 데이터는 기존 데이터가 있을 때만).
* 복원은 화면에서 연도 하나씩 고르는 방식을 유지합니다. Dexie 트랜잭션에서는 값이 키마다 따로라 그 한도 문제는 없습니다.
* 연도 하나 백업이 저장소 전체와 같을 때만 “마지막 백업” 기록을 갱신합니다(`isCompleteYearBackup`).
* 설정은 백업에 포함되지 않으므로 복원해도 그대로 유지됩니다.
* **주기 백업:** 종료 때만 백업하면 비정상 종료 시 그날 입력분을 잃을 수 있어, 앱을 쓰는 동안 변경이 있으면 10분마다 조용히 백업합니다(`runPeriodicBackup`). 데이터는 읽기 트랜잭션 하나로 붙잡지 않고 달마다 짧게 나누어 읽고 바로 파일로 흘려 보냅니다(`streamBackup`; 메모리는 한 달치): 한 트랜잭션으로 읽으면 5년 130만 건에서 읽는 동안(약 8초) 저장이 기다려 입력이 멈췄습니다(측정: 저장 6.6초 지연 → 나눠 읽으면 중앙값 110ms, 최대 163ms). 대신 읽는 도중 내역이 달을 넘어 옮겨졌거나 복원이 있었다면(`structuralCommitCount`가 바뀜) 중복·누락이 생길 수 있어 다시 읽고(최대 3번), 같은 달 안의 추가·수정·삭제는 어느 시점에 읽어도 일관되므로 그대로 둡니다. '변경 표시'는 읽기 전에 먼저 내려 백업 중 생긴 변경이 다음 백업에 담기게 하고, 실패하면 되돌립니다. 파일은 `autosave_*`로 종료 때 백업(`backup_*`)과 따로 최근 3개만 보관합니다.
* **백업 검증:** main이 자동 백업 파일을 쓴 뒤 다시 읽어 끝 줄의 SHA-256을 확인하고(`verifyBackupFile`), 맞을 때만 이름을 바꿔 확정합니다. 실패하면 임시 파일을 지우고 오류로 알립니다(이미 있는 좋은 백업은 그대로).
* **백업 세션 번호:** 주기·종료·직접·긴급 백업이 겹쳐도 줄이 섞이지 않도록 `backupBegin`이 세션 번호를 돌려주고 write·end가 그 번호를 요구합니다(새 백업이 시작되면 이전 세션은 취소). 종료 때 주기 백업이 진행 중이면 종료 백업은 '변경 없음'으로 건너뛰지 않습니다.
* **전역 오류 안내:** 처리되지 않은 오류·Promise 거부는 `GlobalErrorBanner`가 화면 위쪽에 보여 줍니다(저장소 오류는 `StorageError` 한글 문구 그대로).
* **직접·긴급 백업:** 데스크톱 앱에서는 이 둘도 같은 스트리밍 세션(`backupBegin` kind `manual`·`emergency`)으로 줄 단위 `.json.gz`에 씁니다. 큰 데이터를 한 문자열로 만들 때의 한도(약 512MB)와 메모리 2~3배 사용을 피합니다. 브라우저·데모는 기존 JSON 내려받기입니다.
* **줄 단위 복원(streamRestore):** 줄 단위 백업(.json/.json.gz)은 파일째 읽지 않고 흘려 읽습니다. 1단계 `scanBackupFile`이 파일 전체를 읽으며 증분 SHA-256(`sha256.ts`; WebCrypto는 조각 입력이 안 됨)과 줄별 형식을 검증하고 연도별 건수를 셉니다(아무것도 쓰지 않음). 2단계 `restoreFromFile`이 검증된 파일을 다시 읽으며 달마다 따로 저장합니다(메모리는 한 달치). 달마다 따로 저장하므로 전체가 한 트랜잭션은 아니며, 시작 트랜잭션에서 `meta_restore_in_progress` 표시를 남기고 끝에 지웁니다. 중간에 꺼지면 표시가 남아 다음 실행 때 상단 안내로 알리고(같은 백업으로 다시 복원하거나 복원 직전 긴급 백업 `emergency_before_restore_*`로 되돌림), 전체 교체(`replaceAllData`: 시연·초기화)도 표시를 지웁니다. 한 덩어리 JSON(예전 형식)은 기존처럼 전체를 읽어 한 트랜잭션으로 복원합니다.
* **큰 복원:** 3개 연도 × 월 1.2만 건(43.2만 건) 복원이 한 트랜잭션으로 약 8초에 끝남을 확인했습니다(fake-indexeddb). 실패하면 전부 취소됩니다.

## 11. 입력 화면 설계

* **저장 흐름:** `requestSave` → 검증(`buildDrafts`) → 큰 금액 확인 → 중복 확인(`findDuplicates`) → `saveBatch`. 전체가 `exclusive`로 감싸여 연타에 안전합니다.
* **되돌리기:** `SaveBatch { createdIds, mergedBefore, lines }`를 메모리에 최대 10개 보관. `undoLast`는 생성분 삭제 + 합산 전 스냅샷 복원을 한 트랜잭션으로 하며 사유 “입력 직후 되돌리기”를 기록합니다. Ctrl+Z는 입력 칸이 모두 비어 있을 때만 가로챕니다.
* **최근 입력:** `useHistoryItems`가 저장 묶음의 id로 **현재 값**을 찾아 줄을 만들어(수정·월 이동 반영) 못 찾으면 저장 당시 내용을 읽기 전용으로 보입니다. [수정]은 보고서와 같은 `useDonationEditor`(사유 필수)를 씁니다.
* **무명 번호:** 선택일의 `무명N` 최댓값 + 1(`nextAnonymousName`). 카운터를 저장하지 않으므로 삭제·되돌리기·날짜 변경과 항상 맞습니다. 문자열만 구독해 번호가 바뀔 때만 다시 그립니다.
* **금액:** `parseAmount`(쉼표 제거 후 안전 정수·양수), `addQuickAmount`(15자리 초과 시 무시), `amountToKorean`(표시 전용).
* **단축키:** 전역 keydown에서 처리하되 열린 대화상자(`[role=dialog][data-state=open]`)가 있으면 무시합니다. 한글 조합 중 Enter(`isComposing`)는 무시하고, 금액 단추는 `tabIndex={-1}` + `onMouseDown preventDefault`로 포커스를 유지합니다. 진입 시에는 어느 칸에도 포커스를 두지 않습니다.
* **처음 사용 안내:** `isFirstRun = members.length === 0`이면 `FirstRunGuide`가 맨 위에 렌더되며, `App`이 넘기는 `onNavigate`(`useAppNav.setPage`)로 해당 메뉴로 이동합니다.
* **모바일 안내:** `useIsMobileDevice`(사용자 에이전트 또는 좁은 터치 화면)가 true면 입력 카드 위에 빨간 안내를 그립니다.
* **현금 계수:** 선택일 합계는 파생 값(`dailyTotals`)을 구독하는 별도 컴포넌트가 계산해 입력 칸 변경에는 다시 그리지 않습니다. 계수 금액은 컴포넌트 로컬 상태입니다.

## 12. 인쇄, 테마, 달력

* **인쇄:** `@page { size: A4 landscape; margin: 0 }`로 브라우저 머리글·바닥글이 들어갈 자리를 없애고, 실제 여백은 `main`의 `print:p-[12mm]`와 표의 `thead/tfoot` 간격 행(5mm, 쪽마다 반복)으로 줍니다. 표는 9.5pt·낮은 행 높이로 한 쪽에 약 34행. `print-color-adjust: exact`로 배경이 인쇄됩니다. `PrintHeader`가 한 줄 머리글(제목·요약·출력일시)을 그리며 출력일시는 `beforeprint`에서 갱신합니다. 실제 쪽 나눔과 프린터 여백은 인쇄해서 확인해야 합니다.
* **테마:** Tailwind 4가 색을 `var(--color-*)`로 컴파일하므로 `index.css`가 `:root[data-theme]`별로 변수만 덮어씁니다(컴포넌트 수정 없음). 화면 테마 변수는 `@media screen`에만 있어 인쇄에는 영향이 없고, 인쇄 색은 `data-print-theme`의 8개 변수로만 정해집니다. 마지막 테마는 `localStorage`에 기록해 `main.tsx`가 렌더 전에 먼저 적용하므로 색이 깜빡이지 않습니다.
* **달력:** 일요일 시작 6주(42칸) 고정 그리드, 일요일 빨간색. 입력 칸은 숫자만 받아 `YYYY-MM-DD`로 정리합니다. `pickOnly`는 읽기 전용으로 달력으로만 고르게 합니다(헌금 입력 날짜). 달력은 어디서든 입력 칸 아래에 **겹쳐(absolute) 띄워 창 높이를 늘리지 않고 아래 내용을 덮습니다.** Radix `Dialog` 안에서는 내용 영역의 `overflow-y-auto`가 팝업을 잘라내므로, 달력을 쓰는 짧은 창(헌금 수정, 성도 등록·수정, 빠른 등록)은 `Modal`의 `overflowVisible`로 잘림을 풀어 줍니다(포털로 빼면 포커스 트랩·바깥 클릭 감지와 충돌하기 때문).
* **어두운 테마(`data-theme="DARK"`):** 같은 방식으로 `--color-gray-*`를 **뒤집은** 값, `--color-white`(= `bg-white` 표면색)를 어두운 색, 파랑·빨강·초록·황색 계열을 어두운 바탕에서 읽히는 값으로 덮어쓰고 `color-scheme: dark`로 입력 칸·스크롤바도 어둡게 합니다. `--color-white`가 `text-white`에도 쓰이므로 색 단추(`.btn-primary`, `.btn-danger`)와 `.text-white`는 글자를 흰색으로 고정하고 hover 색은 따로 지정합니다. 화면 전용(`@media screen`)이라 인쇄는 밝은 팔레트와 `data-print-theme`를 그대로 씁니다. 그래서 `PrintTheme`에는 `DARK`가 없습니다.
* **저장 성공 효과:** `useDonationInput.savedSeq`가 저장 성공마다 1씩 올라가고, `Notice`(`success`)와 `DailyTotalsBar`(`flashKey`)가 `key`가 바뀌어 `pop-in`·`flash-save` CSS 애니메이션을 다시 재생합니다. `prefers-reduced-motion`이면 애니메이션을 끕니다.
* **표 행 강조:** `.rpt-table tbody tr:not(.rpt-total-row):hover > td`와 `.row-hover:hover`(가상 목록)가 `--color-blue-50`을 칠합니다(화면 전용, 고정 열 셀도 같은 색).
* **글자 크기:** 설정이 루트 글자 크기(100%/112.5%/125%)를 바꾸며 Tailwind가 `rem` 기반이라 화면 전체가 함께 커집니다.
* **접근성:** 주 메뉴 `aria-current`, 보고서 탭 `role=tablist/tab` + `aria-selected`, 토글 `aria-pressed`, 성도 열 제목 `aria-sort`, 검색 `role=combobox/listbox`, 결과 알림 `aria-live`.

## 13. Electron 셸

* `requestSingleInstanceLock()`으로 중복 실행 차단. `contextIsolation: true`, `nodeIntegration: false`. CSP는 응답 헤더로 강제. 서비스 워커·PWA·자동 업데이트 없음.
* **영문 저장·백업 경로:** 데이터 폴더는 `%APPDATA%\StewardLedger`, 기본 자동 백업 폴더는 `문서\StewardLedgerBackup`입니다(`electron/dataPaths.cjs`). 이전 버전의 한글 폴더(`교회헌금회계`, `교회헌금백업`)가 있으면 앱이 데이터를 열기 전에 한 번 이름을 바꿔 옮기고, 옮기지 못하면(다른 프로그램이 사용 중 등) 데이터를 잃지 않도록 이전 폴더를 계속 씁니다. 설치 폴더 이름도 영문입니다: `productName`이 `StewardLedger`라 기본 설치 위치는 `%LOCALAPPDATA%\Programs\StewardLedger`, 설치 파일은 `StewardLedger Setup 1.0.0.exe`이며 데이터와는 별개입니다(바탕화면·시작 메뉴 바로가기 이름 `청지기 장부`와 창 제목은 표시용이라 한글 그대로). 이미 한글 폴더(`청지기장부`)에 설치된 PC에 새 설치 파일을 실행하면 설치 프로그램이 이전 설치 위치를 그대로 재사용할 수 있으므로, 영문 폴더로 옮기려면 기존 프로그램을 먼저 제거(데이터는 `deleteAppDataOnUninstall: false`로 보존)한 뒤 설치합니다. 테스트는 `dataPaths.test.ts`.
* **화면 멈춤 대응:** `render-process-gone`(비정상 종료)이면 창을 다시 불러오고(1분에 3번 넘으면 안내 후 중단), `unresponsive`이면 [기다리기 / 다시 불러오기]를 묻습니다. 데이터는 IndexedDB에 있어 다시 불러와도 이어서 쓸 수 있습니다. React 화면 오류는 `ErrorBoundary`가 화면 단위로 잡아 앱 전체가 하얗게 되지 않고 메뉴를 계속 쓸 수 있습니다(메뉴를 옮기면 새로 시작).
* **preload**는 `contextBridge`로 최소 API만 노출합니다: 백업 폴더 선택·자동 백업 쓰기·정리, 저장 파일 열기/폴더 보기, 다운로드 완료 알림.
* **자동 백업:** 데이터가 렌더러에 있으므로 종료 요청 시 main이 렌더러에 `backup:request`를 보내 백업 문자열을 받아 `fs`로 기록합니다(임시 파일에 쓴 뒤 이름을 바꿔 전원이 꺼져도 잘린 백업 파일이 남지 않음)**끝날 때까지 기다린 뒤 종료**합니다(상한 5분). 렌더러가 요청을 받으면 `ClosingOverlay`(전체 화면 안내, 0.4초 뒤에 표시, 8초 후 [백업 없이 종료] → `backup:skip`)를 띄우고, 쓰기에 실패하면 main이 [그래도 종료 / 종료 취소]를 묻습니다(취소하면 `backup:cancelled`로 안내를 닫고 앱을 계속 씁니다). 화면 프로세스가 죽거나 Windows `session-end`(종료·로그오프)이면 기다리지 않습니다. `close`는 이미 백업을 기다리는 중이면 중복 실행하지 않습니다.
* **보안 설정:** 자동 백업 폴더는 화면이 보낸 경로가 아니라 사용자가 [폴더 선택]으로 고른 폴더(main이 `backup-dir.json`에 기억)와 기본 폴더만 씁니다(`pickBackupDir`; 그 밖의 경로는 기본 폴더로 바뀜). 카메라·위치 같은 모든 권한 요청은 거부합니다. 빌드 때 Electron 퓨즈로 `runAsNode`, `NODE_OPTIONS`, `--inspect` 인자를 끄고 asar 무결성 검증과 asar에서만 불러오기를 켭니다(`electronFuses`).
* **파일 열기:** `will-download`가 완료된 `.xlsx`의 저장 경로만 `savedFiles`에 기록하고, `file:open`/`file:show`는 그 경로만 처리해 렌더러가 임의 파일을 실행하지 못하게 합니다.

## 14. 저장소 버전

`db.ts`는 버전 1 하나만 선언합니다. 개발 단계라 이전 형식에서 옮기는 업그레이드는 없습니다. 저장 구조를 바꿀 때는 `version(n)`을 추가하고 `upgrade`로 옮기세요(Dexie는 기본키를 직접 바꾸지 못해 테이블을 지웠다가 다시 만들어야 합니다). 한 번 연 데이터는 이전 버전의 앱으로 다시 열 수 없습니다. 시작할 때 저장소를 열지 못하면 빈 화면 대신 한글 오류 안내를 보여 줍니다(`openStorage`, `StorageError`).

## 15. 성능 측정과 설계 근거

성도 1,000명, 매주 4,000건 × 260주(104만 건), 연 약 18만 건. 개발 화면 기준 측정이며 시험 데이터 생성은 `test-data/seed-large.mjs`(저장소에 포함되지 않음).

| 문제(변경 전) | 원인 | 조치 | 결과 |
| :--- | :--- | :--- | :--- |
| 저장 시 연도 전체를 다시 씀 | 연도 단위 키 | **월 단위 키** | 저장 45ms → 3ms (연 1.4만 건) |
| 연도 엑셀 65초 + 화면 정지 | 셀마다 전체 재탐색 | 한 번 훑어 Map 집계, 2시트 요약 | 0.4초, 파일 5.7MB → 76KB |
| 되돌리기 1.5초 | 모든 달을 읽음 | 저장한 달 먼저 | 0.06초 |
| 주·월 이동 0.9초 | 1,000행 전체 렌더 | 가상 스크롤 + 행 높이 측정 | 0.25초 |
| 연 단위 전체 입력 내역 4초 | 18만 건 정렬·행 생성 | 문자열 비교, 보이는 행만 계산 | 0.06초 |
| 메모리 70MB, 연도가 계속 쌓임(200MB+) | 연도 배열을 해제하지 않음 | 달 단위 + 최대 3개 연도 | 입력 화면 35~40MB, 5개 연도 열어도 210~230MB |
| 104만 건 복원 실패 | 저널 값이 IndexedDB 한도 초과 | 연도 하나씩 복원·이전 | 연도 33MB 복원 0.3초 |
| 저장 233ms | 연도 배열 재구성 | 달 배열만 교체 | 83ms |

## 16. 테스트

`npm test` (Vitest, 25개 파일, 147건). 저장소는 `fake-indexeddb`, 화면 상태는 `jsdom` + `@testing-library/react`.

| 영역 | 파일 | 검증 |
| :--- | :--- | :--- |
| 순수 규칙 | `domain/*.test.ts` | 금액·검색·세대·정렬·월 캐시·월별 행렬 = 주별 합 |
| 저장소 | `storage/monthly.test.ts`, `donationsTable.test.ts`, `storageErrors.test.ts` | 행 단위 쓰기·롤백, 색인 중복 검사, 연도 백업·복원 왕복, 저장소 오류 안내 |
| 백업 | `backup/mergeRules.test.ts`, `testData.test.ts` | 병합 규칙·id 다시 연결, 시험 데이터 무결성 |
| 엑셀 | `services.test.ts`, `monthExcel.test.ts` | 시트 구성, 수식 인젝션, 월별 파일 |
| 화면 상태 | `contexts/DonationContext.test.tsx` | 달 배열 교체·유지, 읽기 경합 재조회, `reloadAll` 무효화, 읽기 실패 재시도, 월·연도 이동 수정과 이력, 이동한 내역 되돌리기, 연도 퇴출(건수 예산·사용 중 유지), 연도 목록 갱신 |
| 연타 방지 | `hooks/exclusive.test.ts` | 진행 중 호출 무시, 실패 후 해제 |
| 백업 | `backup/autoBackupService.test.ts`, `backupVerify.test.ts`, `dataPaths.test.ts` | 주기 백업(변경 표시 처리·실패 복구), 스트리밍 줄 = 스냅샷, 달을 넘는 이동 시 재시도, 직접·긴급 백업 세션, 백업 파일 검증(변조·잘림), 백업 폴더 허용 |
| 오류 복구 | `shared/ErrorBoundary.test.tsx`, `monthly.test.ts` | 화면 오류 안내와 다시 시도, 트랜잭션 전체 취소·같은 키 마지막 쓰기 우선 |

**Electron 스모크:** `npm run build` 후 `npm run smoke`가 임시 데이터 폴더로 앱을 띄워 시작·저장소·보안(Node 접근 불가, CSP, 권한 거부)·백업 IPC(쓰기·검증·허용 폴더)를 확인합니다. `SMOKE_EXE=release\win-unpacked\StewardLedger.exe`를 주면 포장된 앱(퓨즈 포함)을 시험합니다.

**자동으로 확인하지 못하는 것:** 실제 프린터 출력, 실제 엑셀·한셀에서 열기, 설치본(NSIS) 설치·제거 흐름. 이 부분은 직접 확인해야 합니다.

## 17. 알려진 한계

* 날짜 형식이 깨진 옛 데이터는 월별 이전에서 제외될 수 있다.
* 메모리에서 내려간 연도의 내역은 “최근 입력” 줄에서 저장 당시 내용(읽기 전용)으로 표시된다.
* 새로 저장한 내역을 되돌리면 생성 기록이 없는데도 이력에 `DELETE(입력 직후 되돌리기)`가 남는다.
* 복원은 설정을 포함하지 않는다. 오래된 백업을 복원하면 그 뒤에 추가된 금액 단추 등은 헌금 종류 화면에서 다시 추가해야 한다.
* 이름만 같고 연락처가 없는 성도는 다른 PC 백업 병합 때 새 성도로 추가된다(복원 창이 안내).
* **갑작스러운 정전·강제 종료:** IndexedDB 트랜잭션 덕분에 여러 키에 걸친 작업이 일부만 반영된 채 남지 않습니다. 다만 운영체제가 아직 디스크에 쓰지 않은 **마지막 몇 초의 저장은 사라질 수 있습니다**(IndexedDB의 일반적인 쓰기 보장 수준). 자동 백업은 앱을 정상 종료할 때만 만들어지므로 정전 직전까지의 변경은 백업에 없을 수 있습니다.
* **이전 설치본으로 되돌리기 불가:** 저장소를 Dexie로 바꾼 버전(1.1.0)부터 데이터베이스 버전이 올라가므로, 한 번 실행한 데이터는 1.0.0 이하 설치본으로 열 수 없습니다. 되돌려야 하면 먼저 백업 파일을 만들고, 이전 설치본에서 복원하세요.
* 매우 큰 데이터(수십만 건 이상)에서는 종료 시 백업이 오래 걸려 종료 안내가 길게 보입니다(8초 후 건너뛰기 가능, 상한 5분).
* 자동 백업 폴더를 OneDrive가 동기화하는 문서 폴더나 USB·네트워크 드라이브로 두면 쓰기가 느리거나 실패할 수 있습니다(실패하면 종료 전에 묻습니다). 데이터 폴더는 Windows 계정별이므로 다른 계정으로 로그인하면 비어 있습니다.
* Windows 10 이상 64비트만 지원합니다(Electron 45).
* 서명되지 않은 설치 파일은 Windows 스마트 앱 컨트롤에서 막힐 수 있다.

## 18. 빌드 · 실행 · 배포

| 명령 | 용도 |
| :--- | :--- |
| `npm run dev` | 개발 서버 (http://localhost:5173) |
| `npm run build` | 타입 검사 + 웹 빌드 |
| `npm test` | 전체 테스트 |
| `npm run testdata` | 시험 데이터 백업 파일 생성 |
| `npm run smoke` | Electron 스모크 시험(`npm run build` 후) |
| `npm run electron:dev` / `electron:start` | 데스크톱 앱 실행(개발 / 빌드 후) |
| `npm run dist` | Windows 설치 파일(`release/`, NSIS, 설치 경로 변경 가능, 삭제해도 데이터 보존) |

* **시연 페이지:** `main`에 올리면 `.github/workflows/pages.yml`이 빌드해 GitHub Pages에 배포합니다(저장소 Settings → Pages의 Source가 “GitHub Actions”여야 함).
* **버전:** `package.json`의 `version`과 `contexts/types.ts`의 `APP_VERSION`을 함께 바꾸고, 백업 파일 형식을 바꿀 때만 `SCHEMA_VERSION`을 올립니다.
