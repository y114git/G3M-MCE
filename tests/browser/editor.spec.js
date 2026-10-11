import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const config = () => ({
  config_version: '2.0.0',
  id: 'browser_mod',
  name: 'Browser Mod',
  version: '1.0',
  authors: ['One', 'Two'],
  game: 'deltarune',
  files: [
    {
      source: '${mod_path}/patch.csx',
      target: '${game_path}/chapter5_windows/data.win',
      type: 'patch',
    },
  ],
});
async function openEditor(page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Create Mod', exact: true }).click();
}

async function assertAppearance(page) {
  expect(
    await page.evaluate(() => {
      const errors = [];
      for (const element of document.querySelectorAll('*')) {
        if (!element.checkVisibility()) continue;
        const style = getComputedStyle(element);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          if (
            !['none', 'hidden'].includes(style[`border${side}Style`]) &&
            style[`border${side}Width`] !== '2px'
          )
            errors.push(
              `${element.tagName}.${element.className}: border${side} ${style[`border${side}Width`]}`
            );
        }
        for (const pseudo of [
          '::before',
          '::after',
          ...(element.matches('input[type=file]')
            ? ['::file-selector-button']
            : []),
        ]) {
          const pseudoStyle = getComputedStyle(element, pseudo);
          if (
            pseudo !== '::file-selector-button' &&
            ['none', 'normal'].includes(pseudoStyle.content)
          )
            continue;
          for (const side of ['Top', 'Right', 'Bottom', 'Left'])
            if (
              !['none', 'hidden'].includes(pseudoStyle[`border${side}Style`]) &&
              pseudoStyle[`border${side}Width`] !== '2px'
            )
              errors.push(
                `${element.tagName}${pseudo}: border${side} ${pseudoStyle[`border${side}Width`]}`
              );
        }
        if (
          !matchMedia('(forced-colors: active)').matches &&
          element.matches(
            "input[aria-invalid='true'], select[aria-invalid='true'], textarea[aria-invalid='true'], button.is-invalid"
          ) &&
          style.borderTopColor !== 'rgb(255, 159, 159)'
        )
          errors.push(`${element.tagName}: invalid field is not highlighted`);
        if (style.outlineStyle !== 'none' && style.outlineWidth !== '2px')
          errors.push(`${element.tagName}: outline ${style.outlineWidth}`);
        if (
          element.classList.contains('g3m-icon') &&
          style.maskImage === 'none'
        )
          errors.push('Missing icon mask');
      }
      if (document.documentElement.scrollWidth > innerWidth)
        errors.push('Horizontal overflow');
      return errors;
    })
  ).toEqual([]);
}

async function addRelation(page, section, id, mode = '') {
  const pane = page.getByRole('region', { name: section, exact: true });
  await pane.getByRole('button', { name: 'Add', exact: true }).click();
  await pane.getByLabel('Mod ID', { exact: true }).fill(id);
  await pane.getByLabel('Order', { exact: true }).selectOption(mode);
}

test('keeps a folder used by an operation after its last bundled file is removed', async ({
  page,
}) => {
  const manifest = {
    ...config(),
    files: [
      {
        source: '${mod_path}/folder/',
        target: '${game_path}/folder/',
        type: 'extract',
      },
    ],
  };
  const zip = new JSZip();
  zip.file('mod_config.json', JSON.stringify(manifest));
  zip.file('folder/file.txt', 'Payload');
  await page.goto('./#/edit');
  await page.getByLabel('Select archive, config, or file').setInputFiles({
    name: 'folder.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Remove: folder/file.txt', exact: true })
    .click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const saved = await JSZip.loadAsync(
    await readFile(await (await event).path())
  );
  expect(saved.files['folder/'].dir).toBe(true);
  expect(saved.file('folder/file.txt')).toBeNull();
  expect(
    JSON.parse(await saved.file('mod_config.json').async('string')).files
  ).toEqual(manifest.files);
});

test('keeps browser back history after canceling unsaved navigation', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByLabel('Mod name:', { exact: true }).fill('Unsaved');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page.getByLabel('Mod name:', { exact: true })).toHaveValue(
    'Unsaved'
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.goBack();
  await expect(
    page.getByRole('button', { name: 'Create Mod', exact: true })
  ).toBeVisible();
});

test('preserves uploaded file names that coincide with JavaScript object properties', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByLabel('Mod ID', { exact: true }).fill('special_file');
  await page.getByLabel('Mod name:', { exact: true }).fill('Special file');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page
    .locator('input[type=file][multiple]:not([webkitdirectory])')
    .setInputFiles({
      name: '__proto__',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('Payload'),
    });
  await expect(page.getByText('__proto__', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Add operation', exact: true })
    .click();
  await page.getByLabel('Type', { exact: true }).selectOption('overwrite');
  await page
    .getByLabel('Source', { exact: true })
    .fill('${mod_path}/__proto__');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile(await (await event).path()));
  expect(await zip.file('__proto__').async('string')).toBe('Payload');
});

