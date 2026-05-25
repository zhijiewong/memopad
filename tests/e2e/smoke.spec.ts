import { expect } from 'chai';
import { readTitleBarText } from './support/helpers';

describe('harness smoke', () => {
  it('launches Memopad and shows the empty-state title bar', async () => {
    const tb = await readTitleBarText();
    expect(tb.name).to.equal('Untitled');
    expect(tb.dirty).to.equal(false);
  });
});
