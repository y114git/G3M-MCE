import {
  ARCHIVE_EXTENSIONS,
  buildModConfigData,
  DOCUMENT_EXTENSIONS,
  MOD_ALLOWED_TAGS,
  MOD_CONFIG_VERSION,
} from '../data/modConfig';

const chapterIds = {
  '-1': 'deltarune',
  '-10': 'deltarunedemo',
  '-20': 'undertale',
  '-30': 'undertaleyellow',
  '-40': 'pizzatower',
  '-50': 'sugaryspire',
  '-60': 'frickbears3',
};
export function migrateLegacyChapterId(value) {
  return (
    (Object.hasOwn(chapterIds, value) ? chapterIds[value] : null) ||
    (/^[0-5]$/.test(value) ? `deltarune_${value}` : String(value))
  );
}
export function sectionTargetRoot(game, section) {
  const chapter = /^deltarune_(\d+)$/.exec(section)?.[1];
  return game === 'deltarune' && chapter && chapter !== '0'
    ? '${game_path}/chapter' + chapter + '_windows'
    : '${game_path}';
}
const normalizedPath = (value) =>
  String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '');
const absolute = (value) => /^(?:[A-Za-z]:\/|\/)/.test(value);
const sourcePath = (value) =>
  absolute(value) || value.startsWith('${') ? value : '${mod_path}/' + value;
const text = (value, max) =>
  [
    ...String(value || '')
      .trim()
      .normalize('NFC'),
  ]
    .slice(0, max)
    .join('')
    .trim();