for (const format of ['json', 'toml']) {
  test(`opens Deltamod ${format} in the browser and preserves consecutive patches`, async ({
    page,
  }) => {
    const zip = new JSZip();
    zip.file(
      format === 'json' ? '_deltamodInfo.json' : 'meta.toml',
      format === 'json'
        ? JSON.stringify({
            metadata: {
              name: 'Converted',
              packageID: 'delta.mod',
              author: ['One', 'Two'],
              game: 'toby.deltarune',
            },
          })
        : '[metadata]\nname="Converted"\npackageID="delta.mod"\nauthor=["One","Two"]\ngame="toby.deltarune"'
    );
    zip.file(
      format === 'toml' ? 'Modding.XML' : 'modding.xml',
      '<patches><patch type="xdelta" patch="first.xdelta" to="chapter5_windows/data.win"/><patch type="csx" patch="second.csx" to="chapter5_windows/data.win"/></patches>'
    );
    zip.file('first.xdelta', 'First patch');
    zip.file('second.csx', 'Second patch');
    zip.file('scripts/helper.cs', 'Dependency');
    await page.goto('./#/edit');
    await page.getByLabel('Select archive, config, or file').setInputFiles({
      name: 'deltamod.zip',
      mimeType: 'application/zip',
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    });
    await expect(page.getByLabel('Mod authors:')).toHaveValue('One\nTwo');
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
    const saved = await JSZip.loadAsync(
      await readFile(await (await event).path())
    );
    expect(
      JSON.parse(await saved.file('mod_config.json').async('string')).files.map(
        (entry) => entry.source
      )
    ).toEqual(['${mod_path}/first.xdelta', '${mod_path}/second.csx']);
    expect(await saved.file('scripts/helper.cs').async('string')).toBe(
      'Dependency'
    );
  });
}

test('creates a mod, edits ordered operations and exports the actual files', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  await page.getByLabel('Mod ID', { exact: true }).fill('browser_mod');
  await page.getByLabel('Mod name:', { exact: true }).fill('Browser Mod');
  await page.getByLabel('Mod authors:').fill('One\nTwo');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page
    .locator('input[type=file][multiple]:not([webkitdirectory])')
    .setInputFiles({
      name: 'patch.csx',
      mimeType: 'text/plain',
      buffer: Buffer.from('script'),
    });
  await page
    .getByRole('button', { name: 'Add operation', exact: true })
    .click();
  await page
    .getByLabel('Source', { exact: true })
    .fill('${mod_path}/patch.csx');
  await page
    .getByLabel('Target', { exact: true })
    .fill('${game_path}/chapter5_windows/data.win');
  await page.getByLabel('Include source hash', { exact: true }).check();
  await page
    .getByRole('button', { name: 'Calculate source hash', exact: true })
    .click();
  await expect(page.getByLabel('Source hash', { exact: true })).toHaveValue(
    /^sha256:/
  );
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const download = await downloadEvent;
  const output = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(output);
  const zip = await JSZip.loadAsync(await readFile(output));
  const saved = JSON.parse(await zip.file('mod_config.json').async('string'));
  expect(saved.config_version).toBe('2.0.0');
  expect(saved.authors).toEqual(['One', 'Two']);
  expect(await zip.file('patch.csx').async('string')).toBe('script');
  expect(saved.files[0].target).toBe('${game_path}/chapter5_windows/data.win');
  const g3mRoot = process.env.G3M_ROOT || resolve('../G3M');
  const python =
    process.env.G3M_PYTHON ||
    resolve(
      g3mRoot,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    );
  if (
    existsSync(python) &&
    existsSync(resolve(g3mRoot, 'src/utils/mod/config.py'))
  ) {
    const result = spawnSync(
      python,
      [resolve('scripts/g3m_contract.py'), g3mRoot],
      {
        input: JSON.stringify({
          archives: [
            {
              label: 'actual browser download',
              config: saved,
              base64: (await readFile(output)).toString('base64'),
              files: { 'patch.csx': Buffer.from('script').toString('base64') },
            },
          ],
        }),
        encoding: 'utf8',
        timeout: 60000,
      }
    );
    expect(result.status, result.stderr).toBe(0);
  }
  await page.screenshot({
    path: testInfo.outputPath('editor-desktop.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('opens current and old archives, preserves unlisted files, supports custom paths and compatibility', async ({
  page,
}) => {
  const zip = new JSZip();
  zip.file('wrapper/mod_config.json', JSON.stringify(config()));
  zip.file('wrapper/patch.csx', 'script');
  zip.file('wrapper/helper.cs', 'dependency');
  await page.goto('./#/edit');
  await page.getByLabel('Select archive, config, or file').setInputFiles({
    name: 'mod.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.getByLabel('Mod authors:')).toHaveValue('One\nTwo');
  await page.getByRole('tab', { name: 'Placeholders', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('#alias-0').fill('scripts');
  await page.locator('#alias-path-0').fill('${mod_path}/scripts');
  await page.getByRole('tab', { name: 'Compatibility', exact: true }).click();
  await addRelation(page, 'Dependencies', 'base', 'before');
  await addRelation(page, 'Dependencies', 'textures', 'after-step');
  await addRelation(page, 'Conflicts', 'other');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await expect(page.getByText('helper.cs', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'Files', exact: true })
  ).toBeVisible();
});

test('shows validation errors and allows keyboard tabs on mobile without overflowing', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('id');
  const metadata = page.getByRole('tab', { name: 'Metadata', exact: true });
  await metadata.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('tab', { name: 'Compatibility', exact: true })
  ).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('tab', { name: 'Files', exact: true })
  ).toBeFocused();
  await expect(
    page.getByRole('tab', { name: 'Files', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('editor-mobile.png'),
    fullPage: true,
  });
});

test('direct export saves a ZIP and explains the local-file handoff', async ({
  page,
}) => {
  const zip = new JSZip();
  zip.file('mod_config.json', JSON.stringify(config()));
  zip.file('patch.csx', 'script');
  await page.goto('./#/edit');
  await page.getByLabel('Select archive, config, or file').setInputFiles({
    name: 'mod.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  const downloadEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export to G3M', exact: true })
    .click();
  await downloadEvent;
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('cannot provide');
  await page.getByRole('button', { name: 'Open G3M', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(page.locator('#saved-path')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(page.locator('#saved-path')).toBeFocused();
  await assertAppearance(page);
  for (const language of ['ru', 'es', 'ja', 'ko', 'zh_cn', 'zh_tw', 'en']) {
    const locale = JSON.parse(
      await readFile(resolve(`src/locales/${language}.json`), 'utf8')
    );
    await page.locator('.language-select').selectOption(language);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: locale.mce.openG3M, exact: true })
      .click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
      locale.mce.invalidSavedPath
    );
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('works when local storage is unavailable and language changes retain edits', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage disabled');
      },
    });
  });
  await openEditor(page);
  await page.getByLabel('Mod name:', { exact: true }).fill('Unsaved name');
  await page.getByLabel('Language').selectOption('ru');
  await expect(page.locator('#name')).toHaveValue('Unsaved name');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Создать мод'
  );
});

