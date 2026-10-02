export const MOD_CONFIG_VERSION = '2.0.0';
export const MOD_ALLOWED_TAGS = [
  'textedit',
  'customization',
  'gameplay',
  'other',
  'CYOP/AFOM',
];
export const OPERATION_TYPES = [
  'info',
  'patch',
  'overwrite',
  'extract',
  'soft-overwrite',
  'soft-extract',
  'hard-overwrite',
  'hard-extract',
];
export const RELATION_MODES = [
  'before',
  'after',
  'before-step',
  'after-step',
  'before-priority',
  'after-priority',
];
export const BUILTIN_PATHS = [
  'mod_path',
  'game_path',
  'game_data_path',
  'user_path',
];
export const DOCUMENT_EXTENSIONS = /\.(md|markdown|txt|html|htm|pdf)$/i;
export const ARCHIVE_EXTENSIONS =
  /\.(tar\.lzma|tar\.gz|tar\.bz2|tar\.xz|tgz|tbz2|txz|zip|7z|rar|tar|lzma)$/i;
const required = [
  'config_version',
  'id',
  'name',
  'version',
  'authors',
  'game',
  'files',
];
const optional = [
  'description',
  'homepage',
  'icon',
  'game_version',
  'tags',
  'placeholders',
  'dependencies',
  'conflicts',
];
// Unlike $, this end assertion does not accept a final line break.
const idPattern = /^[a-z][a-z0-9_-]{0,63}(?![\s\S])/;
const rootPattern = /^\$\{([A-Za-z][A-Za-z0-9_]*)\}(.*)$/;
const forbidden = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const length = (value) => [...value].length;

export function createEmptyModConfig() {
  return {
    config_version: MOD_CONFIG_VERSION,
    id: '',
    name: '',
    version: '1.0.0',
    authors: [],
    game: 'deltarune',
    files: [],
  };
}

export function normalizeRelation(value) {
  const candidate = value.trim(),
    mode =
      /:(before|after|before-step|after-step|before-priority|after-priority)$/.exec(
        candidate
      );
  const input = mode ? candidate.slice(0, mode.index) : candidate;
  try {
    const url = new URL(input);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['gamebanana.com', 'www.gamebanana.com'].includes(url.host) ||
      url.username ||
      url.password
    )
      return candidate;
    const parts = url.pathname.split('/').filter(Boolean);
    if (
      parts.length === 2 &&
      ['mods', 'wips'].includes(parts[0].toLowerCase()) &&
      /^\d+$/.test(parts[1])
    )
      return `gb_${parts[0].toLowerCase().slice(0, -1)}_${parts[1]}${mode ? mode[0] : ''}`;
  } catch {
    /* Plain mod IDs do not need URL conversion. */
  }
  return candidate;
}

// Reject duplicate keys instead of silently replacing an earlier value.
export function parseConfigJson(text) {
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024)
    throw new Error('mod_config.json exceeds 4 MiB.');
  let position = 0;
  const whitespace = () => {
    while (/[\t\r\n ]/.test(text[position] || '\0')) position++;
  };
  const string = () => {
    const start = position++;
    while (position < text.length) {
      if (text[position] === '\\') position += 2;
      else if (text[position++] === '"')
        return JSON.parse(text.slice(start, position));
    }
    throw new Error('Unterminated JSON string.');
  };
  const value = (depth) => {
    if (depth > 64) throw new Error('JSON nesting exceeds 64 levels.');
    whitespace();
    if (text[position] === '"') return string();
    if (text[position] === '{' || text[position] === '[') {
      const isObject = text[position++] === '{';
      const result = isObject ? Object.create(null) : [];
      const close = isObject ? '}' : ']';
      whitespace();
      if (text[position] === close) {
        position++;
        return result;
      }
      while (true) {
        whitespace();
        let key;
        if (isObject) {
          if (text[position] !== '"')
            throw new Error('Expected a JSON property name.');
          key = string();
          if (Object.hasOwn(result, key))
            throw new Error(`Duplicate JSON key: ${key}`);
          whitespace();
          if (text[position++] !== ':') throw new Error('Expected a colon.');
        }
        const item = value(depth + 1);
        if (isObject) result[key] = item;
        else result.push(item);
        whitespace();
        const separator = text[position++];
        if (separator === close) break;
        if (separator !== ',') throw new Error('Expected a JSON separator.');
      }
      return result;
    }
    const match =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(position)
      );
    if (!match) throw new Error('Invalid JSON value.');
    position += match[0].length;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed === 'number' && !Number.isFinite(parsed))
      throw new Error('Invalid JSON number.');
    return parsed;
  };
  const result = value(0);
  whitespace();
  if (position !== text.length)
    throw new Error('Unexpected content after JSON.');
  if (!object(result)) throw new Error('Mod config must be an object.');
  return result;
}

