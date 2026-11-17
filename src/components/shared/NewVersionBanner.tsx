import { useNewVersion } from '../../hooks/useNewVersion';

export function NewVersionBanner() {
  if (!useNewVersion()) return null;
  return (
    <div className="no-print flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900" role="status">
      <span className="flex-1">새 버전이 나왔습니다. 입력 중인 내용을 저장한 뒤 [새로고침]을 눌러 주세요.</span>
      <button className="btn" onClick={() => window.location.reload()}>
        새로고침
      </button>
    </div>
  );
}
