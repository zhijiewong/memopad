import { expect } from 'chai';
import { saveFile, prepareFixture, readBytes, resetBuffer } from './support/helpers';
import * as path from 'node:path';

describe('save-as semantics', () => {
  beforeEach(async () => {
    await resetBuffer();
  });

  it('save_file to a new path creates that file and leaves the original untouched', async () => {
    const original = prepareFixture('utf16le-bom.txt');
    const originalBytesBefore = readBytes(original);

    // Simulate "save as" to a new path within the same temp dir
    const newPath = path.join(path.dirname(original), 'saved-as.txt');
    await saveFile(newPath, 'save-as test\n', 'utf-8', 'lf');

    // New file exists with the content we wrote
    const newBytes = readBytes(newPath);
    expect(newBytes.equals(Buffer.from('save-as test\n', 'utf8'))).to.equal(true);

    // Original was not modified (still has BOM + original content)
    const originalBytesAfter = readBytes(original);
    expect(originalBytesAfter.equals(originalBytesBefore)).to.equal(true);
    expect(originalBytesAfter[0]).to.equal(0xFF);
    expect(originalBytesAfter[1]).to.equal(0xFE);
  });
});
