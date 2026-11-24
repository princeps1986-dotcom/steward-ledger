# 청지기 장부 — 코드 지도 (기능 → 파일)

기능을 고칠 때 **어느 파일부터 보면 되는지**를 한곳에 모았습니다. 그래프(`graphify query`)가 기능 이름에서 파일을 바로 찾도록, 기능마다 제목 아래에 실제 경로를 적었습니다. 설계 이유는 [ARCHITECTURE.md](../ARCHITECTURE.md), 요구사항은 [PRD.md](../PRD.md)를 보세요. 파일을 옮기거나 이름을 바꾸면 이 문서도 함께 고칩니다.

계층은 화면(`components`) → 화면 로직(`hooks`) → 상태(`contexts`) → 순수 규칙(`services/domain`) · 저장(`services/storage`) 순으로 아래를 호출합니다. 데스크톱 전용 기능은 `src/services/desktopBridge.ts`를 거쳐 `electron/`으로 갑니다.

## 헌금 입력
- 화면: `src/components/pages/donation-input/DonationInputPage.tsx` (성도 찾기 `MemberSearchBox.tsx`, 금액 `AmountRow.tsx`, 합계 대조 `DailyTotalsBar.tsx`, 최근 입력 `HistoryPanel.tsx`, 중복 확인 `DuplicateModal.tsx`, 큰 금액 확인 `LargeAmountModal.tsx`, 빠른 등록 `QuickRegisterModal.tsx`, 처음 안내 `FirstRunGuide.tsx`)
- 로직: `src/hooks/useDonationInput.ts`, `useDailyTotals.ts`, `useHistoryItems.ts`, `useDatePicker.ts`
- 규칙: `src/services/domain/amount.ts`(금액), `search.ts`(찾기), `anonymous.ts`(무명·방문자), `donationOps.ts`(같은 헌금 합산·복구하기), `offeringDefaults.ts`
- 저장: `src/contexts/DonationContext.tsx` → `src/services/storage/storageService.ts`

## 보고서(일별·주별·월별·분기별·연도별·개인별)
- 화면: `src/components/pages/reports/ReportsPage.tsx`, 탭 `SummaryTab.tsx`·`ListTab.tsx`·`PersonalTab.tsx`·`AuditTab.tsx`, 수정 `DonationEditModal.tsx`, 인쇄 머리글 `PrintHeader.tsx`
- 로직: `src/hooks/useReports.ts`(기간 선택·250ms 지연의 `useReportFilters` 포함), `useDonationEditor.ts`, `usePaging.ts`, `useIsPrinting.ts`, `useNameTag.ts`
- 규칙: `src/services/domain/periodSummary.ts`(집계), `weekly.ts`, `donationList.ts`, `listPager.ts`, `auditFilter.ts`(수정·삭제 이력), `family.ts`(세대 합산), `memberName.ts`(동명이인 표기), `positions.ts`(직분), `monthCache.ts`(월 캐시), `compare.ts`
- PDF 저장: `useReports.ts` → `desktopBridge.savePdf` → `electron/main.cjs`의 `report:save-pdf`
- 헌금 CSV 불러오기(일별 보고서, [PDF 저장] 오른쪽): 화면 `DonationImportModal.tsx`(ReportsPage에서 엶), 로직 `src/hooks/useDonationImport.ts`, 줄 읽기·성도/종류 매칭·상태 판정(순수 함수) `src/services/import/donationImportService.ts`, 시험 `donationImportService.test.ts`

## 성도 정보
- 화면: `src/components/pages/members/MembersPage.tsx`, `MemberEditModal.tsx`, 명단 불러오기 `MemberImportModal.tsx`
- 로직: `src/hooks/useMembersPage.ts`, `useMemberForm.ts`, `useMemberImport.ts`
- 규칙·상태: `src/services/domain/memberRules.ts`, `memberSort.ts`, `src/contexts/MemberContext.tsx`, CSV `src/services/import/memberImportService.ts`

## 헌금 종류
- `src/components/pages/offerings/OfferingsPage.tsx`, `src/hooks/useOfferingsPage.ts`, `src/contexts/OfferingTypeContext.tsx`

