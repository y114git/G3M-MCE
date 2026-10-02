import { parse as parseToml } from 'smol-toml';
import {
  DOCUMENT_EXTENSIONS,
  MOD_ALLOWED_TAGS,
  parseConfigJson,
} from '../data/modConfig';

const gameMap = {
  'toby.deltarune': 'deltarune',
  'toby.deltarune.demo': 'deltarunedemo',
  'toby.deltarune.demolts': 'deltarunedemo',
  'toby.undertale': 'undertale',
  'fans.utyellow': 'undertaleyellow',
  'other.pizzatower': 'pizzatower',
  'other.frickbears3': 'frickbears3',
};
const allowed = {
  xdelta: /\.(xdelta|vcdiff|csx|win)$/i,
  g3mpatch: /\.g3mpatch$/i,
  csx: /\.csx$/i,
  copy: /^(?!.*\.(xdelta|vcdiff|csx)$).+/i,
  override: /^(?!.*\.(xdelta|vcdiff|csx)$).+/i,
};
const decode = (bytes) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
function relativePath(value) {
  const path = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '');
  if (
    !path ||
    /^(?:\/|[A-Za-z]:)/.test(path) ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Unsafe Deltamod path: ${value}`);
  return path;
}
export async function convertDeltamodArchive(assets) {
  const files = assets.files,
    keys = Object.keys(files);
  const metadataNames = keys.filter((path) =>
    /^(?:meta\.(?:json|toml)|_deltamodInfo\.json)$/i.test(path)
  );
  const xmlNames = keys.filter((path) => /^modding\.xml$/i.test(path));
  if (metadataNames.length !== 1 || xmlNames.length !== 1)
    throw new Error(
      'Deltamod needs one JSON/TOML metadata file and modding.xml.'
    );
  const metadataName = metadataNames[0],
    xmlName = xmlNames[0];
  if (
    files[metadataName].byteLength > 4 * 1024 * 1024 ||
    files[xmlName].byteLength > 4 * 1024 * 1024
  )
    throw new Error('Deltamod metadata or XML exceeds 4 MiB.');
  const info = metadataName.toLowerCase().endsWith('.toml')
    ? parseToml(decode(files[metadataName]), { maxDepth: 64 })
    : parseConfigJson(decode(files[metadataName]));
  const meta = info.metadata || {};
  let xmlText = decode(files[xmlName]);
  if (
    xmlText.length > 4 * 1024 * 1024 ||
    /<!\s*(?:DOCTYPE|ENTITY)/i.test(xmlText)
  )
    throw new Error('Unsafe or oversized Deltamod XML.');
  xmlText = xmlText.replace(/^\s*<\?xml[^?]*\?>/, '');
  const parser = new DOMParser();
  const parse = (text) => {
    try {
      return parser.parseFromString(text, 'application/xml');
    } catch {
      return null;
    }
  };
  let xml = parse(xmlText);
  if (
    !xml ||
    xml.getElementsByTagName('parsererror').length ||
    !xml.documentElement
  )
    xml = parse(`<patches>${xmlText}</patches>`);
  if (
    !xml ||
    xml.getElementsByTagName('parsererror').length ||
    !xml.documentElement
  )
    throw new Error('Invalid modding.xml.');
  const patches = Array.from(xml.getElementsByTagName('patch'));
  if (!patches.length || patches.length > 5000)
    throw new Error('Deltamod must contain 1–5000 patch entries.');
  const mappedGame =
    typeof meta.game === 'string' ? meta.game.trim().toLowerCase() : '';
  const game =
    (Object.hasOwn(gameMap, mappedGame) ? gameMap[mappedGame] : null) ||
    (/^[a-z][a-z0-9_-]{0,63}$/.test(meta.game || '')
      ? meta.game
      : meta.demoMod || info.deltaruneTargetVersion === 'demo'
        ? 'deltarunedemo'
        : 'deltarune');
  let id = String(meta.packageID || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  if (!/^[a-z]/.test(id) || id === 'self' || meta.packageID === 'und.und.und')
    id =
      'local_' +
      String(meta.name || 'mod')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .slice(0, 40) +
      '_' +
      crypto.randomUUID().slice(0, 8);
  id = id.slice(0, 64).replace(/[_-]+$/, '');
  const authors = (
    Array.isArray(meta.author) ? meta.author : [meta.author || 'Unknown']
  )
    .map((value) => String(value).trim())
    .filter(Boolean);
  const config = {
    config_version: '2.0.0',
    id,
    name: String(meta.name || 'Imported Mod')
      .trim()
      .normalize('NFC'),
    version: String(meta.version || '1.0.0')
      .trim()
      .normalize('NFC'),
    authors,
    game,
    files: [],
  };
  for (const patch of patches) {
    const type = String(patch.getAttribute('type') || '').toLowerCase();
    const source = relativePath(patch.getAttribute('patch')),
      target = relativePath(patch.getAttribute('to'));
    if (!Object.hasOwn(allowed, type) || !allowed[type].test(source))
      throw new Error(`Unsupported Deltamod patch: ${type}, ${source}`);
    let resolved = keys.find((key) => key === source);
    if (!resolved) {
      const matches = keys.filter(
        (key) =>
          key.toLowerCase() === source.toLowerCase() ||
          key.toLowerCase().endsWith('/' + source.toLowerCase())
      );
      if (matches.length !== 1)
        throw new Error(`Missing or ambiguous Deltamod source: ${source}`);
      resolved = matches[0];
    }
    let destination = target;
    if (game !== 'deltarune')
      destination = destination.replace(/^chapter\d+_(?:windows|mac)\//, '');
    const operation =
      type === 'csx' ||
      type === 'g3mpatch' ||
      (type === 'xdelta' && !/\.win$/i.test(source))
        ? 'patch'
        : 'overwrite';
    config.files.push({
      source: '${mod_path}/' + resolved,
      target: '${game_path}/' + destination,
      type: operation,
    });
  }
  for (const path of keys)
    if (DOCUMENT_EXTENSIONS.test(path) && !path.includes('/'))
      config.files.push({ source: '${mod_path}/' + path, type: 'info' });
  const icon = keys.find((path) =>
    /^_?icon\.(png|jpg|jpeg|gif|bmp|ico)$/i.test(path)
  );
  if (icon) config.icon = '${mod_path}/' + icon;
  if (meta.description)
    config.description = String(meta.description)
      .trim()
      .replace(/\r\n?/g, '\n')
      .normalize('NFC');
  if (meta.url) config.homepage = String(meta.url).trim();
  const gameVersion =
    info.deltaruneTargetVersion || info.undertaleTargetVersion;
  if (gameVersion && gameVersion !== 'demo')
    config.game_version = String(gameVersion).trim();
  if (Array.isArray(meta.tags)) {
    const tags = [
      ...new Set(meta.tags.filter((tag) => MOD_ALLOWED_TAGS.includes(tag))),
    ];
    if (tags.length) config.tags = tags;
  }
  const converted = {
    files: Object.fromEntries(
      Object.entries(files).filter(
        ([path]) => path !== metadataName && path !== xmlName
      )
    ),
    directories: [...assets.directories],
  };
  return { config, assets: converted, format: 'deltamod' };
}
