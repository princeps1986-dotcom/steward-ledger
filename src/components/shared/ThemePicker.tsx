import type { ThemeOption } from '../../services/theme';

interface Props<T extends string> {
  legend: string;
  value: T;
  options: ThemeOption<T>[];
  onChange(v: T): void;
}

/** 색 미리보기가 있는 라디오 선택 카드 (화면 테마·인쇄 양식 색상 공용) */
export function ThemePicker<T extends string>({ legend, value, options, onChange }: Props<T>) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="grid grid-flow-col auto-cols-fr gap-2" role="radiogroup" aria-label={legend}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(o.value)}
              className={`w-full min-w-0 rounded-lg border px-3 py-2 text-left text-sm ${checked ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
            >
              <span className="mb-1.5 flex gap-1" aria-hidden="true">
                {o.swatch.map((c, i) => (
                  <span key={i} className="h-4 w-4 rounded-full border border-black/10" style={{ background: c }} />
                ))}
              </span>
              <span className="block font-medium">{o.label}</span>
              <span className="block text-xs text-gray-500">{o.desc}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
