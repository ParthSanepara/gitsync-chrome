import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

/**
 * Shared visual language for the panel: GitHub's own Primer palette and spacing, so the tool reads as
 * an extension of github.com rather than a distinct product. One button hierarchy, one field style, one
 * card style, used everywhere instead of each screen inventing its own.
 */

type Variant = 'primary' | 'secondary' | 'danger' | 'link';

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0969da] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<Variant, string> = {
  // GitHub's positive/confirm action color (the Merge button), used for the one action that runs a sync.
  primary: 'px-3 py-1.5 border border-transparent bg-[#1f883d] text-white enabled:hover:bg-[#1a7f37]',
  secondary:
    'px-3 py-1.5 border border-slate-300 bg-white text-slate-900 enabled:hover:bg-slate-50 ' +
    'dark:border-slate-600 dark:bg-[#21262d] dark:text-slate-100 dark:enabled:hover:bg-slate-700',
  danger:
    'px-3 py-1.5 border border-slate-300 bg-white text-[#d1242f] enabled:hover:bg-[#d1242f] enabled:hover:text-white ' +
    'dark:border-slate-600 dark:bg-[#21262d] dark:text-[#f85149] dark:enabled:hover:bg-[#f85149] dark:enabled:hover:text-slate-900',
  link: 'p-0 text-[#0969da] enabled:hover:underline dark:text-[#4493f8]',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

/** Same visual treatment as `Button`, for cases that must be a real link (opens a URL, works with cmd-click). */
export function LinkButton({
  variant = 'secondary',
  className = '',
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export const textLinkClass = 'text-sm text-[#0969da] hover:underline dark:text-[#4493f8]';

export const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-[#0969da] focus:outline-none focus:ring-1 focus:ring-[#0969da] ' +
  'dark:border-slate-600 dark:bg-[#0d1117] dark:text-slate-100 dark:placeholder:text-slate-500';

export const cardClass = 'rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-[#161b22]';

export const dividedListClass =
  'divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700';

export const mutedTextClass = 'text-xs text-slate-500 dark:text-slate-400';

export const sectionLabelClass = 'text-sm font-semibold text-slate-900 dark:text-slate-100';