## 설정 정보(백업·복원·시연 데이터·초기화·업데이트)
- 화면·로직: `src/components/pages/settings/SettingsPage.tsx`, `src/hooks/useSettingsPage.ts`, `src/contexts/SettingsContext.tsx`
- 백업·복원: `src/services/backup/backupService.ts`(줄 단위 백업), `streamRestore.ts`(줄 단위 복원: 연도별 복원과 전체 복원 `full`, 예전 한 덩어리 JSON은 `payloadBackup`으로 감싸 같은 길로), `mergeRules.ts`(다른 PC 백업 병합), `validation.ts`(체크섬·버전 변환), `sha256.ts`, `autoBackupService.ts`(종료·10분 자동 백업), `backupBusy.ts`(동시 실행 방지)
- 시연 데이터: `src/services/demo/demoService.ts`, `demoData.ts`, `demoState.ts`, `src/hooks/useAutoDemo.ts`
- 업데이트 안내: `src/hooks/useNewVersion.ts`(웹), main의 `update:check`(데스크톱)
- 업데이트 후 변경 내역: `src/changelog.ts`(버전별 바뀐 점, 출시 때 package.json 버전과 같은 키로 추가), `src/components/shared/WhatsNewModal.tsx`(첫 실행 때 한 번, 본 버전은 설정 `seenVersion`)

## 저장소(IndexedDB)
- `src/services/storage/db.ts`(Dexie 정의), `storageService.ts`(원자적 트랜잭션·월 키), `keys.ts`, `storageErrors.ts`, `tabSyncChannel.ts`(창 간 동기화)
- 건별 암호화(권한 체계 4단계): `src/services/storage/cipher.ts`(AES-GCM·열쇠 보관), `storageService.ts`의 `sealDonations`·`openDonations`·`sealAudits`·`openAudits`·`sealMembers`(저장·읽기 때 잠그고 풂, 트랜잭션 안은 `Dexie.waitFor`), `encryptAllPlaintext`(첫 암호화 이전·이어하기), `storageHasRows`·`wipeAllStorage`(열쇠를 잃었을 때), `dataKeyOpensStorage`(받은 열쇠가 저장된 데이터와 맞는지, 열쇠 파일을 잃어 새 열쇠가 온 경우를 막음). 로그인 직후 준비는 `src/services/auth/prepareData.ts`(열쇠 받기 → 백업 → 암호화 이전), 이력의 고친 사람은 `src/services/auth/currentUser.ts`
- 상태 보관: `src/contexts/DonationContext.tsx`(달 단위 메모리 모델), `AppProviders.tsx`, 데이터 모델 `types.ts`

