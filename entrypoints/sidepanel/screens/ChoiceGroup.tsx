export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** Radio buttons, so every option is visible at once (no dropdown to open). */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: Array<Choice<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={[
            'flex items-start gap-2 rounded-md border p-2.5 text-sm transition-colors',
            o.value === value
              ? 'border-[#0969da] bg-[#0969da]/5 dark:border-[#4493f8] dark:bg-[#4493f8]/10'
              : 'border-slate-300 dark:border-slate-600',
            o.disabled
              ? 'cursor-not-allowed opacity-50'
              : 'cursor-pointer hover:border-slate-400 dark:hover:border-slate-500',
          ].join(' ')}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            className="mt-0.5 accent-[#0969da]"
          />
          <span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{o.label}</span>
            {o.hint && <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{o.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
