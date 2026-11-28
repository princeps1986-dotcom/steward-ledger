import { useCallback, useEffect, useMemo, useState } from 'react';
import { HELP_SECTIONS, type HelpParagraph } from '../components/pages/help/helpContent';

const paragraphText = (p: HelpParagraph) => (typeof p === 'string' ? p : p.text);

/** 설명서: 목차에서 메뉴를 선택하면 해당 설명으로 이동하고 현재 위치를 강조합니다. 검색어가 있으면 제목·본문에 포함된 항목만 보여 줍니다. */
export function useHelpPage(initialSection?: string) {
  const [activeId, setActiveId] = useState(HELP_SECTIONS[0].id);
  const [query, setQuery] = useState('');

  const goTo = useCallback((id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  // [? 도움말]·F1로 열었으면 보던 화면의 설명으로 바로 이동합니다.
  // 화면을 옮기면 App이 본문 스크롤을 맨 위로 되돌리므로(부모 효과는 자식보다 늦게 실행), 한 프레임 뒤에 이동합니다.
  useEffect(() => {
    if (!initialSection || !HELP_SECTIONS.some((s) => s.id === initialSection)) return;
    const raf = requestAnimationFrame(() => goTo(initialSection));
    return () => cancelAnimationFrame(raf);
  }, [initialSection, goTo]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return HELP_SECTIONS;
    return HELP_SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((i) => `${i.heading} ${i.body.map(paragraphText).join(' ')}`.toLowerCase().includes(q)),
    })).filter((s) => s.items.length > 0);
  }, [q]);

  return {
    query,
    setQuery,
    searching: q !== '',
    resultCount: visible.reduce((n, s) => n + s.items.length, 0),
    sections: visible.map((s) => ({
      ...s,
      active: s.id === activeId,
      tocClassName: `block w-full rounded px-3 py-1.5 text-left text-sm ${s.id === activeId ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`,
    })),
    goTo,
  };
}
