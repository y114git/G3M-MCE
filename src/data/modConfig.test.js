import { describe, expect, it } from 'vitest';
import {
  buildModConfigData,
  createEmptyModConfig,
  localRelativePath,
  normalizeRelation,
  parseConfigJson,
  validateModConfig,
} from './modConfig';
const valid = () => ({
  ...createEmptyModConfig(),
  id: 'test_mod',
  name: 'Test',
  files: [
    {
      source: '${mod_path}/a.win',
      target: '${game_path}/data.win',
      type: 'overwrite',
    },
  ],
});
describe('G3M 2.0.0 contract', () => {
  it('resolves local and external paths with explicit null placeholders', () => {
    expect(localRelativePath('${mod_path}/readme.txt', null)).toBe(
      'readme.txt'
    );
    expect(localRelativePath('${game_path}/data.win', null)).toBeNull();
  });
  it('rejects final line breaks in IDs, aliases and hashes', () => {
    for (const config of [
      { ...valid(), id: 'test_mod\n' },
      { ...valid(), game: 'deltarune\r' },
      { ...valid(), dependencies: ['other\n'] },
      { ...valid(), placeholders: { ['assets\n']: '${mod_path}/assets' } },
      {
        ...valid(),
        files: [
          {
            ...valid().files[0],
            source_hash: 'sha256:' + 'a'.repeat(64) + '\n',
          },
        ],
      },
    ])
      expect(validateModConfig(config).length).toBeGreaterThan(0);
  });
  it('accepts uppercase HTTP schemes but rejects even empty URL credentials', () => {
    expect(
      validateModConfig({ ...valid(), homepage: 'HTTPS://example.org' })
    ).toEqual([]);
    expect(
      validateModConfig({ ...valid(), homepage: 'https://@example.org' }).length
    ).toBeGreaterThan(0);
  });
  it('preserves authors, custom games, ordered groups and relationships', () => {
    const config = {
      ...valid(),
      game: 'my_fangame',
      authors: ['One', 'Two'],
      placeholders: { assets: '${mod_path}/assets' },
      dependencies: ['required:before-step'],
      conflicts: ['other:after'],
      files: [
        {
          Group: [
            {
              source: '${assets}/a.win',
              target: '${game_path}/data.win',
              type: 'hard-overwrite',
              source_hash: 'sha256:' + 'a'.repeat(64),
            },
          ],
        },
      ],
    };
    expect(buildModConfigData(config)).toEqual(config);
    expect(Object.keys(buildModConfigData(config)).at(-1)).toBe('files');
  });
  it.each([
    ['id', 'self'],
    ['id', '1bad'],
    ['game', 'Some Game'],
    ['name', ' bad'],
    ['name', 'e\u0301'],
    ['authors', ['']],
    ['description', 'line\rline'],
    ['homepage', 'https://name:pass@example.org'],
    ['tags', ['gameplay', 'gameplay']],
    ['placeholders', { MOD_PATH: '${game_path}/x' }],
    ['placeholders', { X: '${mod_path}/x', x: '${mod_path}/y' }],
    ['dependencies', ['test_mod']],
    ['dependencies', ['other', 'other:before']],
    ['config_version', '3.0.0'],
    ['unexpected', true],
  ])('rejects invalid %s: %j', (key, value) => {
    expect(
      validateModConfig({ ...valid(), [key]: value }).length
    ).toBeGreaterThan(0);
  });
  it.each([
    '${mod_path}/../a',
    '${mod_path}//a',
    '${unknown}/a',
    '${game_path}',
    'relative/file',
    '//server/file',
    '${mod_path}/a\\b',
    '${game_path}/stream.lzma/file',
  ])('rejects unsafe source %s', (source) => {
    const config = valid();
    config.files[0].source = source;
    expect(validateModConfig(config).length).toBeGreaterThan(0);
  });
  it('rejects incompatible roots, empty arrays and duplicate group names', () => {
    const config = {
      ...valid(),
      tags: [],
      conflicts: ['same'],
      dependencies: ['same'],
      icon: '${game_path}/icon.png',
      files: [
        { G: [] },
        { G: [] },
        {
          source: '${mod_path}/readme.txt',
          target: '${game_path}/x',
          type: 'info',
        },
      ],
    };
    expect(validateModConfig(config).length).toBeGreaterThanOrEqual(5);
  });
  it('accepts all operation types, writable 7z targets and Unicode text', () => {
    const config = {
      ...valid(),
      name: '🎮 Тест',
      files: [
        'patch',
        'overwrite',
        'soft-overwrite',
        'hard-overwrite',
        'extract',
        'soft-extract',
        'hard-extract',
      ].map((type) => ({
        source: '${mod_path}/a',
        target:
          '${game_path}/x.7z/' +
          (type.endsWith('extract') ? 'folder/' : 'file'),
        type,
      })),
    };
    expect(validateModConfig(config)).toEqual([]);
  });
  it.each([
    '{"id":"a","id":"b"}',
    '{"nested":{"a":1,"a":2}}',
    '{"x":1,}',
    '[1]',
    '{"a":1} trailing',
    '{"a":1e999}',
  ])('rejects malformed or ambiguous JSON %s', (text) =>
    expect(() => parseConfigJson(text)).toThrow()
  );
  it('rejects deep and oversized JSON', () => {
    expect(() =>
      parseConfigJson('{"x":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}')
    ).toThrow();
    expect(() =>
      parseConfigJson('{"x":"' + 'a'.repeat(4 * 1024 * 1024) + '"}')
    ).toThrow();
  });
  it('preserves prototype-like JSON keys without prototype pollution', () =>
    expect(Object.keys(parseConfigJson('{"__proto__":{"x":1}}'))).toEqual([
      '__proto__',
    ]));
  it('reports oversized lists without overflowing the JavaScript argument stack', () => {
    expect(
      validateModConfig({ ...valid(), authors: Array(150000).fill('Author') })
        .length
    ).toBeGreaterThan(0);
  });
  it.each([
    ['https://gamebanana.com/mods/123', 'gb_mod_123'],
    [
      'https://www.gamebanana.com/wips/456:before-step',
      'gb_wip_456:before-step',
    ],
    ['mod_id:after', 'mod_id:after'],
    ['https://other.example/mods/123', 'https://other.example/mods/123'],
  ])('normalizes dependency %s', (input, output) =>
    expect(normalizeRelation(input)).toBe(output)
  );
});
