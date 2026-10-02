import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { importZipArchive, exportModArchive } from './zipHandler';
globalThis.DOMParser = DOMParser;
export async function deltamod(format = 'toml', xml) {
  const zip = new JSZip();
  const metadata = {
    metadata: {
      name: 'Test Mod',
      version: '2.0',
      author: ['One', 'Two'],
      game: 'toby.deltarune',
      packageID: 'test.mod.author',
    },
    deltaruneTargetVersion: '1.05',
  };
  zip.file(
    format === 'toml' ? 'meta.toml' : '_deltamodInfo.json',
    format === 'toml'
      ? 'deltaruneTargetVersion = "1.05"\n[metadata]\nname = "Test Mod"\nversion = "2.0"\nauthor = ["One", "Two"]\ngame = "toby.deltarune"\npackageID = "test.mod.author"\n'
      : JSON.stringify(metadata)
  );
  zip.file(
    'modding.xml',
    xml ||
      '<patches><patch type="xdelta" patch="./first.xdelta" to="./chapter5_windows/data.win"/><patch type="csx" patch="second.csx" to="chapter5_windows/data.win"/><patch type="copy" patch="readme.txt" to="chapter5_windows/lang/readme.txt"/><patch type="g3mpatch" patch="chapter4.g3mpatch" to="chapter4_windows/data.win"/></patches>'
  );
  for (const name of [
    'first.xdelta',
    'second.csx',
    'readme.txt',
    'chapter4.g3mpatch',
    'script/helper.cs',
  ])
    zip.file(name, name);
  return zip.generateAsync({ type: 'uint8array' });
}
describe('Deltamod conversion', () => {
  it.each(['json', 'toml'])(
    'converts mixed-case XML in a wrapped %s archive',
    async (format) => {
      const original = await JSZip.loadAsync(await deltamod(format));
      const wrapped = new JSZip();
      for (const entry of Object.values(original.files)) {
        if (entry.dir) continue;
        wrapped.file(
          'wrapper/' +
            (entry.name === 'modding.xml' ? 'Modding.XML' : entry.name),
          await entry.async('uint8array')
        );
      }
      const imported = await importZipArchive(
        await wrapped.generateAsync({ type: 'uint8array' })
      );
      expect(imported.config.files).toHaveLength(5);
      expect(imported.assets.files['Modding.XML']).toBeUndefined();
      const exported = await exportModArchive(imported);
      expect((await importZipArchive(exported)).config).toEqual(
        imported.config
      );
    }
  );
  it('converts Deltamod with a nested mod_config.json used by its payload', async () => {
    const zip = await JSZip.loadAsync(await deltamod('json'));
    zip.file('settings/mod_config.json', '{"game_setting":true}');
    const converted = await importZipArchive(
      await zip.generateAsync({ type: 'uint8array' })
    );
    expect(converted.format).toBe('deltamod');
    const exported = await JSZip.loadAsync(
      await (await exportModArchive(converted)).arrayBuffer()
    );
    expect(
      await exported.file('settings/mod_config.json').async('string')
    ).toBe('{"game_setting":true}');
  });
  it('preserves custom game IDs that coincide with JavaScript object properties', async () => {
    const zip = await JSZip.loadAsync(await deltamod('json'));
    const metadata = JSON.parse(
      await zip.file('_deltamodInfo.json').async('string')
    );
    metadata.metadata.game = 'constructor';
    zip.file('_deltamodInfo.json', JSON.stringify(metadata));
    const imported = await importZipArchive(
      await zip.generateAsync({ type: 'uint8array' })
    );
    expect(imported.config.game).toBe('constructor');
    await expect(exportModArchive(imported)).resolves.toBeInstanceOf(Blob);
  });
  it.each(['toml', 'json'])(
    'converts %s metadata and preserves every operation in order',
    async (format) => {
      const imported = await importZipArchive(await deltamod(format));
      expect(imported.config).toMatchObject({
        id: 'test_mod_author',
        authors: ['One', 'Two'],
        game: 'deltarune',
        game_version: '1.05',
      });
      expect(
        imported.config.files
          .slice(0, 4)
          .map((entry) => [entry.type, entry.target])
      ).toEqual([
        ['patch', '${game_path}/chapter5_windows/data.win'],
        ['patch', '${game_path}/chapter5_windows/data.win'],
        ['overwrite', '${game_path}/chapter5_windows/lang/readme.txt'],
        ['patch', '${game_path}/chapter4_windows/data.win'],
      ]);
      expect(imported.assets.files['script/helper.cs']).toBeDefined();
      const exported = await exportModArchive(imported);
      expect((await importZipArchive(exported)).config).toEqual(
        imported.config
      );
      expect(imported.assets.files['modding.xml']).toBeUndefined();
    }
  );
  it.each([
    '<patch type="unknown" patch="readme.txt" to="x"/>',
    '<patch type="copy" patch="missing.txt" to="x"/>',
    '<patch type="csx" patch="second.csx" to="../outside"/>',
    '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///secret">]><patch type="copy" patch="readme.txt" to="x"/>',
  ])(
    'rejects invalid patch declarations instead of exporting a partial mod',
    async (xml) =>
      await expect(
        importZipArchive(await deltamod('json', xml))
      ).rejects.toThrow()
  );
  it('keeps invalid converted metadata available for correction before export', async () => {
    const zip = await JSZip.loadAsync(await deltamod('json'));
    const metadata = JSON.parse(
      await zip.file('_deltamodInfo.json').async('string')
    );
    metadata.metadata.url = 'not-a-url';
    metadata.metadata.description = 'Needs\tcorrection';
    zip.file('_deltamodInfo.json', JSON.stringify(metadata));
    const imported = await importZipArchive(
      await zip.generateAsync({ type: 'uint8array' })
    );
    expect(imported.config.homepage).toBe('not-a-url');
    expect(imported.config.description).toBe('Needs\tcorrection');
    await expect(exportModArchive(imported)).rejects.toThrow();
    imported.config.homepage = 'https://example.org';
    imported.config.description = 'Corrected description';
    await expect(exportModArchive(imported)).resolves.toBeInstanceOf(Blob);
  });
});

it.each([
  ['other.frickbears3', false, '1.05', 'frickbears3'],
  [' Toby.Undertale ', false, '1.05', 'undertale'],
  [undefined, false, '1.05', 'deltarune'],
  [undefined, true, '1.05', 'deltarunedemo'],
  ['unsupported.game', true, '1.05', 'deltarunedemo'],
  ['unsupported.game', false, '1.05', 'deltarune'],
  [undefined, false, 'demo', 'deltarunedemo'],
])(
  'preserves Deltamod game selection for %s, demo=%s, version=%s',
  async (game, demoMod, version, expected) => {
    const zip = await JSZip.loadAsync(await deltamod('json'));
    const metadata = JSON.parse(
      await zip.file('_deltamodInfo.json').async('string')
    );
    metadata.metadata.game = game;
    metadata.metadata.demoMod = demoMod;
    metadata.deltaruneTargetVersion = version;
    zip.file('_deltamodInfo.json', JSON.stringify(metadata));
    const imported = await importZipArchive(
      await zip.generateAsync({ type: 'uint8array' })
    );
    expect(imported.config.game).toBe(expected);
    const exported = await exportModArchive(imported);
    expect((await importZipArchive(exported)).config.game).toBe(expected);
  }
);
