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
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={[
            'flex items-start gap-2 rounded-md border p-2 text-sm',
            o.value === value ? 'border-slate-900 dark:border-slate-100' : 'border-slate-300 dark:border-slate-600',
            o.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          ].join(' ')}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">{o.label}</span>
            {o.hint && <span className="block text-xs text-slate-500">{o.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
