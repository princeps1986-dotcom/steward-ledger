/**
 * 화면에 보이는 기능 스위치. 코드는 그대로 두고 화면에서만 켜고 끕니다.
 * excelExport: 보고서 화면의 [엑셀저장] 단추와 사용 설명서의 엑셀 저장 안내.
 *   다시 쓰려면 true로 바꾸세요(엑셀 저장 코드는 src/services/excel, src/hooks/useReports.ts의 saveExcel에 그대로 있습니다).
 * excelImport: 성도 [명단 가져오기]의 .xlsx 파일 선택과 관련 안내(CSV는 항상 가능).
 *   다시 쓰려면 true로 바꾸세요(.xlsx 읽기 코드는 src/services/import/memberImportService.ts에 그대로 있습니다).
 */
export const FEATURES = {
  excelExport: false,
  excelImport: false,
} as const;