test('selects an archive member, groups operations and includes info without a target', async ({
  page,
}) => {
  const nested = new JSZip();
  nested.file('docs/readme.md', 'Documentation');
  const mod = new JSZip();
  mod.file('mod_config.json', JSON.stringify({ ...config(), files: [] }));
  mod.file('assets.zip', await nested.generateAsync({ type: 'nodebuffer' }));
  await page.goto('./#/edit');
  await page.getByLabel('Select archive, config, or file').setInputFiles({
    name: 'mod.zip',
    mimeType: 'application/zip',
    buffer: await mod.generateAsync({ type: 'nodebuffer' }),
  });
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await page.getByLabel('Group name:').fill('Documents');
  await page
    .getByRole('button', { name: 'Add operation', exact: true })
    .click();
  await page.getByLabel('Type', { exact: true }).selectOption('info');
  await expect(page.getByLabel('Target', { exact: true })).toHaveCount(0);
  await page
    .getByLabel('Browse bundled ZIP', { exact: true })
    .selectOption('assets.zip');
  await page
    .getByLabel('Source inside ZIP', { exact: true })
    .selectOption('assets.zip/docs/readme.md');
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue(
    '${mod_path}/assets.zip/docs/readme.md'
  );
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const saved = await JSZip.loadAsync(
    await readFile(await (await event).path())
  );
  const document = JSON.parse(
    await saved.file('mod_config.json').async('string')
  );
  expect(document.files).toEqual([
    {
      Documents: [
        { source: '${mod_path}/assets.zip/docs/readme.md', type: 'info' },
      ],
    },
  ]);
});

test('opens an old config, converts GameBanana references and can fix a failed import', async ({
  page,
}) => {
  await page.goto('./#/edit');
  const picker = page.getByLabel('Select archive, config, or file');
  await picker.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await picker.setInputFiles({
    name: 'mod_config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        key: 'old_mod',
        name: 'Old Mod',
        author: 'Tester',
        version: '1.0',
        game: 'undertale',
        files: {},
      })
    ),
  });
  await expect(page.getByLabel('Mod ID', { exact: true })).toHaveValue(
    'old_mod'
  );
  await page.getByRole('tab', { name: 'Compatibility', exact: true }).click();
  await addRelation(
    page,
    'Dependencies',
    'https://gamebanana.com/mods/123',
    'before'
  );
  await addRelation(page, 'Dependencies', 'other', 'after');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const saved = await JSZip.loadAsync(
    await readFile(await (await event).path())
  );
  expect(
    JSON.parse(await saved.file('mod_config.json').async('string')).dependencies
  ).toEqual(['gb_mod_123:before', 'other:after']);
});

