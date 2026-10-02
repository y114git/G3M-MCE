import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createEmptyModConfig } from '../data/modConfig';
import {
  emptyAssets,
  exportModArchive,
  hashPackagePath,
  importZipArchive,
  listPackageZipMembers,
  safePackagePath,
  validatePackage,
} from './zipHandler';
const config = () => ({
  ...createEmptyModConfig(),
  id: 'test_mod',
  name: 'Test Mod',
  files: [
    {
      source: '${mod_path}/patch.csx',
      target: '${game_path}/chapter5_windows/data.win',
      type: 'patch',
    },
  ],
});
const bytes = (text) => new TextEncoder().encode(text);
const archive = async (manifest, files = {}, root = '') => {
  const zip = new JSZip();
  zip.file(
    root + 'mod_config.json',
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  );
  for (const [path, data] of Object.entries(files)) zip.file(root + path, data);
  return zip.generateAsync({ type: 'uint8array' });
};
describe('G3M ZIP import and export', () => {
  it.each(['meta.json', 'meta.toml', '_deltamodInfo.json'])(
    'blocks root %s that would make G3M misidentify the exported package',
    async (name) => {
      const assets = {
        files: { 'patch.csx': bytes('script'), [name]: bytes('{}') },
        directories: [],
      };
      await expect(
        exportModArchive({ config: config(), assets })
      ).rejects.toThrow(/Deltamod/);
      delete assets.files[name];
      assets.files['settings/' + name] = bytes('{}');
      await expect(
        exportModArchive({ config: config(), assets })
      ).resolves.toBeInstanceOf(Blob);
    }
  );
  it('exports external sources when optional placeholders are explicitly null', async () => {
    const current = {
      ...config(),
      placeholders: null,
      files: [
        {
          source: '${game_path}/original.win',
          target: '${game_path}/data.win',
          type: 'overwrite',
        },
      ],
    };
    const blob = await exportModArchive({
      config: current,
      assets: emptyAssets(),
    });
    expect((await importZipArchive(blob)).config).toEqual(current);
  });
  it('round trips ordered groups, hashes, icons, documentation and unlisted CSX dependencies', async () => {
    const assets = {
      files: {
        'patch.csx': bytes('script'),
        'lib/helper.cs': bytes('dependency'),
        'icon.png': bytes('image'),
        'readme.md': bytes('text'),
      },
      directories: ['lib/', 'empty/'],
    };
    const current = {
      ...config(),
      authors: ['One', 'Two'],
      icon: '${mod_path}/icon.png',
      placeholders: { scripts: '${mod_path}/lib' },
      dependencies: ['base:before-step'],
      conflicts: ['other'],
      files: [
        { Scripts: config().files },
        { source: '${mod_path}/readme.md', type: 'info' },
      ],
    };
    current.files[0].Scripts[0].source_hash = await hashPackagePath(
      '${mod_path}/patch.csx',
      assets
    );
    const exported = await exportModArchive({ config: current, assets });
    const imported = await importZipArchive(exported);
    expect(imported.config).toEqual(current);
    expect(Object.keys(imported.assets.files).sort()).toEqual(
      Object.keys(assets.files).sort()
    );
    expect(imported.assets.files['lib/helper.cs']).toEqual(bytes('dependency'));
    expect(imported.assets.directories).toContain('empty/');
  });
  it('unwraps one enclosing folder without changing config-relative paths', async () => {
    const imported = await importZipArchive(
      await archive(config(), { 'patch.csx': 'script' }, 'enclosing/mod/')
    );
    expect(imported.config).toEqual(config());
    expect(Object.keys(imported.assets.files)).toEqual(['patch.csx']);
  });
  it('opens a wrapped macOS archive without bundling Finder metadata', async () => {
    const zip = new JSZip();
    zip.file('mod/mod_config.json', JSON.stringify(config()));
    zip.file('mod/patch.csx', 'script');
    zip.file('__MACOSX/mod/._patch.csx', 'Finder metadata');
    const imported = await importZipArchive(
      await zip.generateAsync({ type: 'uint8array' })
    );
    expect(imported.config).toEqual(config());
    expect(Object.keys(imported.assets.files)).toEqual(['patch.csx']);
    await expect(exportModArchive(imported)).resolves.toBeInstanceOf(Blob);
  });
  it('reports files outside a single manifest folder as ambiguous', async () => {
    const zip = new JSZip();
    zip.file('mod/mod_config.json', JSON.stringify(config()));
    zip.file('outside.txt', 'unrelated');
    await expect(
      importZipArchive(await zip.generateAsync({ type: 'uint8array' }))
    ).rejects.toThrow(
      'Files outside the mod folder make this archive ambiguous.'
    );
  });
  it('migrates older fields and chapter packaging without losing dependency targets', async () => {
    const legacy = {
      metadata: {
        key: 'old_mod',
        name: 'Old',
        author: 'Tester',
        version: '1.0',
        game: 'deltarune',
        tagline: 'Description',
      },
      files: {
        5: {
          data_file_url: 'patch.csx',
          extra_files: [
            { url: 'language.txt', status: 'install' },
            { file_path: 'dependency.cs', target: 'dependency' },
            { file_path: 'towers.zip', target: 'data' },
          ],
        },
      },
      info_files: { 'readme.txt': 'show', 'license.txt': 'hide' },
    };
    const imported = await importZipArchive(
      await archive(legacy, {
        'chapter_5/patch.csx': 'script',
        'chapter_5/language.txt': 'text',
        'chapter_5/dependency.cs': 'dependency',
        'chapter_5/towers.zip': 'archive',
        'readme.txt': 'docs',
        'license.txt': 'license',
      })
    );
    expect(imported.config.config_version).toBe('2.0.0');
    expect(imported.config.files).toEqual([
      {
        source: '${mod_path}/chapter_5/patch.csx',
        target: '${game_path}/chapter5_windows/data.win',
        type: 'patch',
      },
      {
        source: '${mod_path}/chapter_5/language.txt',
        target: '${game_path}/chapter5_windows/language.txt',
        type: 'overwrite',
      },
      {
        source: '${mod_path}/chapter_5/towers.zip',
        target: '${game_data_path}/',
        type: 'extract',
      },
      { source: '${mod_path}/readme.txt', type: 'info' },
    ]);
    expect(imported.assets.files['chapter_5/dependency.cs']).toBeDefined();
    await expect(exportModArchive(imported)).resolves.toBeInstanceOf(Blob);
  });
  it('preserves current config values instead of truncating or replacing custom games', async () => {
    const current = {
      ...config(),
      name: 'a'.repeat(128),
      version: 'v'.repeat(128),
      game: 'custom_game',
    };
    expect(
      (
        await importZipArchive(
          await archive(current, { 'patch.csx': 'script' })
        )
      ).config
    ).toEqual(current);
  });
  it.each([
    '../outside.txt',
    '/absolute.txt',
    'C:/file.txt',
    'a\\file.txt',
    'nul.txt',
    'A/../file',
    'x./file',
    'x//file',
  ])('rejects unsafe package name %s', (path) =>
    expect(() => safePackagePath(path)).toThrow()
  );
  it('rejects traversal before JSZip sanitizes it', async () => {
    const input = await archive(config(), { '../outside.txt': 'unsafe' });
    await expect(importZipArchive(input)).rejects.toThrow();
  });
  it('rejects duplicate manifests and case-insensitive collisions', async () => {
    const ambiguous = new JSZip();
    ambiguous.file('one/mod_config.json', '{}');
    ambiguous.file('two/mod_config.json', '{}');
    await expect(
      importZipArchive(await ambiguous.generateAsync({ type: 'uint8array' }))
    ).rejects.toThrow(/more than one/);
    await expect(
      importZipArchive(await archive(config(), { 'A.txt': 'a', 'a.txt': 'b' }))
    ).rejects.toThrow(/Duplicate/);
  });
  it('rejects symlinks', async () => {
    const zip = new JSZip();
    zip.file('mod_config.json', JSON.stringify(config()));
    zip.file('link', 'target', { unixPermissions: 0o120777 });
    await expect(
      importZipArchive(
        await zip.generateAsync({ type: 'uint8array', platform: 'UNIX' })
      )
    ).rejects.toThrow(/links/);
  });
  it('rejects duplicate JSON keys and future config versions', async () => {
    await expect(
      importZipArchive(await archive('{"id":"a","id":"b"}'))
    ).rejects.toThrow(/Duplicate JSON/);
    await expect(
      importZipArchive(await archive({ ...config(), config_version: '3.0.0' }))
    ).rejects.toThrow(/Unsupported/);
  });
  it('blocks export with missing sources, manifest overwrites and mismatching hashes', async () => {
    await expect(
      exportModArchive({ config: config(), assets: emptyAssets() })
    ).rejects.toThrow(/Missing/);
    await expect(
      exportModArchive({
        config: config(),
        assets: { files: { 'mod_config.json': bytes('{}') }, directories: [] },
      })
    ).rejects.toThrow(/editor writes/);
    const current = config();
    current.files[0].source_hash = 'sha256:' + '0'.repeat(64);
    await expect(
      exportModArchive({
        config: current,
        assets: { files: { 'patch.csx': bytes('script') }, directories: [] },
      })
    ).rejects.toThrow(/does not match/);
  });
  it('hashes empty folders and nested files consistently', async () => {
    const assets = {
      files: { 'root/a.txt': bytes('hello'), 'root/sub/é.txt': bytes('world') },
      directories: ['root/', 'root/sub/', 'root/empty/'],
    };
    expect(await hashPackagePath('${mod_path}/root/', assets)).toMatch(
      /^sha256:[a-f0-9]{64}$/
    );
    expect(await hashPackagePath('${mod_path}/root/empty/', assets)).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
  it('validates and hashes ZIP roots, folders and individual members', async () => {
    const nested = new JSZip();
    nested.file('folder/readme.md', 'hello');
    nested.folder('empty');
    const assets = {
      files: {
        'assets.zip': await nested.generateAsync({ type: 'uint8array' }),
      },
      directories: [],
    };
    expect(
      await hashPackagePath('${mod_path}/assets.zip/folder/readme.md', assets)
    ).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
    expect(await hashPackagePath('${mod_path}/assets.zip/', assets)).toMatch(
      /^sha256:/
    );
    await expect(
      exportModArchive({
        config: {
          ...config(),
          files: [
            {
              source: '${mod_path}/assets.zip/',
              target: '${game_path}/assets/',
              type: 'extract',
            },
          ],
        },
        assets,
      })
    ).resolves.toBeInstanceOf(Blob);
    const current = {
      ...config(),
      files: [
        { source: '${mod_path}/assets.zip/folder/readme.md', type: 'info' },
      ],
    };
    await expect(
      exportModArchive({ config: current, assets })
    ).resolves.toBeInstanceOf(Blob);
    current.files[0].source = '${mod_path}/assets.zip/missing.md';
    await expect(exportModArchive({ config: current, assets })).rejects.toThrow(
      /Missing ZIP member/
    );
  });
  it('rejects folder case conflicts before creating an invalid export', async () => {
    const assets = {
      files: {
        'patch.csx': bytes('script'),
        'A/one.txt': bytes('a'),
        'a/two.txt': bytes('b'),
      },
      directories: [],
    };
    await expect(
      exportModArchive({ config: config(), assets })
    ).rejects.toThrow(/path case/);
  });
  it('creates importable ZIPs even for highly compressible files', async () => {
    const assets = {
      files: {
        'patch.csx': bytes('script'),
        'zeros.bin': new Uint8Array(1024 * 1024),
      },
      directories: [],
    };
    const blob = await exportModArchive({ config: config(), assets });
    expect(
      (await importZipArchive(blob)).assets.files['zeros.bin'].byteLength
    ).toBe(1024 * 1024);
  });
  it('keeps nested configuration files used by the mod payload', async () => {
    const imported = await importZipArchive(
      await archive(config(), {
        'patch.csx': 'script',
        'game_settings/mod_config.json': '{"game_setting":true}',
      })
    );
    expect(
      new TextDecoder().decode(
        imported.assets.files['game_settings/mod_config.json']
      )
    ).toBe('{"game_setting":true}');
    expect(
      (await importZipArchive(await exportModArchive(imported))).assets.files[
        'game_settings/mod_config.json'
      ]
    ).toEqual(imported.assets.files['game_settings/mod_config.json']);
  });
  it('lists implied ZIP directories without requiring explicit directory records', async () => {
    const zip = new JSZip();
    zip.file('folder/sub/readme.md', 'hello', { createFolders: false });
    const assets = {
      files: { 'assets.zip': await zip.generateAsync({ type: 'uint8array' }) },
      directories: [],
    };
    expect(await listPackageZipMembers('assets.zip', assets)).toEqual(
      expect.arrayContaining([
        'assets.zip/',
        'assets.zip/folder/',
        'assets.zip/folder/sub/',
        'assets.zip/folder/sub/readme.md',
      ])
    );
    await expect(
      exportModArchive({
        config: {
          ...config(),
          files: [
            {
              source: '${mod_path}/assets.zip/folder/',
              target: '${game_path}/docs/',
              type: 'extract',
            },
          ],
        },
        assets,
      })
    ).resolves.toBeInstanceOf(Blob);
  });
  it('opens invalid legacy metadata for correction and clips Unicode by code points', async () => {
    const imported = await importZipArchive(
      await archive({
        key: 'Old.Mod',
        name: 'Old',
        game: 'undertale',
        author: '   ',
        description: '🎮'.repeat(201),
        files: {},
      })
    );
    expect(imported.config.id).toBe('Old.Mod');
    expect(imported.config.authors).toEqual([]);
    expect(imported.config.description).toBe('🎮'.repeat(200));
    await expect(exportModArchive(imported)).rejects.toThrow();
    imported.config.id = 'old_mod';
    await expect(exportModArchive(imported)).resolves.toBeInstanceOf(Blob);
  });
});

it('reports all missing payloads and hash mismatches against their exact fields', async () => {
  const manifest = {
    ...config(),
    icon: '${mod_path}/missing.png',
    files: [
      {
        'Group.[7]': [
          { ...config().files[0], source: '${mod_path}/missing.csx' },
          { ...config().files[0], source_hash: 'sha256:' + '0'.repeat(64) },
        ],
      },
    ],
  };
  const assets = emptyAssets();
  assets.files['patch.csx'] = bytes('script');
  await expect(validatePackage(manifest, assets)).rejects.toMatchObject({
    issues: [
      { path: 'icon', message: 'Missing bundled source: missing.png' },
      {
        path: 'files[0].Group.[7][0].source',
        message: 'Missing bundled source: missing.csx',
      },
      {
        path: 'files[0].Group.[7][1].source_hash',
        message: 'Source hash does not match: ${mod_path}/patch.csx',
      },
    ],
  });
  await expect(
    validatePackage(
      {
        ...manifest,
        icon: undefined,
        files: [manifest.files[0]['Group.[7]'][1]],
      },
      assets,
      false
    )
  ).resolves.toBeUndefined();
  const exportConfig = { ...manifest };
  delete exportConfig.icon;
  await expect(
    exportModArchive({ config: exportConfig, assets })
  ).rejects.toThrow('Missing bundled source');
});
