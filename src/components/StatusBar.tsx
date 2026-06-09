import { useEffect, useRef, useState } from 'react';
import { useBuffers, selectFocused, type Encoding, type LineEnding } from '../stores/buffers';
import { EncodingPopover } from './EncodingPopover';
import { EolPopover } from './EolPopover';
import { LanguagePopover } from './LanguagePopover';
import { useEditorPrefs } from '../stores/editorPrefs';
import { useCursorPos } from '../stores/cursorPos';
import { effectiveLanguageId, languageLabel } from '../lib/language';

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

export function StatusBar() {
  const active = useBuffers(selectFocused);
  const setActiveEncoding = useBuffers((s) => s.setActiveEncoding);
  const setActiveEol = useBuffers((s) => s.setActiveEol);
  const wordWrap = useEditorPrefs((s) => s.wordWrap);
  const toggleWordWrap = useEditorPrefs((s) => s.toggleWordWrap);
  const line = useCursorPos((s) => s.line);
  const col = useCursorPos((s) => s.col);
  const cursorCount = useCursorPos((s) => s.cursorCount);

  const [encRect, setEncRect] = useState<DOMRect | null>(null);
  const [eolRect, setEolRect] = useState<DOMRect | null>(null);
  const [langRect, setLangRect] = useState<DOMRect | null>(null);
  const langBtnRef = useRef<HTMLButtonElement>(null);
  const setActiveLanguage = useBuffers((s) => s.setActiveLanguage);

  useEffect(() => {
    (window as unknown as { __memopadOpenLanguagePicker?: () => void }).__memopadOpenLanguagePicker = () => {
      if (langBtnRef.current) setLangRect(langBtnRef.current.getBoundingClientRect());
    };
    return () => {
      (window as unknown as { __memopadOpenLanguagePicker?: () => void }).__memopadOpenLanguagePicker = undefined;
    };
  }, []);

  if (!active) {
    return <div className="h-6 border-t" style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg)' }} />;
  }

  return (
    <div
      className="flex h-6 select-none items-center gap-3 border-t px-3 text-[11px]"
      style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg)', color: 'var(--app-fg-muted)' }}
    >
      <span data-status-segment="cursor">Ln {line}, Col {col}</span>
      {cursorCount > 1 && (
        <span data-status-segment="cursors">{cursorCount} cursors</span>
      )}

      <button
        type="button"
        ref={langBtnRef}
        data-status-segment="language"
        onClick={() => { if (langBtnRef.current) setLangRect(langBtnRef.current.getBoundingClientRect()); }}
        className="hover:text-neutral-100"
      >
        {languageLabel(effectiveLanguageId(active))}
      </button>

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

      <button
        type="button"
        data-status-segment="wordwrap"
        onClick={() => toggleWordWrap()}
        className={wordWrap ? 'text-neutral-100' : 'opacity-50 hover:opacity-100'}
        title="Toggle Word Wrap (Alt+Z)"
      >
        Wrap
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
      {langRect && (
        <LanguagePopover
          currentEffectiveId={effectiveLanguageId(active)}
          hasOverride={active.languageId != null}
          anchorRect={langRect}
          onSelect={setActiveLanguage}
          onClose={() => setLangRect(null)}
        />
      )}
    </div>
  );
}
