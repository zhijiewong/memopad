import { describe, it, expect, beforeEach } from 'vitest';
import { useTheme, effectiveTheme, type ThemeMode } from '../stores/theme';

function setSystemPrefersDark(dark: boolean) {
  (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia = ((query: string) => {
    return {
      matches: query.includes('dark') ? dark : !dark,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

describe('theme store', () => {
  beforeEach(() => {
    useTheme.getState().reset();
  });

  it('default mode is "system"', () => {
    expect(useTheme.getState().mode).to.equal('system');
  });

  it('set("dark") changes mode', () => {
    useTheme.getState().set('dark');
    expect(useTheme.getState().mode).to.equal('dark');
  });

  it('effectiveTheme("dark") returns "dark"', () => {
    expect(effectiveTheme('dark')).to.equal('dark');
  });

  it('effectiveTheme("light") returns "light"', () => {
    expect(effectiveTheme('light')).to.equal('light');
  });

  it('effectiveTheme("system") follows window.matchMedia prefers-color-scheme: dark', () => {
    setSystemPrefersDark(true);
    expect(effectiveTheme('system')).to.equal('dark');
    setSystemPrefersDark(false);
    expect(effectiveTheme('system')).to.equal('light');
  });

  it('effectiveTheme handles missing matchMedia gracefully (defaults to dark)', () => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    expect(effectiveTheme('system')).to.equal('dark');
  });

  it('toggle cycles dark → light → system → dark', () => {
    useTheme.getState().set('dark');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).to.equal('light');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).to.equal('system');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).to.equal('dark');
  });

  type _ModeIsExported = ThemeMode;
  void (null as unknown as _ModeIsExported);
});