export function localRelativePath(value, placeholders = {}) {
  placeholders ??= {};
  if (typeof value !== 'string') return null;
  const match = rootPattern.exec(value);
  if (!match) return null;
  let base = '';
  if (match[1] !== 'mod_path') {
    const alias =
      Object.hasOwn(placeholders, match[1]) &&
      rootPattern.exec(placeholders[match[1]]);
    if (!alias || alias[1] !== 'mod_path') return null;
    base = alias[2];
  }
  return [base, match[2]]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

export function* operationLeaves(files, prefix = 'files', depth = 0) {
  if (!Array.isArray(files) || depth > 32) return;
  for (let index = 0; index < files.length; index++) {
    const entry = files[index],
      path = `${prefix}[${index}]`;
    if (!object(entry)) continue;
    if ('source' in entry || 'type' in entry) yield { entry, path };
    else
      for (const [name, children] of Object.entries(entry))
        yield* operationLeaves(children, `${path}.${name}`, depth + 1);
  }
}

export function validateModConfig(config) {
  const issues = [],
    issue = (path, message, field) =>
      issues.push({ path, message, ...(field ? { field } : {}) });
  if (!object(config)) return [{ path: '$', message: 'Must be an object.' }];
  const depth = (value, level = 0) => {
    if (level > 64) return 65;
    if (value === null || typeof value !== 'object') return 0;
    let maximum = 0;
    for (const item of Object.values(value)) {
      maximum = Math.max(maximum, depth(item, level + 1));
      if (maximum > 64) break;
    }
    return 1 + maximum;
  };
  if (depth(config) > 64)
    return [{ path: '$', message: 'JSON nesting exceeds 64 levels.' }];
  for (const key of required)
    if (!Object.hasOwn(config, key)) issue(key, 'Required field.');
  for (const key of Object.keys(config))
    if (![...required, ...optional].includes(key)) issue(key, 'Unknown field.');
  if (config.config_version !== MOD_CONFIG_VERSION)
    issue('config_version', 'Expected 2.0.0.');
  const display = (value, path, limit = 128, multiline = false) => {
    if (
      typeof value !== 'string' ||
      !value ||
      length(value) > limit ||
      (!multiline && value !== value.trim()) ||
      value !== value.normalize('NFC') ||
      forbidden.test(multiline ? value.replace(/\n/g, '') : value)
    )
      issue(
        path,
        `Use nonempty NFC text, at most ${limit} characters${multiline ? ', with LF line endings' : ', without surrounding whitespace'}.`
      );
  };
  for (const key of ['id', 'game'])
    if (
      typeof config[key] !== 'string' ||
      !idPattern.test(config[key]) ||
      config[key] === 'self'
    )
      issue(
        key,
        'Use 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter; self is reserved.'
      );
  for (const key of ['name', 'version']) display(config[key], key);
  if (!Array.isArray(config.authors) || config.authors.length > 64)
    issue('authors', 'Use an array with at most 64 authors.');
  else
    config.authors.forEach((author, index) =>
      display(author, `authors[${index}]`)
    );
  if ('game_version' in config) display(config.game_version, 'game_version');
  if ('description' in config)
    display(config.description, 'description', 16384, true);
  const url = (value, path) => {
    try {
      if (
        typeof value !== 'string' ||
        !value ||
        length(value) > 2048 ||
        /\s/u.test(value) ||
        forbidden.test(value) ||
        !/^https?:\/\//i.test(value) ||
        /^https?:\/\/[^/?#]*@/i.test(value)
      )
        throw new Error();
      const parsed = new URL(value);
      if (!parsed.hostname || parsed.username || parsed.password)
        throw new Error();
    } catch {
      issue(
        path,
        'Use an HTTP(S) URL without credentials, whitespace or control characters.'
      );
    }
  };
  if ('homepage' in config) url(config.homepage, 'homepage');
  if (
    'tags' in config &&
    (!Array.isArray(config.tags) ||
      !config.tags.length ||
      config.tags.length > 64 ||
      config.tags.some((tag) => !MOD_ALLOWED_TAGS.includes(tag)) ||
      new Set(config.tags).size !== config.tags.length)
  )
    issue('tags', 'Choose unique supported tags, or omit tags.');
  const pathError = (value) =>
    typeof value !== 'string' ||
    !value ||
    length(value) > 4096 ||
    value !== value.trim() ||
    value.includes('\\') ||
    value.includes('//') ||
    value.split('/').some((part) => part === '.' || part === '..') ||
    forbidden.test(value);
  const aliases = Object.create(null);
  // G3M accepts null for placeholders and relationship lists, as well as omission.
  if (config.placeholders != null) {
    if (
      !object(config.placeholders) ||
      !Object.keys(config.placeholders).length ||
      Object.keys(config.placeholders).length > 128
    )
      issue(
        'placeholders',
        'Use a nonempty object with at most 128 custom paths.'
      );
    else {
      const seen = new Set();
      for (const [name, value] of Object.entries(config.placeholders)) {
        const root = typeof value === 'string' && rootPattern.exec(value);
        if (
          !/^[A-Za-z][A-Za-z0-9_]{0,63}(?![\s\S])/.test(name) ||
          BUILTIN_PATHS.includes(name.toLowerCase()) ||
          seen.has(name.toLowerCase())
        )
          issue(
            `placeholders.${name}`,
            'Use a unique name; built-in names are reserved.',
            'name'
          );
        seen.add(name.toLowerCase());
        if (
          pathError(value) ||
          !root ||
          !BUILTIN_PATHS.includes(root[1]) ||
          !root[2].startsWith('/') ||
          (value.match(/\$\{[^}]*\}/g) || []).length !== 1
        )
          issue(
            `placeholders.${name}`,
            'Start with one built-in path and a /suffix.',
            'path'
          );
        else aliases[name] = value;
      }
    }
  }
  const path = (value, key, target = false) => {
    if (pathError(value)) {
      issue(
        key,
        'Use a nonempty path with / separators, without dot segments, empty segments or control characters.'
      );
      return;
    }
    const match = rootPattern.exec(value),
      count = (value.match(/\$\{[^}]*\}/g) || []).length;
    if (
      match
        ? count !== 1 ||
          ![...BUILTIN_PATHS, ...Object.keys(aliases)].includes(match[1]) ||
          !match[2].startsWith('/')
        : count || !/^(?:[A-Za-z]:\/|\/)/.test(value)
    )
      issue(
        key,
        'Start with one known path placeholder and /suffix, or an absolute path.'
      );
    if (
      target &&
      match &&
      (match[1] === 'mod_path' || aliases[match[1]]?.startsWith('${mod_path}/'))
    )
      issue(key, 'Cannot target the mod directory.');
    if (target && /\.rar\//i.test(value))
      issue(key, 'Targets inside RAR archives cannot be written.');
    if (/\.lzma\//i.test(value.replace(/\.tar\.lzma\//gi, '.tar/')))
      issue(key, 'LZMA streams do not have archive members.');
    const virtual =
      /^.*?\.(?:tar\.lzma|tar\.gz|tar\.bz2|tar\.xz|tgz|tbz2|txz|zip|7z|rar|tar|lzma)\/(.*)$/i.exec(
        value
      );
    if (
      virtual &&
      (length(virtual[1]) > 1024 ||
        virtual[1]
          .split('/')
          .some(
            (part) =>
              part &&
              (/[ .]$|[:<>"|?*]/.test(part) ||
                /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
                  part
                ))
          ))
    )
      issue(key, 'Archive member path is unsafe.');
  };
  if ('icon' in config) {
    if (typeof config.icon === 'string' && /^https?:/.test(config.icon))
      url(config.icon, 'icon');
    else {
      path(config.icon, 'icon');
      if (!localRelativePath(config.icon, aliases))
        issue('icon', 'Use a file inside the mod.');
    }
  }
  const relationIds = {};
  for (const field of ['dependencies', 'conflicts']) {
    const values = config[field],
      seen = (relationIds[field] = new Set());
    if (values == null) continue;
    if (!Array.isArray(values) || !values.length || values.length > 512) {
      issue(field, 'Use a nonempty array with at most 512 relationships.');
      continue;
    }
    values.forEach((value, index) => {
      const [id, mode, extra] =
        typeof value === 'string' ? value.split(':') : [];
      if (
        !idPattern.test(id || '') ||
        id === 'self' ||
        id === config.id ||
        seen.has(id) ||
        extra !== undefined ||
        (mode !== undefined && !RELATION_MODES.includes(mode))
      )
        issue(
          `${field}[${index}]`,
          'Use a different mod ID, optionally followed by :mode, without duplicate IDs.'
        );
      seen.add(id);
    });
  }
  for (const id of relationIds.dependencies)
    if (relationIds.conflicts.has(id))
      issue('dependencies', `${id} is also listed as a conflict.`);
  let leaves = 0,
    groups = 0;
  const names = new Set();
  const visit = (files, prefix, depth) => {
    if (!Array.isArray(files)) {
      issue(prefix, 'Use an ordered array.');
      return;
    }
    if (depth > 32) {
      issue(prefix, 'Groups exceed 32 levels.');
      return;
    }
    files.forEach((entry, index) => {
      const key = `${prefix}[${index}]`;
      if (!object(entry)) {
        issue(key, 'Use a file operation or named group.');
        return;
      }
      if ('source' in entry || 'type' in entry) {
        leaves++;
        for (const field of Object.keys(entry))
          if (
            ![
              'source',
              'target',
              'type',
              'source_hash',
              'target_hash',
            ].includes(field)
          )
            issue(`${key}.${field}`, 'Unknown operation field.');
        if (!OPERATION_TYPES.includes(entry.type))
          issue(`${key}.type`, 'Unsupported operation type.');
        path(entry.source, `${key}.source`);
        if (entry.type === 'info') {
          if ('target' in entry || 'target_hash' in entry)
            issue(key, 'Info files cannot have a target or target hash.');
          if (
            localRelativePath(entry.source, aliases) === null ||
            !DOCUMENT_EXTENSIONS.test(entry.source)
          )
            issue(`${key}.source`, 'Use a documentation file inside the mod.');
        } else {
          path(entry.target, `${key}.target`, true);
          if (
            entry.type?.endsWith?.('extract') &&
            typeof entry.target === 'string' &&
            ((!entry.target.endsWith('/') &&
              !entry.target.toLowerCase().endsWith('.lzma')) ||
              (entry.type === 'hard-extract' &&
                entry.target.toLowerCase().endsWith('.lzma')))
          )
            issue(
              `${key}.target`,
              'Extract needs a directory ending in /; hard-extract cannot target LZMA.'
            );
          if (
            entry.type === 'patch' &&
            (entry.source?.endsWith?.('/') || entry.target?.endsWith?.('/'))
          )
            issue(key, 'Patch source and target must be files.');
        }
        for (const field of ['source_hash', 'target_hash'])
          if (
            field in entry &&
            (typeof entry[field] !== 'string' ||
              entry[field].length !== 71 ||
              !/^sha256:[0-9a-f]{64}$/.test(entry[field]))
          )
            issue(
              `${key}.${field}`,
              'Use sha256: followed by 64 lowercase hexadecimal digits.'
            );
      } else {
        const entries = Object.entries(entry);
        if (entries.length !== 1) {
          issue(key, 'Use exactly one group name.');
          return;
        }
        const [name, children] = entries[0];
        display(name, `${key}.name`);
        if (names.has(name.normalize('NFC')))
          issue(key, 'Group names must be unique throughout the mod.');
        names.add(name.normalize('NFC'));
        groups++;
        visit(children, `${key}.${name}`, depth + 1);
      }
    });
  };
  visit(config.files, 'files', 1);
  if (leaves > 5000 || groups > 2000)
    issue('files', 'Maximum: 5000 operations and 2000 groups.');
  return issues;
}

export function buildModConfigData(config) {
  const issues = validateModConfig(config);
  if (issues.length)
    throw new Error(
      issues.map(({ path, message }) => `${path}: ${message}`).join('\n')
    );
  const result = Object.fromEntries(
    [...required.slice(0, -1), ...optional, 'files']
      .filter((key) => key in config)
      .map((key) => [key, config[key]])
  );
  if (new TextEncoder().encode(JSON.stringify(result)).length > 4 * 1024 * 1024)
    throw new Error('mod_config.json exceeds 4 MiB.');
  return structuredClone(result);
}
