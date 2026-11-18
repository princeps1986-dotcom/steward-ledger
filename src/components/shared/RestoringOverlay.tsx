/** 백업 복원 중 화면을 덮어 다른 조작(저장·이동)을 막는 안내 */
export function RestoringOverlay() {
  return (
    <div role="alertdialog" aria-modal="true" aria-label="복원 중" className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-[26rem] max-w-[90vw] space-y-3 rounded-lg bg-white p-6 text-center shadow-xl">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" aria-hidden="true" />
        <h2 className="text-base font-bold">백업을 복원하고 있습니다</h2>
        <p className="text-sm leading-relaxed text-gray-600">끝날 때까지 앱을 닫거나 다른 작업을 하지 말고 잠시만 기다려 주세요.</p>
      </div>
    </div>
  );
}
