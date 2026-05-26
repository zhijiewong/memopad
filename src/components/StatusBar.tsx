import { useBuffers, selectActive, type Encoding, type LineEnding } from '../stores/buffers';
import { languageForPath } from '../lib/language';

function encodingLabel(e: Encoding): string {
  switch (e) {
    case 'utf-8': return 'UTF-8';
    case 'utf-8-bom': return 'UTF-8 BOM';
    case 'utf-16-le': return 'UTF-16 LE';
    case 'utf-16-be': return 'UTF-16 BE';
  }
}

function eolLabel(e: LineEnding): string {
  return e.toUpperCase();
}

function languageLabel(path: string | null): string {
  if (!path) return 'Plain';
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    rs: 'Rust', js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX',
    json: 'JSON', md: 'Markdown', markdown: 'Markdown',
  };
  return map[ext] ?? 'Plain';
}

export function StatusBar() {
  const active = useBuffers(selectActive);
  if (!active) {
    return <div className="h-6 border-t border-neutral-800 bg-neutral-900" />;
  }
  // Force read of languageForPath so we get a TS error if its signature changes.
  void languageForPath;
  return (
    <div className="flex h-6 select-none items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-3 text-[11px] text-neutral-400">
      <span data-status-segment="language">{languageLabel(active.path)}</span>
      <span data-status-segment="encoding">{encodingLabel(active.encoding)}</span>
      <span data-status-segment="eol">{eolLabel(active.eol)}</span>
    </div>
  );
}
