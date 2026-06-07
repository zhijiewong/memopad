import { describe, it, expect } from 'vitest';
import {
  LANGUAGES,
  PLAIN_ID,
  detectLanguageId,
  languageExtensionsById,
  languageLabel,
  effectiveLanguageId,
} from '../lib/language';

describe('detectLanguageId', () => {
  it('detects by extension', () => {
    expect(detectLanguageId('/a/script.py')).to.equal('python');
    expect(detectLanguageId('C:\\proj\\app.tsx')).to.equal('tsx');
    expect(detectLanguageId('conf.yml')).to.equal('yaml');
    expect(detectLanguageId('main.rs')).to.equal('rust');
  });
  it('is case-insensitive on extension', () => {
    expect(detectLanguageId('/a/MAIN.PY')).to.equal('python');
  });
  it('detects by exact filename before extension', () => {
    expect(detectLanguageId('/repo/Dockerfile')).to.equal('dockerfile');
    expect(detectLanguageId('/repo/CMakeLists.txt')).to.equal('cmake');
  });
  it('falls back to plain for unknown ext and null path', () => {
    expect(detectLanguageId('/a/file.unknownext')).to.equal(PLAIN_ID);
    expect(detectLanguageId('/a/noext')).to.equal(PLAIN_ID);
    expect(detectLanguageId(null)).to.equal(PLAIN_ID);
  });
});

describe('effectiveLanguageId', () => {
  it('uses the override when set', () => {
    expect(effectiveLanguageId({ languageId: 'java', path: '/a/x.py' })).to.equal('java');
  });
  it('falls back to detection when override is null/absent', () => {
    expect(effectiveLanguageId({ languageId: null, path: '/a/x.py' })).to.equal('python');
    expect(effectiveLanguageId({ path: '/a/x.py' })).to.equal('python');
  });
});

describe('languageExtensionsById / languageLabel', () => {
  it('returns [] for plain and unknown ids', () => {
    expect(languageExtensionsById(PLAIN_ID)).to.deep.equal([]);
    expect(languageExtensionsById('nope')).to.deep.equal([]);
  });
  it('labels plain and unknown as Plain Text', () => {
    expect(languageLabel(PLAIN_ID)).to.equal('Plain Text');
    expect(languageLabel('nope')).to.equal('Plain Text');
    expect(languageLabel('python')).to.equal('Python');
  });
});

describe('registry integrity (import-safety net)', () => {
  it('has unique ids and lowercase ext/filenames', () => {
    const ids = LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).to.equal(ids.length);
    for (const l of LANGUAGES) {
      for (const e of l.extensions ?? []) expect(e).to.equal(e.toLowerCase());
      for (const f of l.filenames ?? []) expect(f).to.equal(f.toLowerCase());
    }
  });
  it('every load() resolves and yields a non-empty extension (except plain)', () => {
    for (const l of LANGUAGES) {
      const ext = l.load();
      if (l.id === PLAIN_ID) {
        expect(ext).to.deep.equal([]);
      } else {
        expect(ext, `${l.id} load()`).to.be.an('array').with.length.greaterThan(0);
      }
    }
  });
});