test('keeps groups intact when a reserved name is entered and accepts names with that prefix', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page);
  await page.getByLabel('Mod ID', { exact: true }).fill('group_mod');
  await page.getByLabel('Mod name:', { exact: true }).fill('Groups');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  const input = page.getByLabel('Group name:');
  for (const reserved of ['source', 'type']) {
    await input.fill(reserved);
    await input.press('Tab');
    await expect(input).toHaveValue('Group 1');
    await expect(page.getByRole('status')).toContainText('source');
  }
  await input.fill('');
  await input.pressSequentially('source_assets');
  await input.press('Tab');
  await expect(
    page.locator('.operations').getByRole('button', { name: /source_assets$/ })
  ).toBeVisible();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const saved = await JSZip.loadAsync(
    await readFile(await (await event).path())
  );
  expect(
    JSON.parse(await saved.file('mod_config.json').async('string')).files
  ).toEqual([{ source_assets: [] }]);
  expect(errors).toEqual([]);
});

test('keeps native tabs, icons and 2px outlines across languages and viewport sizes', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.goto('./');
  await assertAppearance(page);
  await openEditor(page);
  const manifest = {
    ...config(),
    files: [],
    dependencies: ['base:before', 'textures:after-step'],
    placeholders: { scripts: '${mod_path}/scripts' },
  };
  // Import realistic values so list editing, icons and font loading are exercised together.
  page.once('dialog', (dialog) => dialog.accept());
  await page.goto('./#/edit');
  await assertAppearance(page);
  await page.getByLabel('Select archive, config, or file').setInputFiles({
    name: 'mod_config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(manifest)),
  });
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (font) => font.family === 'Noto Sans' && font.status === 'loaded'
      )
    )
  ).toBe(true);
  await expect(page.getByRole('tab')).toHaveText([
    'Metadata',
    'Compatibility',
    'Files',
    'Placeholders',
    'Help',
  ]);
  await page.getByRole('tab', { name: 'Compatibility', exact: true }).click();
  const dependencies = page.getByRole('region', {
    name: 'Dependencies',
    exact: true,
  });
  await dependencies
    .getByRole('button', { name: 'base Before this mod', exact: true })
    .focus();
  await page.keyboard.press('ArrowDown');
  await expect(dependencies.getByLabel('Mod ID', { exact: true })).toHaveValue(
    'textures'
  );
  await dependencies
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(dependencies.getByLabel('Mod ID', { exact: true })).toHaveValue(
    'base'
  );
  await dependencies
    .getByLabel('Order', { exact: true })
    .selectOption('after-priority');
  await assertAppearance(page);
  await page.getByRole('tab', { name: 'Placeholders', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('#alias-1').fill('docs');
  await page.locator('#alias-path-1').fill('${mod_path}/docs');
  await page
    .getByRole('button', { name: 'scripts ${mod_path}/scripts', exact: true })
    .click();
  await expect(page.locator('#alias-0')).toHaveValue('scripts');
  await assertAppearance(page);
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add operation', exact: true })
    .click();
  const picker = page
    .locator('input[type=file]:not([multiple]):not([accept])')
    .filter({ visible: false })
    .first();
  await picker.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Documentation'),
  });
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue(
    '${mod_path}/notes.txt'
  );
  await page.getByLabel('Include target hash', { exact: true }).check();
  await page
    .getByLabel('Target hash', { exact: true })
    .fill('sha256:' + 'a'.repeat(64));
  await page.getByLabel('Type', { exact: true }).selectOption('extract');
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue(
    '${game_path}/'
  );
  await expect(page.getByLabel('Target hash', { exact: true })).toHaveValue('');
  await page
    .getByLabel('Target hash', { exact: true })
    .fill('sha256:' + 'b'.repeat(64));
  await page.getByLabel('Type', { exact: true }).selectOption('soft-extract');
  await expect(page.getByLabel('Target hash', { exact: true })).toHaveValue(
    'sha256:' + 'b'.repeat(64)
  );
  await page.getByLabel('Type', { exact: true }).selectOption('info');
  await page.emulateMedia({ forcedColors: 'active' });
  const checkbox = page.getByLabel('Include source hash', { exact: true });
  const uncheckedColor = await checkbox.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  await page.getByLabel('Include source hash', { exact: true }).check();
  expect(
    await checkbox.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
  ).not.toBe(uncheckedColor);
  await assertAppearance(page);
  await page.emulateMedia({ forcedColors: 'none' });
  await page
    .getByRole('button', { name: 'Calculate source hash', exact: true })
    .click();
  await expect(page.getByLabel('Source hash', { exact: true })).toHaveValue(
    /^sha256:/
  );
  await page
    .getByLabel('Source', { exact: true })
    .fill('${mod_path}/missing.txt');
  await expect(page.getByLabel('Source hash', { exact: true })).toHaveValue('');
  await page.getByLabel('Include source hash', { exact: true }).uncheck();
  await expect(page.getByLabel('Source hash', { exact: true })).toHaveCount(0);
  await page
    .getByLabel('Source', { exact: true })
    .fill('${mod_path}/notes.txt');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const saved = await JSZip.loadAsync(
    await readFile(await (await event).path())
  );
  const output = JSON.parse(
    await saved.file('mod_config.json').async('string')
  );
  expect(output.dependencies).toEqual(['base:after-priority']);
  expect(output.placeholders).toEqual({
    scripts: '${mod_path}/scripts',
    docs: '${mod_path}/docs',
  });
  expect(output.files).toEqual([
    { source: '${mod_path}/notes.txt', type: 'info' },
  ]);
  await page
    .getByRole('button', { name: 'Export to G3M', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Full path to the saved ZIP').focus();
  await assertAppearance(page);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  for (const language of ['en', 'ru', 'es', 'ja', 'ko', 'zh_cn', 'zh_tw']) {
    await page.locator('.language-select').selectOption(language);
    if (language === 'ru')
      await expect(page.getByRole('status')).toContainText('ZIP экспортирован');
    for (const width of [1240, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const tab of await page.getByRole('tab').all()) {
        await tab.click();
        await assertAppearance(page);
        if (language === 'en' || language === 'ru')
          await page.screenshot({
            path: testInfo.outputPath(
              `${language}-${width}-${await tab.getAttribute('id')}.png`
            ),
            fullPage: true,
          });
      }
    }
  }
});

