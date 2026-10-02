import { describe, expect, it } from 'vitest';
import { assetsFromFiles, droppedAssets, packageRoot } from './fileDrop';

const file = (name) => new File(['payload'], name);
const item = (entry, picked = null) => ({
  kind: 'file',
  webkitGetAsEntry: () => entry,
  getAsFile: () => picked,
});
const leaf = (name) => ({
  isFile: true,
  name,
  file: (resolve) => resolve(file(name)),
});
const folder = (name, batches) => ({
  isDirectory: true,
  name,
  createReader: () => {
    let index = 0;
    return { readEntries: (resolve) => resolve(batches[index++] || []) };
  },
});
const transfer = (...items) => ({ items, files: [] });

describe('dropped files and folders', () => {
  it('captures all handles before awaiting and reads every directory batch, preserving empty folders', async () => {
    const data = transfer(
      item(
        folder('payload', [
          [leaf('one.txt')],
          [folder('empty', []), leaf('two.txt')],
        ])
      ),
      item(null, file('root.txt'))
    );
    const reading = droppedAssets(data);
    data.items.length = 0;
    const assets = await reading;
    expect(Object.keys(assets.files)).toEqual([
      'payload/one.txt',
      'payload/two.txt',
      'root.txt',
    ]);
    expect(assets.directories).toEqual(['payload/', 'payload/empty/']);
    expect(packageRoot(assets)).toBeNull();
    delete assets.files['root.txt'];
    expect(packageRoot(assets)).toBe('payload/');
  });
  it('keeps directory structure from the file selector fallback', async () => {
    const picked = file('one.txt');
    Object.defineProperty(picked, 'webkitRelativePath', {
      value: 'folder/sub/one.txt',
    });
    const assets = await droppedAssets({ items: [], files: [picked] });
    expect(assets.directories).toEqual(['folder/', 'folder/sub/']);
    expect(packageRoot(assets)).toBe('folder/');
    expect(assets.files['folder/sub/one.txt']).toBe(picked);
  });
  it.each(['../outside.txt', 'CON.txt', 'unsafe\\name.txt'])(
    'rejects unsafe dropped paths: %s',
    async (name) => {
      await expect(droppedAssets(transfer(item(leaf(name))))).rejects.toThrow(
        'Unsafe archive path'
      );
    }
  );
  it('rejects duplicate files instead of overwriting them', async () => {
    expect(() => assetsFromFiles([file('same.txt'), file('same.txt')])).toThrow(
      'Duplicate'
    );
    await expect(
      droppedAssets(transfer(item(leaf('same.txt')), item(leaf('same.txt'))))
    ).rejects.toThrow('Duplicate');
  });
  it('rejects oversized files before reading their contents', async () => {
    const picked = file('large.bin');
    Object.defineProperty(picked, 'size', { value: 512 * 1024 * 1024 + 1 });
    await expect(droppedAssets(transfer(item(null, picked)))).rejects.toThrow(
      'size limit'
    );
    await expect(droppedAssets({ items: [], files: [picked] })).rejects.toThrow(
      'size limit'
    );
    expect(() => assetsFromFiles([picked])).toThrow('size limit');
  });
  it('enforces the total size limit in the file selector fallback', () => {
    const files = ['one.bin', 'two.bin', 'three.bin'].map(file);
    for (const picked of files)
      Object.defineProperty(picked, 'size', { value: 512 * 1024 * 1024 });
    expect(() => assetsFromFiles(files)).toThrow('size limit');
  });
  it('counts folders as entries in the file selector fallback', () => {
    const files = Array.from({ length: 5001 }, (_, index) => {
      const picked = file('one.txt');
      Object.defineProperty(picked, 'webkitRelativePath', {
        value: `folder-${index}/one.txt`,
      });
      return picked;
    });
    expect(() => assetsFromFiles(files)).toThrow('Too many');
  });
  it('propagates unreadable directory failures without returning a partial package', async () => {
    const entry = {
      isDirectory: true,
      name: 'folder',
      createReader: () => ({
        readEntries: (_, reject) => reject(new Error('No access')),
      }),
    };
    await expect(droppedAssets(transfer(item(entry)))).rejects.toThrow(
      'No access'
    );
  });
});
