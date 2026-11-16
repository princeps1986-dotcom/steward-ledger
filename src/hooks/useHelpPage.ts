import { useCallback, useState } from 'react';
import { HELP_SECTIONS } from '../components/pages/help/helpContent';

/** 사용 설명서: 목차에서 메뉴를 고르면 해당 설명으로 이동하고 현재 위치를 강조합니다. */
export function useHelpPage() {
  const [activeId, setActiveId] = useState(HELP_SECTIONS[0].id);

  const goTo = useCallback((id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return {
    sections: HELP_SECTIONS.map((s) => ({
      ...s,
      active: s.id === activeId,
      tocClassName: `block w-full rounded px-3 py-1.5 text-left text-sm ${s.id === activeId ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`,
    })),
    goTo,
  };
}