test('keeps a renamed group selected while moving it and preserves its contents', async ({
  page,
}) => {
  await page.goto('./#/edit');
  const manifest = {
    ...config(),
    files: [
      { First: [{ source: '${mod_path}/readme.txt', type: 'info' }] },
      { Second: [] },
    ],
  };
  const zip = new JSZip();
  zip.file('mod_config.json', JSON.stringify(manifest));
  zip.file('readme.txt', 'Documentation');
  await page.getByLabel('Select archive, config, or file').setInputFiles({
    name: 'groups.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue(
    '${mod_path}/readme.txt'
  );
  expect(await page.locator('.operation-number').allTextContents()).toEqual([
    '1',
  ]);
  expect(
    await page
      .locator('#operation-type option')
      .evaluateAll((options) => options.map((option) => option.value))
  ).toEqual([
    'info',
    'patch',
    'overwrite',
    'extract',
    'soft-overwrite',
    'soft-extract',
    'hard-overwrite',
    'hard-extract',
  ]);

  await page
    .locator('.operations')
    .getByRole('button', { name: 'First', exact: true })
    .click();
  await page.getByLabel('Group name:').fill('Renamed');
  await page.getByRole('button', { name: 'Move down', exact: true }).click();
  await expect(page.getByLabel('Group name:')).toHaveValue('Renamed');
  await expect(
    page
      .locator('.operations')
      .getByRole('button', { name: 'Renamed', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(page.getByLabel('Group name:')).toHaveValue('Renamed');
  await expect(
    page
      .locator('.operations')
      .getByRole('button', { name: 'Renamed', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const saved = await JSZip.loadAsync(
    await readFile(await (await event).path())
  );
  expect(
    JSON.parse(await saved.file('mod_config.json').async('string')).files
  ).toEqual([{ Renamed: manifest.files[0].First }, { Second: [] }]);
  expect(await saved.file('readme.txt').async('string')).toBe('Documentation');
});

test('automatically highlights every tab and validates both export buttons with field navigation', async ({
  page,
}) => {
  const manifest = {
    ...config(),
    files: [
      {
        'Group.[7]': [
          config().files[0],
          { ...config().files[0], source: '${mod_path}/missing.csx' },
        ],
      },
    ],
  };
  const zip = new JSZip();
  zip.file('mod_config.json', JSON.stringify(manifest));
  zip.file('patch.csx', 'script');
  await page.goto('./#/edit');
  await page.getByLabel('Select archive, config, or file').setInputFiles({
    name: 'mod.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page
    .locator('.operations details > summary')
    .click({ position: { x: 3, y: 8 } });
  await expect(page.locator('.operations details')).not.toHaveAttribute(
    'open',
    ''
  );
  await page.getByRole('tab', { name: 'Metadata', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Validate', exact: true })
  ).toHaveCount(0);
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.locator('#homepage').fill('wrong URL');
  await expect(page.locator('#homepage')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.getByRole('tab', { name: 'Compatibility', exact: true }).click();
  await addRelation(page, 'Dependencies', 'base');
  await addRelation(page, 'Dependencies', '');
  await expect(page.locator('#dependencies')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.getByRole('tab', { name: 'Placeholders', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('#alias-0').fill('assets');
  await page.locator('#alias-path-0').fill('relative/path');
  await expect(page.locator('#alias-path-0')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('#alias-1').fill('assets');
  await expect(page.locator('#alias-1')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page
    .getByRole('button', { name: 'Export to G3M', exact: true })
    .click();
  await expect(page.locator('#homepage')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('dependencies[1]');
  await page
    .getByRole('alert')
    .getByRole('button')
    .filter({ hasText: 'dependencies[1]' })
    .click();
  await expect(page.locator('#dependencies')).toBeFocused();
  await page.locator('#dependencies').fill('textures');
  await expect(page.locator('#dependencies')).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page
    .getByRole('alert')
    .getByRole('button')
    .filter({ hasText: 'Start with one built-in path' })
    .click();
  await expect(page.locator('#alias-path-0')).toBeFocused();
  await page.locator('#alias-path-0').fill('${mod_path}/assets');
  await page
    .getByRole('alert')
    .getByRole('button')
    .filter({ hasText: 'placeholders.assets' })
    .filter({ hasText: 'name' })
    .last()
    .click();
  await expect(page.locator('#alias-1')).toBeFocused();
  await page.locator('#alias-1').fill('scripts');
  await page.getByRole('tab', { name: 'Metadata', exact: true }).click();
  await page.locator('#homepage').fill('https://example.org');
  await expect(page.locator('#homepage')).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  await expect(page.locator('.operations details')).toHaveAttribute('open', '');
  await expect(page.locator('#source')).toBeFocused();
  await expect(page.locator('#source')).toHaveValue('${mod_path}/missing.csx');
  await expect(page.locator('#source')).toHaveAttribute('aria-invalid', 'true');
  await assertAppearance(page);
  expect(downloads).toHaveLength(0);
  await page.locator('#source').fill('${mod_path}/patch.csx');
  await expect(page.locator('#source')).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await page.getByLabel('Include source hash', { exact: true }).check();
  await page.locator('#source_hash').fill('sha256:' + '0'.repeat(64));
  await page
    .getByRole('button', { name: 'Export to G3M', exact: true })
    .click();
  await expect(page.locator('#source_hash')).toBeFocused();
  await expect(page.locator('#source_hash')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(page.getByRole('alert')).toContainText(
    'Source hash does not match'
  );
  expect(downloads).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Calculate source hash', exact: true })
    .click();
  await expect(page.locator('#source_hash')).not.toHaveAttribute(
    'aria-invalid',
    'true'
  );
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const saved = await JSZip.loadAsync(
    await readFile(await (await event).path())
  );
  const result = JSON.parse(
    await saved.file('mod_config.json').async('string')
  );
  expect(result.dependencies).toEqual(['base', 'textures']);
  expect(result.placeholders).toEqual({
    assets: '${mod_path}/assets',
    scripts: '${mod_path}/assets',
  });
  expect(result.files[0]['Group.[7]'][1].source).toBe('${mod_path}/patch.csx');
  await page.getByRole('tab', { name: 'Help', exact: true }).click();
  for (const button of await page.locator('.help-tabbar button').all()) {
    await button.click();
    await assertAppearance(page);
  }
});

test('localizes an import read failure and lets the next import succeed', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    let fail = true;
    File.prototype.arrayBuffer = function () {
      if (fail) {
        fail = false;
        return Promise.reject(null);
      }
      return read.call(this);
    };
  });
  await page.goto('./#/edit');
  await page.getByLabel('Language').selectOption('ru');
  const picker = page.locator('.g3m-upload input');
  const file = {
    name: 'mod_config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...config(), files: [] })),
  };
  await picker.setInputFiles(file);
  await expect(page.getByRole('alert')).toHaveText(
    'Не удалось открыть архив или конфигурацию мода.'
  );
  await assertAppearance(page);
  await picker.setInputFiles(file);
  await expect(page.locator('#id')).toHaveValue('browser_mod');
});

async function dropFiles(page, selector, files, directory = false) {
  await page.evaluate(
    ({ selector, files, directory }) => {
      const transfer = new DataTransfer();
      const makeFile = (input) =>
        new File(
          [Uint8Array.from(atob(input.base64), (c) => c.charCodeAt(0))],
          input.name,
          { type: input.type || 'application/octet-stream' }
        );
      if (directory) {
        const item = transfer.items.add(makeFile(files[0]));
        Object.defineProperty(transfer, 'items', { value: [item] });
        Object.defineProperty(item, 'webkitGetAsEntry', {
          value: () => ({
            isDirectory: true,
            name: 'payload',
            createReader: () => {
              let batch = 0;
              return {
                readEntries: (resolve) =>
                  resolve(
                    batch++
                      ? []
                      : [
                          ...files.map((input) => ({
                            isFile: true,
                            name: input.name,
                            file: (resolve) => resolve(makeFile(input)),
                          })),
                          {
                            isDirectory: true,
                            name: 'empty',
                            createReader: () => ({
                              readEntries: (resolve) => resolve([]),
                            }),
                          },
                        ]
                  ),
              };
            },
          }),
        });
      } else for (const input of files) transfer.items.add(makeFile(input));
      const target = document.querySelector(selector);
      for (const type of ['dragenter', 'dragover', 'drop'])
        target.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
          })
        );
    },
    {
      selector,
      files: files.map((file) => ({
        ...file,
        base64: Buffer.from(file.content).toString('base64'),
      })),
      directory,
    }
  );
}

test('opens dropped archives on home and import, then supports dropped files, icon, paths and hashes', async ({
  page,
}, testInfo) => {
  const zip = new JSZip();
  zip.file('mod_config.json', JSON.stringify(config()));
  zip.file('patch.csx', 'script');
  const archive = {
    name: 'mod.zip',
    type: 'application/zip',
    content: await zip.generateAsync({ type: 'nodebuffer' }),
  };
  await page.goto('./');
  await dropFiles(page, '.g3m-home__hero', [archive]);
  await expect(page.locator('#id')).toHaveValue('browser_mod');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await dropFiles(page, '.tree-item', [
    { name: 'notes.txt', content: 'Notes' },
  ]);
  await expect(page.locator('#package-files')).toContainText('notes.txt');
  const row = page
    .locator('#package-files li')
    .filter({ hasText: 'notes.txt' });
  await row.hover();
  const start = await row.boundingBox();
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 + 12,
    start.y + start.height / 2,
    { steps: 3 }
  );
  await page.locator('#source').hover();
  await page.mouse.up();
  await expect(page.locator('#source')).toHaveValue('${mod_path}/notes.txt');
  await page.locator('#operation-type').selectOption('info');
  const icon = {
    name: 'logo.png',
    type: 'image/png',
    content: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKyoAAAAASUVORK5CYII=',
      'base64'
    ),
  };
  await dropFiles(page, '.editor-content', [icon]);
  await page.getByRole('tab', { name: 'Metadata', exact: true }).click();
  await dropFiles(page, '.icon-field', [icon]);
  await expect(page.getByRole('status')).toContainText('already');
  await expect(page.locator('#icon')).toHaveValue('');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  const logoRow = page
    .locator('#package-files li')
    .filter({ hasText: 'logo.png' });
  await logoRow.hover();
  const logoStart = await logoRow.boundingBox();
  await page.mouse.down();
  await page.mouse.move(
    logoStart.x + logoStart.width / 2 + 12,
    logoStart.y + logoStart.height / 2,
    { steps: 3 }
  );
  await page.getByRole('tab', { name: 'Metadata', exact: true }).hover();
  await expect(
    page.getByRole('tab', { name: 'Metadata', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await page.locator('.icon-field').hover();
  await page.mouse.up();
  await expect(page.locator('#icon')).toHaveValue('${mod_path}/logo.png');
  await page.route('https://example.test/logo.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: icon.content })
  );
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/uri-list', '# Image\nhttps://example.test/logo.png');
    document.querySelector('.icon-field').dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(page.locator('#icon')).toHaveValue(
    'https://example.test/logo.png'
  );
  await expect(page.locator('.icon-preview img')).toBeVisible();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData('application/g3m-package-path', 'logo.png');
    document.querySelector('.icon-field').dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(page.locator('#icon')).toHaveValue('${mod_path}/logo.png');

  await expect(page.locator('.icon-preview img')).toBeVisible();
  await page.getByRole('tab', { name: 'Placeholders', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('#alias-0').fill('docs');
  await dropFiles(page, '#alias-path-0', [
    { name: 'doc.md', content: 'Documentation' },
  ]);
  await expect(page.locator('#alias-path-0')).toHaveValue('${mod_path}/doc.md');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page.locator('#operation-type').selectOption('overwrite');
  await page.getByLabel('Include source hash', { exact: true }).check();
  await dropFiles(page, '#source_hash', [
    { name: 'notes.txt', content: 'Notes' },
  ]);
  await expect(page.locator('#source_hash')).toHaveValue(
    /^sha256:[a-f0-9]{64}$/
  );
  await page.getByLabel('Include target hash', { exact: true }).check();
  await dropFiles(page, '#target_hash', [
    { name: 'original.bin', content: 'Original' },
  ]);
  await expect(page.locator('#target_hash')).toHaveValue(
    /^sha256:[a-f0-9]{64}$/
  );
  await expect(page.locator('#package-files')).not.toContainText(
    'original.bin'
  );
  await assertAppearance(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const output = testInfo.outputPath('dragged.zip');
  await (await download).saveAs(output);
  const exported = await readFile(output);
  await verifyNativeDropArchive(exported);
  const saved = await JSZip.loadAsync(exported);
  expect(await saved.file('notes.txt').async('string')).toBe('Notes');
  const manifest = JSON.parse(
    await saved.file('mod_config.json').async('string')
  );
  expect(manifest.icon).toBe('${mod_path}/logo.png');
  expect(manifest.placeholders.docs).toBe('${mod_path}/doc.md');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Mod', exact: true }).click();
  await dropFiles(page, '.g3m-panel--import', [archive]);
  await expect(page.locator('#id')).toHaveValue('browser_mod');
});

test('drops folders as operation sources and preserves empty folders in a real exported ZIP', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#name').fill('Folders');
  await page.locator('#id').fill('folders_mod');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add operation', exact: true })
    .click();
  await page.locator('#operation-type').selectOption('extract');
  await dropFiles(
    page,
    '#source',
    [
      { name: 'one.txt', content: 'One' },
      { name: 'two.txt', content: 'Two' },
    ],
    true
  );
  await expect(page.locator('#source')).toHaveValue('${mod_path}/payload/');
  await page.getByLabel('Include source hash', { exact: true }).check();
  await dropFiles(
    page,
    '#source_hash',
    [
      { name: 'one.txt', content: 'One' },
      { name: 'two.txt', content: 'Two' },
    ],
    true
  );
  await expect(page.locator('#source_hash')).toHaveValue(
    /^sha256:[a-f0-9]{64}$/
  );
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
  const exported = await readFile(await (await event).path());
  await verifyNativeDropArchive(exported);
  const saved = await JSZip.loadAsync(exported);
  expect(saved.file('payload/one.txt')).not.toBeNull();
  expect(saved.files['payload/empty/'].dir).toBe(true);
  await assertAppearance(page);
});

test('keeps tabs, buttons and width stable and restores tab scroll positions', async ({
  page,
}) => {
  for (const width of [1240, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('./#/edit');
    await page.reload();
    await page.getByLabel('Select archive, config, or file').setInputFiles({
      name: 'mod_config.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          ...config(),
          files: [
            {
              Group: [
                { ...config().files[0], source: '${game_path}/patch.csx' },
              ],
            },
          ],
        })
      ),
    });
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await page
      .locator('.operations details > summary')
      .click({ position: { x: 3, y: 8 } });
    await expect(page.locator('.operations details')).not.toHaveAttribute(
      'open',
      ''
    );
    await page.getByRole('tab', { name: 'Metadata', exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    const dimensions = async () =>
      page.evaluate(() => {
        const panel = document
          .querySelector('.editor-content')
          .getBoundingClientRect();
        const tabs = document
          .querySelector('.g3m-tabbar')
          .getBoundingClientRect();
        const footer = document
          .querySelector('.g3m-editor__footer-actions')
          .getBoundingClientRect();
        return {
          panelY: panel.y + scrollY,
          height: panel.height,
          width: panel.width,
          tabsY: tabs.y + scrollY,
          footerY: footer.y + scrollY,
        };
      });
    const initial = await dimensions();
    await page.locator('#game_version').scrollIntoViewIfNeeded();
    const scroll = await page
      .locator('.editor-content')
      .evaluate((element) => element.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    for (const name of [
      'Files',
      'Compatibility',
      'Placeholders',
      'Help',
      'Metadata',
    ]) {
      await page.getByRole('tab', { name, exact: true }).click();
      expect(await dimensions()).toEqual(initial);
      if (name === 'Files')
        await expect(page.locator('.operations details')).not.toHaveAttribute(
          'open',
          ''
        );
      await assertAppearance(page);
    }
    expect(
      await page
        .locator('.editor-content')
        .evaluate((element) => element.scrollTop)
    ).toBe(scroll);
    await page.locator('#homepage').fill('broken');
    await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await dimensions()).toEqual(initial);
    await page.locator('#homepage').fill('https://example.org');
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save ZIP', exact: true }).click();
    await event;
    await expect(page.getByRole('status')).toContainText('exported');
    expect(await dimensions()).toEqual(initial);
  }
});

async function verifyNativeDropArchive(bytes) {
  const g3mRoot = process.env.G3M_ROOT || resolve('../G3M');
  const python =
    process.env.G3M_PYTHON ||
    resolve(
      g3mRoot,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
    );
  if (
    !existsSync(python) ||
    !existsSync(resolve(g3mRoot, 'src/utils/mod/config.py'))
  )
    return;
  const zip = await JSZip.loadAsync(bytes);
  const config = JSON.parse(await zip.file('mod_config.json').async('string'));
  const files = Object.fromEntries(
    await Promise.all(
      Object.values(zip.files)
        .filter((entry) => !entry.dir && entry.name !== 'mod_config.json')
        .map(async (entry) => [entry.name, await entry.async('base64')])
    )
  );
  const result = spawnSync(
    python,
    [resolve('scripts/g3m_contract.py'), g3mRoot],
    {
      encoding: 'utf8',
      timeout: 60000,
      input: JSON.stringify({
        archives: [
          {
            label: 'drag-and-drop browser export',
            config,
            files,
            directories: Object.values(zip.files)
              .filter((entry) => entry.dir)
              .map((entry) => entry.name),
            base64: bytes.toString('base64'),
          },
        ],
      }),
    }
  );
  expect(result.status, result.stderr).toBe(0);
}