## 데스크톱 셸(Electron)
- `electron/main.cjs`(창, 백업·복원·PDF·업데이트 IPC, CSP, 권한·개발자 도구 차단, 종료 시 자동 백업), `preload.cjs`(노출 API, 오른쪽 버튼 차단·영구 저장소 요청, 타입은 `src/services/desktopBridge.ts`의 `DesktopApi`)
- `electron/backupCrypto.cjs`(백업 암호화), `backupVerify.cjs`(백업 검증), `restoreLog.cjs`(복원 기록), `dataPaths.cjs`(데이터·백업 폴더), `pcKey.cjs`(자동 백업용 PC 키)
- 구글 로그인(권한 체계 1단계, 계획 `docs/plans/권한-체계-계획.md`): `electron/auth.cjs`(OAuth+PKCE·loopback, 토큰 저장 안 함), `idToken.cjs`(ID 토큰 검증), `authConfig.cjs`(클라이언트 ID 빈 템플릿, 실제 값은 gitignore된 `authConfig.local.cjs`가 덮어씀, 시험 `authConfig.test.ts`), `dataKey.cjs`(데이터 열쇠 DPAPI 저장소, IPC `data:key`·`data:key-replace`), `userStore.cjs`(계정·역할 목록 `users.json`·PIN, 로그인 때 `admit`으로 허용 여부 확인), 역할 표 `src/services/auth/roles.ts`(`can(role, action)`), IPC `auth:status|login|cancel|logout|set-pin|verify-pin`(`desktopBridge.ts`의 `authStatus`·`authLogin`·`authCancel`·`authLogout`·`authSetPin`·`authVerifyPin`), 로그인 화면 `src/components/auth/AuthGate.tsx`(`src/main.tsx`에서 `AppProviders`를 감쌈, 브라우저 모드는 통과)·`src/hooks/useAuthGate.ts`, 시험 `src/services/auth.test.ts`·`userStore.test.ts`·`auth/roles.test.ts`·`AuthGate.test.tsx`
- 역할 적용(권한 체계 5단계): 판단 `src/services/auth/access.ts`(`allowed`·`assertAllowed`, 브라우저 모드는 관리자와 같음), 메뉴·직접 이동 차단 `src/hooks/useAppShell.ts`(`visiblePages`·`pageAllowed`·`useAppNav`), 보고서 탭 `ReportsPage.tsx`, 설정 화면 `SettingsPage.tsx`, 쓰기 길목 `storageService.ts`의 `transact`, 복원·초기화·시연은 `backupService.ts`·`streamRestore.ts`·`demoService.ts` 진입 함수, main 계정 관리 IPC `users:list|add|set-role|set-disabled`(관리자만)·업데이트·직접 백업은 관리자·재정담당만(`electron/main.cjs`), 시험 `auth/access.test.ts`·`useAppNav.test.tsx`·`rolesScreens.test.tsx`
- 관리자 탭·자동 잠금(권한 체계 6단계): 관리자 탭 `src/components/pages/admin/AdminPage.tsx`·`src/hooks/useAdminPage.ts`(계정 등록·역할 변경·사용 중지·기록, IPC `users:*`·`users:log`), 로그인·계정 변경 기록은 `electron/userStore.cjs`(`users.json`의 `log`, 최근 100건), 15분 자동 잠금 `src/hooks/useIdleLock.ts`·잠금 화면 `AuthGate.tsx`의 `LockScreen`(PIN, PIN이 없으면 구글 재로그인)·`useAuthGate.ts`의 `lock`·`logout`(열쇠·사용자 버림), 머리글의 로그인 표시·PIN·잠금·로그아웃 `SessionBar.tsx`(`src/hooks/useSession.ts` 컨텍스트), 수정·삭제 이력 탭의 작업자 열 `AuditTab.tsx`, 시험 `lock.test.tsx`·`AdminPage.test.tsx`·`useIdleLock.test.tsx`
- 점검 반영(권한 체계): main의 로그인·역할 검사 `electron/guards.cjs`(`createGuards`: `freshSession`·`withSession`·`roleIs`·`adminOnly`, `createReloadGuard`: 화면을 다시 불러오면 로그아웃), 잠금 해제용 재로그인(`auth.cjs`의 `login({ reauth })`, `idToken.cjs`의 `minAuthTime`), 잠금·PIN 훅 `src/hooks/useLock.ts`(로그인·준비·로그아웃은 `useAuthGate.ts`), 설정 화면 분리 `useAppUpdate.ts`·`useDemoAndReset.ts`(상태)와 `settings/AppUpdateSection.tsx`·`DemoResetSection.tsx`(화면), 시험 `guards.test.ts`
- 연도 잠금·기간 삭제(권한 체계 7단계): 잠금 값 `AppSettings.lockedYears`(`contexts/types.ts`), 막는 곳 `storageService.ts`의 `transact`(기본 적용, 복원·초기화·시연만 `ignoreYearLocks`), 잠금 권한 확인 `SettingsContext.tsx`의 `update`, 기간 삭제 `DonationContext.tsx`의 `deletePeriod`(`dates.ts`의 `monthsBetween`, `storageService.ts`의 `countDonationsBetween`), 화면 `settings/YearLockSection.tsx`(설정 정보, PC앱에서만 표시)·`settings/PeriodDeleteSection.tsx`(관리자 탭 `admin/AdminPage.tsx`에서 표시), 시험 `contexts/yearLock.test.tsx`
- 브라우저와 PC앱의 기능 차이는 `desktop()`(`desktopBridge.ts`)이 있는지로 갈립니다(`BrowserNotice.tsx`, `useAutoDemo.ts` 등).

## 앱 뼈대·공통 화면
- 시작: `src/main.tsx` → `src/App.tsx`, `src/hooks/useAppShell.ts`(메뉴·종료 백업 처리)
- 공통 부품: `src/components/shared/` (`Modal.tsx`, `DatePicker.tsx`, `Notice.tsx`, `ErrorBoundary.tsx`, `ClosingOverlay.tsx`, `RestoringOverlay.tsx` 등), 테마 `src/services/theme.ts`
- 설명서: `src/components/pages/help/helpContent.ts`(기능이 바뀌면 함께 고침), `HelpPage.tsx`, `src/hooks/useHelpPage.ts`

## 개발 도구
- 실행: `npm run dev`(브라우저 모드), `npm run dev:app`(`scripts/dev-app.mjs`, 개발 서버 + Electron 창)
- 시험 데이터: `scripts/generate-test-data.mjs`, `testdata-core.mjs` · 스모크 시험: `scripts/smoke.mjs`
- 배포: `.github/workflows/pages.yml`(시연 페이지), `npm run dist`(설치 파일, 먼저 `scripts/check-release.mjs`가 구글 클라이언트 ID가 비었으면 멈춤)
