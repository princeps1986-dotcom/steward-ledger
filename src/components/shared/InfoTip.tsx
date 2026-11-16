import { useId } from 'react';

interface Props {
  /** 툴팁에 표시할 안내 문구 */
  text: string;
  label?: string;
}

/** ⓘ 아이콘에 마우스를 올리거나 키보드로 포커스하면 안내 문구가 나타나는 툴팁 */
export function InfoTip({ text, label = '안내' }: Props) {
  const id = useId();
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-400 text-xs font-semibold text-gray-600 hover:bg-gray-100 focus:bg-gray-100"
        aria-label={label}
        aria-describedby={id}
      >
        i
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute left-6 top-1/2 z-30 w-72 -translate-y-1/2 rounded-md bg-gray-800 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
