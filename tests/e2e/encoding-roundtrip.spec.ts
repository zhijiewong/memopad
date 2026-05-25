import { expect } from 'chai';
import { openFile, saveFile, prepareFixture, readBytes, resetBuffer } from './support/helpers';

describe('UTF-16 LE BOM round-trip (spec acceptance #3)', () => {
  beforeEach(async () => {
    await resetBuffer();
  });

  it('open -> edit -> save preserves the BOM and decoded content', async () => {
    const path = prepareFixture('utf16le-bom.txt');
    const opened = await openFile(path);
    expect(opened.encoding).to.equal('utf16-le');
    expect(opened.content).to.equal('hi\n');

    const edited = opened.content + 'world\n';
    await saveFile(path, edited, opened.encoding, opened.eol);

    const after = readBytes(path);
    // Bytes 0-1 must still be the UTF-16 LE BOM.
    expect(after[0]).to.equal(0xFF);
    expect(after[1]).to.equal(0xFE);
    // No UTF-8 BOM was substituted:
    expect(after[0]).to.not.equal(0xEF);

    // Decoded payload contains both original and new content.
    const decoded = after.slice(2).toString('utf16le');
    expect(decoded).to.include('hi');
    expect(decoded).to.include('world');

    // And reopening yields the edited content with same encoding.
    const reopened = await openFile(path);
    expect(reopened.content).to.equal(edited);
    expect(reopened.encoding).to.equal('utf16-le');
  });
});
