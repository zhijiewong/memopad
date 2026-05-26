import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  set: (mode: ThemeMode) => void;
  toggle: () => void;
  reset: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: 'system',
  set: (mode) => set({ mode }),
  toggle: () => {
    const order: ThemeMode[] = ['dark', 'light', 'system'];
    const idx = order.indexOf(get().mode);
    set({ mode: order[(idx + 1) % order.length] });
  },
  reset: () => set({ mode: 'system' }),
}));

/**
 * Resolve a ThemeMode to a concrete 'light' or 'dark'.
 * 'system' consults window.matchMedia. Defaults to 'dark' if matchMedia is unavailable.
 */
export function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  const mm = (window as unknown as { matchMedia?: (q: string) => MediaQueryList }).matchMedia;
  if (!mm) return 'dark';
  return mm('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