export function migrateModConfig(
  data,
  assets = { files: {}, directories: [] }
) {
  if (data.config_version === MOD_CONFIG_VERSION)
    return buildModConfigData(data);
  if (
    ![undefined, null, '', '1.0.0'].includes(data.config_version) ||
    Array.isArray(data.files)
  )
    throw new Error('Unsupported mod config version.');
  const meta = {
    ...(data.metadata || {}),
    ...Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== '' && value != null)
    ),
  };
  const game = text(meta.game || 'deltarune', 30).toLowerCase();
  const result = {
    config_version: MOD_CONFIG_VERSION,
    // Keep published IDs stable, including invalid IDs that need a user's correction.
    id: text(meta.id || meta.key || meta.mod_key || 'legacy_mod', 50),
    name: text(meta.name || 'Legacy Mod', 50),
    version: text(meta.version || '1.0.0', 20),
    authors: text(meta.author, 50) ? [text(meta.author, 50)] : [],
    game,
    files: [],
  };
  const keys = Object.keys(assets.files || {});
  const resolve = (value, section) => {
    const path = normalizedPath(value);
    if (
      !path ||
      absolute(path) ||
      path.startsWith('${') ||
      keys.includes(path) ||
      assets.directories.includes(path.replace(/\/$/, '') + '/')
    )
      return path;
    const number = /^deltarune_(\d+)$/.exec(section)?.[1];
    const folders = number
      ? [
          `chapter_${number}`,
          `chapter${number}_windows`,
          `chapter${number}_mac`,
        ]
      : [game, 'demo', 'menu', 'universal'];
    const matches = [...new Set(folders)]
      .map((folder) => `${folder}/${path}`)
      .filter(
        (candidate) =>
          keys.includes(candidate) ||
          assets.directories.includes(candidate.replace(/\/$/, '') + '/') ||
          keys.some((key) => key.startsWith(candidate.replace(/\/$/, '') + '/'))
      );
    if (matches.length > 1) throw new Error(`Ambiguous legacy source: ${path}`);
    return matches[0] || path;
  };
  for (const [rawSection, entry] of Object.entries(data.files || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const section = migrateLegacyChapterId(rawSection),
      root = sectionTargetRoot(game, section);
    const dataFile = entry.data_file_path || entry.data_file_url;
    if (dataFile)
      result.files.push({
        source: sourcePath(resolve(dataFile, section)),
        target: `${root}/data.win`,
        type: 'patch',
      });
    let extras = entry.extra_files || [];
    if (!Array.isArray(extras))
      extras = Object.values(extras).flatMap((value) =>
        Array.isArray(value) ? value : []
      );
    for (const extra of extras) {
      const rawPath =
        typeof extra === 'string'
          ? extra
          : extra?.file_path || extra?.url || extra?.path;
      if (!rawPath) continue;
      const path = resolve(rawPath, section);
      if (path.split('/').includes('..'))
        throw new Error(`Unsafe legacy path: ${path}`);
      let targetMode =
        typeof extra === 'object'
          ? extra.target || extra.status || 'game_folder'
          : 'game_folder';
      targetMode =
        {
          install: 'game_folder',
          data: 'game_data_folder',
          dependency: 'none',
        }[targetMode] || targetMode;
      const special = { pizzatower: 'towers', frickbears3: 'addons' }[game];
      if (
        targetMode === 'game_folder' &&
        special &&
        (path === special ||
          path.startsWith(special + '/') ||
          path.replace(ARCHIVE_EXTENSIONS, '') === special)
      )
        targetMode = 'game_data_folder';
      if (targetMode === 'none') continue;
      let targetRoot =
        targetMode === 'game_folder'
          ? root
          : targetMode === 'game_data_folder'
            ? '${game_data_path}'
            : null;
      if (targetMode === 'custom') {
        targetRoot = normalizedPath(extra.target_path).replace(/\/$/, '');
        if (!absolute(targetRoot))
          throw new Error(`Invalid custom destination for ${path}`);
      }
      if (!targetRoot) continue;
      const number = /^deltarune_(\d+)$/.exec(section)?.[1];
      let relative = path.replace(/\/$/, '');
      for (const folder of [
        ...(number
          ? [
              `chapter_${number}`,
              `chapter${number}_windows`,
              `chapter${number}_mac`,
            ]
          : []),
        game,
      ]) {
        if (relative === folder) relative = '';
        else if (relative.startsWith(folder + '/')) {
          relative = relative.slice(folder.length + 1);
          break;
        }
      }
      const directory =
        path.endsWith('/') ||
        (assets.directories || []).includes(path + '/') ||
        keys.some((key) => key.startsWith(path + '/'));
      const archive = ARCHIVE_EXTENSIONS.test(path),
        patch = /\.(xdelta|vcdiff|g3mpatch|csx)$/i.test(relative);
      let target = relative;
      if (directory) target = relative ? relative + '/' : '';
      else if (archive)
        target = relative.includes('/')
          ? relative.slice(0, relative.lastIndexOf('/') + 1)
          : '';
      else if (patch)
        target = relative.replace(/\.(xdelta|vcdiff|g3mpatch|csx)$/i, '');
      result.files.push({
        source: sourcePath(path.replace(/\/$/, '') + (directory ? '/' : '')),
        target: `${targetRoot}/${target}`,
        type: directory || archive ? 'extract' : patch ? 'patch' : 'overwrite',
      });
    }
  }
  for (const [path, state] of Object.entries(data.info_files || {}))
    if (state === 'show' && DOCUMENT_EXTENSIONS.test(path))
      result.files.push({
        source: sourcePath(normalizedPath(path)),
        type: 'info',
      });
  const description = meta.description || meta.tagline;
  if (description)
    result.description = [
      ...String(description).trim().replace(/\r\n?/g, '\n').normalize('NFC'),
    ]
      .slice(0, 200)
      .join('')
      .trim();
  const homepage =
    meta.homepage ||
    meta.external_url ||
    meta.external_link ||
    meta.site ||
    meta.url;
  if (homepage) result.homepage = text(homepage, 200);
  if (meta.game_version) result.game_version = text(meta.game_version, 20);
  if (meta.tags) {
    const tags = [
      ...new Set(
        (Array.isArray(meta.tags) ? meta.tags : [meta.tags])
          .map((tag) =>
            MOD_ALLOWED_TAGS.find(
              (allowed) => allowed.toLowerCase() === String(tag).toLowerCase()
            )
          )
          .filter(Boolean)
      ),
    ];
    if (tags.length) result.tags = tags;
  }
  const icon =
    normalizedPath(meta.icon || meta.icon_url) ||
    keys.find((key) => /^_icon\.(png|jpg|jpeg|gif|ico|bmp)$/i.test(key));
  if (icon && !absolute(icon))
    result.icon = /^https?:\/\//.test(icon) ? icon : sourcePath(icon);
  // Historical metadata may need correction; only export requires a valid config.
  return result;
}
