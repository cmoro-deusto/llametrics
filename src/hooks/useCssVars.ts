/** Read a resolved CSS custom property value (for uPlot, which needs real colors). */
import { useMemo } from 'react';
import { useThemeVersion } from '../theme';

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Returns resolved values for the given CSS var names; re-reads whenever
 * the theme changes (mode/palette/accent).
 */
export function useCssVars(names: readonly string[]): Record<string, string> {
  const version = useThemeVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of names) out[n] = cssVar(n);
    return out;
  }, [version, names.join(',')]);
}
