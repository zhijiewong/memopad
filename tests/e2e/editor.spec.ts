import { expect } from 'chai';
import { readTitleBarText, setEditorContent, getEditorContent, resetBuffer } from './support/helpers';

describe('editor + dirty state', () => {
  beforeEach(async () => {
    await resetBuffer();
  });

  it('starts at Untitled with no dirty dot', async () => {
    const tb = await readTitleBarText();
    expect(tb.name).to.equal('Untitled');
    expect(tb.dirty).to.equal(false);
    expect(await getEditorContent()).to.equal('');
  });

  it('marks dirty when content is typed', async () => {
    await setEditorContent('abc');
    const tb = await readTitleBarText();
    expect(tb.dirty).to.equal(true);
    expect(await getEditorContent()).to.equal('abc');
  });

  it('resetBuffer (mirrors Ctrl+N) clears content and dirty', async () => {
    await setEditorContent('dirty stuff');
    expect((await readTitleBarText()).dirty).to.equal(true);
    await resetBuffer();
    const tb = await readTitleBarText();
    expect(tb.name).to.equal('Untitled');
    expect(tb.dirty).to.equal(false);
    expect(await getEditorContent()).to.equal('');
  });
});
