import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import {
  buildModConfigData,
  createEmptyModConfig,
  validateModConfig,
} from '../data/modConfig';
import { migrateModConfig } from './migrationService';
import {
  exportModArchive,
  hashPackagePath,
  importZipArchive,
} from './zipHandler';
const g3mRoot = process.env.G3M_ROOT || resolve('../G3M');
const python =
  process.env.G3M_PYTHON ||
  resolve(
    g3mRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  );
const bytes = (text) => new TextEncoder().encode(text);
const encodeFiles = (files) =>
  Object.fromEntries(
    Object.entries(files).map(([path, data]) => [
      path,
      Buffer.from(data).toString('base64'),
    ])
  );
const base = () => ({
  ...createEmptyModConfig(),
  id: 'contract_mod',
  name: 'Contract',
  authors: ['Tester'],
  files: [
    {
      source: '${mod_path}/patch.csx',
      target: '${game_path}/data.win',
      type: 'patch',
    },
  ],
});
const enabled =
  existsSync(python) && existsSync(resolve(g3mRoot, 'src/utils/mod/config.py'));

describe.skipIf(!enabled)(
  'actual G3M validation, migration and library import',
  () => {
    it('still rejects a contract disagreement under optimized Python', () => {
      const result = spawnSync(
        python,
        ['-O', resolve('scripts/g3m_contract.py'), g3mRoot],
        {
          input: JSON.stringify({
            configs: [
              { label: 'deliberate invalid config', config: {}, valid: true },
            ],
          }),
          encoding: 'utf8',
          timeout: 60000,
        }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('deliberate invalid config');
    }, 70000);
    it('accepts web exports, keeps payloads byte-exact and agrees on validation and migration', async () => {
      const request = { configs: [], legacy: [], archives: [], hashes: [] };
      const candidate = (label, config) =>
        request.configs.push({
          label,
          config,
          valid: !validateModConfig(config).length,
        });
      candidate('basic', base());
      for (const hash of [
        'sha256:' + 'a'.repeat(64),
        'sha256:' + 'a'.repeat(64) + '\n',
      ]) {
        candidate('source hash ' + JSON.stringify(hash), {
          ...base(),
          files: [{ ...base().files[0], source_hash: hash }],
        });
      }
      for (const [key, values] of Object.entries({
        id: ['self', '1bad', 'valid_id', 'valid_id\n', null],
        name: ['', 'a'.repeat(128), 'a'.repeat(129), 'e\u0301', 'é', '🎮'],
        authors: [[], ['a'], [''], null],
        homepage: [
          'https://example.org',
          'https://user:pass@example.org',
          'https://example.org:99999',
          'HTTPS://example.org',
          'https://@example.org',
          'https://:@example.org',
          'http://',
        ],
        description: ['line\nline', 'line\rline', '\ttext'],
        dependencies: [
          [],
          ['other'],
          ['contract_mod'],
          ['other:before-priority'],
          ['other:nope'],
          ['other\n'],
          null,
        ],
        placeholders: [
          {},
          { X: '${mod_path}/x' },
          { X: '${X}/x' },
          { ['X\n']: '${mod_path}/x' },
          null,
        ],
        icon: [
          '${mod_path}/icon.png',
          '${game_path}/icon.png',
          'https://example.org/icon.png',
          'HTTPS://example.org/icon.png',
        ],
      })) {
        for (const value of values)
          candidate(`${key}: ${JSON.stringify(value)}`, {
            ...base(),
            [key]: value,
          });
      }
      for (const type of [
        'patch',
        'overwrite',
        'soft-overwrite',
        'hard-overwrite',
        'extract',
        'soft-extract',
        'hard-extract',
        'info',
        'unknown',
      ]) {
        const entry =
          type === 'info'
            ? { source: '${mod_path}/readme.md', type }
            : {
                source: '${mod_path}/payload',
                target:
                  '${game_path}/' +
                  (type.endsWith('extract') ? 'folder/' : 'data.win'),
                type,
              };
        candidate(type, { ...base(), files: [entry] });
      }
      for (const source of [
        '${mod_path}/a',
        '${mod_path}/../a',
        '${missing}/a',
        '/absolute/file',
        '//server/file',
        '${mod_path}/a.zip/b',
        '${mod_path}/a.lzma/b',
        '${mod_path}/a.rar/b',
        '${mod_path}/a.7z/b',
      ])
        candidate(source, {
          ...base(),
          files: [{ source, target: '${game_path}/a', type: 'overwrite' }],
        });
      for (let depth = 29; depth <= 33; depth++) {
        let files = base().files;
        for (let i = 0; i < depth; i++) files = [{ ['Group ' + i]: files }];
        candidate(`group depth ${depth}`, { ...base(), files });
      }
      const assets = {
        files: {
          'patch.csx': bytes('script'),
          'docs/readme.md': bytes('Documentation'),
          'lib/helper.cs': bytes('dependency'),
          'icon.png': bytes('image'),
          'payload/a.txt': bytes('hello'),
          'payload/sub/é.txt': bytes('world'),
        },
        directories: [
          'docs/',
          'lib/',
          'payload/',
          'payload/sub/',
          'payload/empty/',
        ],
      };
      const current = {
        ...base(),
        authors: ['One', 'Two'],
        icon: '${mod_path}/icon.png',
        placeholders: { docs: '${mod_path}/docs' },
        dependencies: ['base:before-step'],
        conflicts: ['other:after'],
        files: [
          { Scripts: base().files },
          { source: '${docs}/readme.md', type: 'info' },
        ],
      };
      current.files[0].Scripts[0].source_hash = await hashPackagePath(
        '${mod_path}/patch.csx',
        assets
      );
      const folderHash = await hashPackagePath('${mod_path}/payload/', assets);
      request.hashes.push({
        files: encodeFiles(assets.files),
        directories: assets.directories,
        relative: 'payload',
        expected: folderHash,
      });
      const addArchive = async (label, config, assets) => {
        if (!config.icon && assets.files['icon.png'])
          config = { ...config, icon: '${mod_path}/icon.png' };
        const blob = await exportModArchive({ config, assets });
        request.archives.push({
          label,
          config: buildModConfigData(config),
          files: encodeFiles(assets.files),
          base64: Buffer.from(await blob.arrayBuffer()).toString('base64'),
          directories: assets.directories,
        });
      };
      await addArchive('current grouped config', current, assets);
      await addArchive(
        'empty folder operation',
        {
          ...base(),
          files: [
            {
              source: '${mod_path}/empty/',
              target: '${game_path}/empty/',
              type: 'extract',
            },
          ],
        },
        { files: {}, directories: ['empty/'] }
      );
      await addArchive(
        'prototype-like file names and custom game ID',
        {
          ...base(),
          game: 'constructor',
          files: [
            {
              source: '${mod_path}/__proto__',
              target: '${game_path}/data.win',
              type: 'overwrite',
            },
          ],
        },
        {
          files: Object.fromEntries([['__proto__', bytes('Payload')]]),
          directories: [],
        }
      );
      await addArchive(
        'null optional fields with an external source',
        {
          ...base(),
          placeholders: null,
          dependencies: null,
          conflicts: null,
          files: [
            {
              source: '${game_path}/original.win',
              target: '${game_path}/data.win',
              type: 'overwrite',
            },
          ],
        },
        assets
      );
      await addArchive(
        'all operations',
        {
          ...base(),
          id: 'all_operations',
          files: [
            'patch',
            'overwrite',
            'soft-overwrite',
            'hard-overwrite',
            'extract',
            'soft-extract',
            'hard-extract',
            'info',
          ].map((type) =>
            type === 'info'
              ? { source: '${mod_path}/docs/readme.md', type }
              : {
                  source:
                    '${mod_path}/' +
                    (type.endsWith('extract') ? 'payload/' : 'patch.csx'),
                  target:
                    '${game_path}/' +
                    (type.endsWith('extract') ? 'folder/' : 'data.win'),
                  type,
                }
          ),
        },
        assets
      );
      const oldAssets = {
        files: {
          'chapter_5/patch.csx': bytes('script'),
          'chapter_5/language.txt': bytes('text'),
          'chapter_5/dependency.cs': bytes('dependency'),
          'readme.txt': bytes('docs'),
        },
        directories: ['chapter_5/'],
      };
      for (const version of [undefined, '1.0.0']) {
        const data = {
          ...(version ? { config_version: version } : {}),
          metadata: {
            key: 'legacy_mod',
            name: 'Legacy',
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
              ],
            },
          },
          info_files: { 'readme.txt': 'show' },
        };
        const expected = migrateModConfig(data, oldAssets);
        request.legacy.push({
          label: `legacy ${version || 'unversioned'}`,
          data,
          files: encodeFiles(oldAssets.files),
          directories: oldAssets.directories,
          expected,
        });
        await addArchive(
          `legacy ${version || 'unversioned'}`,
          expected,
          oldAssets
        );
      }
      for (const game of [
        'deltarunedemo',
        'undertale',
        'undertaleyellow',
        'pizzatower',
        'sugaryspire',
        'frickbears3',
        'custom_game',
        'constructor',
      ]) {
        const data = {
          id: 'legacy_' + game,
          name: 'Legacy',
          author: 'Tester',
          version: '1.0',
          game,
          files: { [game]: { extra_files: ['payload/'] } },
        };
        const expected = migrateModConfig(data, assets);
        request.legacy.push({
          label: game,
          data,
          files: encodeFiles(assets.files),
          directories: assets.directories,
          expected,
        });
        await addArchive(game, expected, assets);
      }
      globalThis.DOMParser = DOMParser;
      for (const format of ['json', 'toml']) {
        const zip = new JSZip();
        zip.file(
          format === 'json' ? '_deltamodInfo.json' : 'meta.toml',
          format === 'json'
            ? JSON.stringify({
                metadata: {
                  name: 'Deltamod',
                  packageID: 'delta.mod',
                  author: ['One'],
                  game: 'toby.deltarune',
                },
              })
            : '[metadata]\nname="Deltamod"\npackageID="delta.mod"\nauthor=["One"]\ngame="toby.deltarune"'
        );
        zip.file(
          format === 'json' ? 'Modding.XML' : 'modding.xml',
          '<patches><patch type="xdelta" patch="first.xdelta" to="chapter1_windows/data.win"/><patch type="csx" patch="second.csx" to="chapter1_windows/data.win"/><patch type="copy" patch="language.txt" to="chapter1_windows/language.txt"/></patches>'
        );
        zip.file('settings/mod_config.json', '{"game_setting":true}');
        for (const path of [
          'first.xdelta',
          'second.csx',
          'language.txt',
          'lib/helper.cs',
        ])
          zip.file(path, path);
        const converted = await importZipArchive(
          await zip.generateAsync({ type: 'uint8array' })
        );
        await addArchive(
          'Deltamod ' + format,
          converted.config,
          converted.assets
        );
      }
      const result = spawnSync(
        python,
        [resolve('scripts/g3m_contract.py'), g3mRoot],
        {
          input: JSON.stringify(request),
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 60000,
        }
      );
      expect(result.status, result.stdout + '\n' + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        status: 'passed',
        configs: 67,
        archives: 17,
        legacy: 10,
        hashes: 1,
      });
      console.info('G3M interop:', result.stdout.trim());
    }, 70000);
  }
);
