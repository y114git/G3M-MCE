import { GAME_IDS, getGameDefinition, getGameTabs } from './gameDefinitions';

export const MOD_CONFIG_VERSION = '1.0.0';
export const MOD_ALLOWED_TAGS = ['textedit', 'customization', 'gameplay', 'other', 'cyop', 'afom'];
export const DATA_FILE_EXTENSIONS = [
  ".xdelta",
  ".vcdiff", 
  ".win",
  ".unx",
  ".ios",
  ".droid",
  ".g3mpatch",
];
export const MOD_FIELD_LIMITS = {
  id: 50,
  name: 50,
  version: 20,
  game: 30,
  description: 200,
  homepage: 1000,
  icon: 1000,
  gameVersion: 1000,
  fileValue: 1000
};

const METADATA_KEYS = ['id', 'name', 'version', 'author', 'description', 'homepage', 'icon', 'game', 'game_version', 'tags'];

function trimString(value, limit) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, limit);
}

function normalizeHomepage(value) {
  const homepage = trimString(value, MOD_FIELD_LIMITS.homepage);
  if (!homepage) return '';
  try {
    const parsed = new URL(homepage);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function normalizeStoredPath(pathValue, { allowDirectory = true } = {}) {
  const raw = String(pathValue || '');
  if (!raw.trim()) return '';
  const preserveDirectory = allowDirectory && raw.trimEnd().endsWith('/');
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').trim().replace(/^\/+/, '');
  if (!normalized) return '';
  return preserveDirectory ? `${normalized.replace(/\/+$/, '')}/` : normalized.replace(/\/+$/, '');
}

export function sanitizeTags(tagsRaw) {
  const source = Array.isArray(tagsRaw) ? tagsRaw : tagsRaw ? [tagsRaw] : [];
  const tags = [];
  for (const entry of source) {
    const normalized = trimString(entry, 100).toLowerCase();
    if (MOD_ALLOWED_TAGS.includes(normalized) && !tags.includes(normalized)) {
      tags.push(normalized);
    }
  }
  if (tags.length === 0) tags.push('other');
  return tags;
}

export function parseExtraFilesRaw(extraFilesRaw) {
  const result = [];
  if (!extraFilesRaw) return result;

  const appendValue = (value) => {
    const normalized = normalizeStoredPath(value);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  };

  if (Array.isArray(extraFilesRaw)) {
    for (const entry of extraFilesRaw) {
      if (typeof entry === 'string') appendValue(entry);
      else if (entry && typeof entry === 'object') appendValue(entry.file_path || entry.path || entry.url || entry.value);
    }
  } else if (typeof extraFilesRaw === 'object') {
    for (const filenames of Object.values(extraFilesRaw)) {
      if (Array.isArray(filenames)) {
        filenames.forEach(appendValue);
      } else if (filenames) {
        appendValue(filenames);
      }
    }
  } else if (typeof extraFilesRaw === 'string') {
    appendValue(extraFilesRaw);
  }

  return result;
}

export function createEmptyModConfig(gameId = 'deltarune') {
  return {
    config_version: MOD_CONFIG_VERSION,
    name: '',
    version: '1.0.0',
    author: '',
    description: '',
    homepage: '',
    icon: '',
    game: gameId,
    game_version: '1.04',
    tags: ['other'],
    files: {}
  };
}

function getMetadataValue(config, key) {
  if (config && config[key] !== undefined && config[key] !== null && config[key] !== '') return config[key];
  if (config && config.metadata && typeof config.metadata === 'object') return config.metadata[key];
  return '';
}

function normalizeFiles(filesData, gameId) {
  const normalized = {};
  if (!filesData || typeof filesData !== 'object') return normalized;

  for (const [rawKey, rawValue] of Object.entries(filesData)) {
    if (!rawValue || typeof rawValue !== 'object') continue;
    const fileKey = trimString(rawKey, MOD_FIELD_LIMITS.fileValue);
    if (!fileKey) continue;

    const entry = {};
    const description = trimString(rawValue.description, MOD_FIELD_LIMITS.description);
    if (description) entry.description = description;

    const dataFilePath = normalizeStoredPath(rawValue.data_file_path || rawValue.data_file_url || rawValue.dataPath);
    if (dataFilePath) entry.data_file_path = dataFilePath;

    const extraFiles = parseExtraFilesRaw(rawValue.extra_files);
    if (extraFiles.length > 0) entry.extra_files = extraFiles;

    if (Object.keys(entry).length > 0) normalized[fileKey] = entry;
  }

  if (!GAME_IDS.has(gameId)) return normalized;

  const ordered = {};
  for (const tab of getGameTabs(gameId)) {
    if (normalized[tab.filesKey]) ordered[tab.filesKey] = normalized[tab.filesKey];
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (!ordered[key]) ordered[key] = value;
  }
  return ordered;
}

export function normalizeModConfigData(configData) {
  const config = configData && typeof configData === 'object' ? configData : {};
  const game = trimString(getMetadataValue(config, 'game'), MOD_FIELD_LIMITS.game) || 'deltarune';
  const normalizedGame = GAME_IDS.has(game) ? game : 'deltarune';

  return {
    config_version: MOD_CONFIG_VERSION,
    id: trimString(getMetadataValue(config, 'id'), MOD_FIELD_LIMITS.id),
    name: trimString(getMetadataValue(config, 'name'), MOD_FIELD_LIMITS.name),
    version: trimString(getMetadataValue(config, 'version'), MOD_FIELD_LIMITS.version) || '1.0.0',
    author: trimString(getMetadataValue(config, 'author'), MOD_FIELD_LIMITS.fileValue),
    description: trimString(getMetadataValue(config, 'description') || getMetadataValue(config, 'tagline'), MOD_FIELD_LIMITS.description),
    homepage: normalizeHomepage(getMetadataValue(config, 'homepage') || getMetadataValue(config, 'external_url')),
    icon: trimString(getMetadataValue(config, 'icon'), MOD_FIELD_LIMITS.icon),
    game: normalizedGame,
    game_version: trimString(getMetadataValue(config, 'game_version'), MOD_FIELD_LIMITS.gameVersion),
    tags: sanitizeTags(getMetadataValue(config, 'tags')),
    files: normalizeFiles(config.files || config.file_groups || {}, normalizedGame)
  };
}

export function buildModConfigData(configData) {
  const normalized = normalizeModConfigData(configData);
  const metadata = {};
  for (const key of METADATA_KEYS) {
    if (normalized[key] !== undefined && normalized[key] !== '' && !(Array.isArray(normalized[key]) && normalized[key].length === 0)) {
      metadata[key] = normalized[key];
    }
  }
  return {
    config_version: MOD_CONFIG_VERSION,
    metadata,
    files: normalized.files
  };
}

export function listTabFileKeys(gameId) {
  return getGameDefinition(gameId).tabs.map((tab) => tab.filesKey);
}
