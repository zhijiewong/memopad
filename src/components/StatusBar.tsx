import { useState } from 'react';
import { useBuffers, selectActive, type Encoding, type LineEnding } from '../stores/buffers';
import { EncodingPopover } from './EncodingPopover';
import { EolPopover } from './EolPopover';

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
  const setActiveEncoding = useBuffers((s) => s.setActiveEncoding);
  const setActiveEol = useBuffers((s) => s.setActiveEol);

  const [encRect, setEncRect] = useState<DOMRect | null>(null);
  const [eolRect, setEolRect] = useState<DOMRect | null>(null);

  if (!active) {
    return <div className="h-6 border-t" style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg)' }} />;
  }

  return (
    <div
      className="flex h-6 select-none items-center gap-3 border-t px-3 text-[11px]"
      style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg)', color: 'var(--app-fg-muted)' }}
    >
      <span data-status-segment="language">{languageLabel(active.path)}</span>

      <button
        type="button"
        data-status-segment="encoding"
        onClick={(e) => setEncRect(e.currentTarget.getBoundingClientRect())}
        className="hover:text-neutral-100"
      >
        {encodingLabel(active.encoding)}
      </button>

      <button
        type="button"
        data-status-segment="eol"
        onClick={(e) => setEolRect(e.currentTarget.getBoundingClientRect())}
        className="hover:text-neutral-100"
      >
        {eolLabel(active.eol)}
      </button>

      {encRect && (
        <EncodingPopover
          current={active.encoding}
          anchorRect={encRect}
          onSelect={setActiveEncoding}
          onClose={() => setEncRect(null)}
        />
      )}
      {eolRect && (
        <EolPopover
          current={active.eol}
          anchorRect={eolRect}
          onSelect={setActiveEol}
          onClose={() => setEolRect(null)}
        />
      )}
    </div>
  );
}
