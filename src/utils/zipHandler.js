import {
  buildModConfigData,
  localRelativePath,
  operationLeaves,
  parseConfigJson,
} from '../data/modConfig';
import { migrateModConfig } from './migrationService';
import { convertDeltamodArchive } from './modConverter';

export const MAX_PACKAGE_ENTRIES = 10000;
export const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
export function emptyAssets() {
  return { files: Object.create(null), directories: [] };
}
export function safePackagePath(path, directory = false) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.length > 1024 ||
    path !== path.normalize('NFC') ||
    /[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(path) ||
    path.startsWith('/')
  )
    throw new Error(`Unsafe archive path: ${path}`);
  const normalized = directory ? path.replace(/\/$/, '') : path;
  if (
    normalized
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[ .]$/.test(part) ||
          /[<>"|?*]/.test(part) ||
          /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
            part
          )
      )
  )
    throw new Error(`Unsafe archive path: ${path}`);
  return normalized + (directory ? '/' : '');
}

function checkPaths(paths) {
  if (paths.length > MAX_PACKAGE_ENTRIES)
    throw new Error('Package has more than 10000 files or folders.');
  const seen = new Set(),
    files = new Set(),
    spellings = new Map();
  for (const path of paths) {
    safePackagePath(path, path.endsWith('/'));
    const key = path.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate archive path: ${path}`);
    seen.add(key);
    if (!path.endsWith('/')) files.add(key);
    const parts = path.replace(/\/$/, '').split('/');
    for (let end = 1; end <= parts.length; end++) {
      const prefix = parts.slice(0, end).join('/'),
        folded = prefix.toLowerCase();
      if (spellings.has(folded) && spellings.get(folded) !== prefix)
        throw new Error(`Conflicting archive path case: ${path}`);
      spellings.set(folded, prefix);
    }
  }
  for (const path of paths) {
    const parts = path.replace(/\/$/, '').toLowerCase().split('/');
    for (let end = 1; end < parts.length; end++)
      if (files.has(parts.slice(0, end).join('/')))
        throw new Error(`A file is also used as a folder: ${path}`);
  }
}

// Inspect entries before JSZip can merge duplicate names or allocate decompressed data.
function inspectZip(bytes, collectHighlyCompressed = false) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--;
  if (end < 0 || end < bytes.length - 65557)
    throw new Error('Invalid ZIP directory.');
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw new Error('Split ZIP archives are not supported.');
  const count = view.getUint16(end + 10, true);
  if (count > MAX_PACKAGE_ENTRIES || count === 65535)
    throw new Error('Too many ZIP entries.');
  let offset = view.getUint32(end + 16, true),
    total = 0;
  const paths = [],
    highlyCompressed = [];
  for (let index = 0; index < count; index++) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error('Invalid ZIP entry.');
    const flags = view.getUint16(offset + 8, true),
      compressed = view.getUint32(offset + 20, true),
      size = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true),
      extraSize = view.getUint16(offset + 30, true),
      commentSize = view.getUint16(offset + 32, true);
    if (flags & 1) throw new Error('Encrypted ZIP archives are not supported.');
    if (offset + 46 + nameSize + extraSize + commentSize > bytes.length)
      throw new Error('Truncated ZIP entry.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameSize)
    );
    paths.push(name);
    total += size;
    if (size > 512 * 1024 * 1024 || total > MAX_PACKAGE_BYTES)
      throw new Error(
        'Archive is too large for the web editor (1 GiB total, 512 MiB per file).'
      );
    if (size > Math.max(1, compressed) * 1000) {
      if (!collectHighlyCompressed)
        throw new Error('Archive compression ratio exceeds G3M limits.');
      highlyCompressed.push(name);
    }
    if (((view.getUint32(offset + 38, true) >>> 16) & 0xf000) === 0xa000)
      throw new Error('Symbolic links are not allowed in mod archives.');
    offset += 46 + nameSize + extraSize + commentSize;
  }
  checkPaths(paths);
  return { count, highlyCompressed };
}

async function loadPayloadZip(input) {
  const bytes = await fileBytes(input);
  if (bytes.byteLength > MAX_PACKAGE_BYTES)
    throw new Error('Archive exceeds the web editor limit of 1 GiB.');
  const { count } = inspectZip(bytes);
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes, {
    checkCRC32: true,
    createFolders: false,
  });
  const entries = Object.values(zip.files);
  if (entries.length !== count)
    throw new Error('ZIP contains duplicate or ambiguous entries.');
  checkPaths(entries.map((entry) => entry.name));
  for (const entry of entries)
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)
      throw new Error(`Unsafe archive path: ${entry.unsafeOriginalName}`);
  return zip;
}

export async function listPackageZipMembers(path, assets) {
  if (!Object.hasOwn(assets.files, path))
    throw new Error(`Missing bundled ZIP: ${path}`);
  const zip = await loadPayloadZip(assets.files[path]);
  const members = new Set([path + '/']);
  for (const member of Object.keys(zip.files)) {
    members.add(path + '/' + member);
    const parts = member.replace(/\/$/, '').split('/');
    for (let end = 1; end < parts.length; end++)
      members.add(path + '/' + parts.slice(0, end).join('/') + '/');
  }
  return [...members];
}

export async function importZipArchive(input) {
  const zip = await loadPayloadZip(input);
  const entries = Object.values(zip.files).filter(
    (entry) => !entry.name.startsWith('__MACOSX/')
  );
  const manifests = entries.filter(
    (entry) => !entry.dir && /(^|\/)mod_config\.json$/i.test(entry.name)
  );
  const roots = manifests.filter((candidate) =>
    entries.every(
      (entry) =>
        entry.dir ||
        entry.name.startsWith(
          candidate.name.slice(0, -'mod_config.json'.length)
        )
    )
  );
  if (roots.length > 1)
    throw new Error(
      'Archive contains more than one mod_config.json without an unambiguous mod root.'
    );
  const manifest = roots[0];
  let root = manifest?.name.slice(0, -'mod_config.json'.length);
  if (root === undefined) {
    const xml = entries.filter(
      (entry) => !entry.dir && /(^|\/)modding\.xml$/i.test(entry.name)
    );
    if (xml.length !== 1)
      throw new Error(
        manifests.length > 1
          ? 'Archive contains more than one mod_config.json without an unambiguous mod root.'
          : manifests.length
            ? 'Files outside the mod folder make this archive ambiguous.'
            : 'Select a G3M or Deltamod archive.'
      );
    root = xml[0].name.slice(0, -'modding.xml'.length);
  }
  if (entries.some((entry) => !entry.dir && !entry.name.startsWith(root)))
    throw new Error(
      'Files outside the mod folder make this archive ambiguous.'
    );
  const assets = emptyAssets();
  for (const entry of entries) {
    if (!entry.name.startsWith(root)) continue;
    const relative = entry.name.slice(root.length);
    if (!relative || entry === manifest) continue;
    if (entry.dir) assets.directories.push(relative);
    else assets.files[relative] = await entry.async('uint8array');
  }
  if (!manifest) return convertDeltamodArchive(assets);
  const raw = await manifest.async('uint8array');
  const config = migrateModConfig(
    parseConfigJson(new TextDecoder('utf-8', { fatal: true }).decode(raw)),
    assets
  );
  return { config, assets, format: 'g3m' };
}

export async function importConfigFile(file) {
  const raw = new Uint8Array(await file.arrayBuffer());
  return {
    config: migrateModConfig(
      parseConfigJson(new TextDecoder('utf-8', { fatal: true }).decode(raw))
    ),
    assets: emptyAssets(),
    format: 'g3m',
  };
}

export async function exportModArchive({ config, assets }) {
  const canonical = buildModConfigData(config);
  await validatePackage(canonical, assets);
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const directory of assets.directories || []) zip.folder(directory);
  for (const [path, file] of Object.entries(assets.files || {}))
    zip.file(path, await fileBytes(file));
  zip.file('mod_config.json', JSON.stringify(canonical, null, 2) + '\n');
  const generate = () =>
    zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
  let bytes = await generate();
  const { highlyCompressed } = inspectZip(bytes, true);
  if (highlyCompressed.length) {
    for (const path of highlyCompressed)
      zip.file(
        path,
        path === 'mod_config.json'
          ? JSON.stringify(canonical, null, 2) + '\n'
          : await fileBytes(assets.files[path]),
        { compression: 'STORE' }
      );
    bytes = await generate();
    inspectZip(bytes);
  }
  if (bytes.length > MAX_PACKAGE_BYTES)
    throw new Error('ZIP exceeds the web editor limit of 1 GiB.');
  return new Blob([bytes], { type: 'application/zip' });
}

export async function fileBytes(file) {
  return file instanceof Uint8Array
    ? file
    : new Uint8Array(
        file instanceof ArrayBuffer ? file : await file.arrayBuffer()
      );
}

export async function validatePackage(config, assets, thorough = true) {
  const paths = [
    ...Object.keys(assets.files || {}),
    ...(assets.directories || []),
  ];
  checkPaths(paths);
  if (
    paths.some((path) =>
      /^(?:meta\.(?:json|toml)|_deltamodInfo\.json)$/i.test(path)
    )
  )
    throw new Error(
      'Root meta.json, meta.toml and _deltamodInfo.json identify a Deltamod package in G3M. Put these payload files in a subfolder before exporting a G3M ZIP.'
    );
  if (paths.some((path) => /^mod_config\.json$/i.test(path)))
    throw new Error(
      'The editor writes mod_config.json; remove bundled copies of this file.'
    );
  let total = 0;
  for (const file of Object.values(assets.files || {})) {
    const size = file.size ?? file.byteLength ?? 0;
    if (size > 512 * 1024 * 1024)
      throw new Error('A bundled file exceeds 512 MiB.');
    total += size;
  }
  total += new TextEncoder().encode(
    JSON.stringify(config, null, 2) + '\n'
  ).length;
  if (total > MAX_PACKAGE_BYTES) throw new Error('Package exceeds 1 GiB.');
  const local = (value) => {
    const relative = localRelativePath(value, config.placeholders);
    if (relative === null) return;
    if (relative === 'mod_config.json') return;
    const virtual =
      /^(.*?\.(?:tar\.lzma|tar\.gz|tar\.bz2|tar\.xz|zip|7z|rar|tar|tgz|tbz2|txz))\/(.*)$/i.exec(
        relative + (value.endsWith('/') ? '/' : '')
      );
    const path = virtual ? virtual[1] : relative;
    const directory = value.endsWith('/') && !virtual;
    if (
      directory
        ? !(assets.directories || []).includes(path + '/') &&
          !Object.keys(assets.files).some((key) => key.startsWith(path + '/'))
        : !Object.hasOwn(assets.files, path)
    )
      throw new Error(`Missing bundled source: ${relative}`);
  };
  const issues = [];
  if (config.icon) {
    try {
      local(config.icon);
    } catch (error) {
      issues.push({ path: 'icon', message: error.message });
    }
  }
  const virtualZips = new Map();
  for (const { entry, path } of operationLeaves(config.files)) {
    let field = 'source';
    try {
      local(entry.source);
      const relative = localRelativePath(entry.source, config.placeholders);
      const virtual =
        relative !== null &&
        /^(.*?\.zip)\/(.*)$/i.exec(
          relative + (entry.source.endsWith('/') ? '/' : '')
        );
      if (thorough && virtual) {
        if (!virtualZips.has(virtual[1]))
          virtualZips.set(
            virtual[1],
            await listPackageZipMembers(virtual[1], assets)
          );
        const names = virtualZips.get(virtual[1]),
          member = virtual[1] + '/' + virtual[2];
        if (!names.includes(member))
          throw new Error(`Missing ZIP member: ${member}`);
      }
      if (
        thorough &&
        entry.source_hash &&
        localRelativePath(entry.source, config.placeholders) !== null
      ) {
        if (
          !/\.(?:7z|rar|tar|gz|bz2|xz|tgz|tbz2|txz|lzma)\//i.test(
            relative + (entry.source.endsWith('/') ? '/' : '')
          )
        ) {
          field = 'source_hash';
          const actual = await hashPackagePath(
            entry.source,
            assets,
            config.placeholders
          );
          if (actual !== entry.source_hash)
            throw new Error(`Source hash does not match: ${entry.source}`);
        }
      }
    } catch (error) {
      issues.push({ path: `${path}.${field}`, message: error.message });
    }
  }
  if (issues.length) {
    const error = new Error(issues.map((issue) => issue.message).join('\n'));
    error.issues = issues;
    throw error;
  }
}

export async function hashPackagePath(value, assets, placeholders = {}) {
  const relative = localRelativePath(value, placeholders);
  if (relative === null)
    throw new Error('Select a bundled file or folder to calculate its hash.');
  const virtual = /^(.*?\.zip)\/(.*)$/i.exec(
    relative + (value.endsWith('/') ? '/' : '')
  );
  if (virtual) {
    if (!Object.hasOwn(assets.files, virtual[1]))
      throw new Error(`Missing bundled ZIP: ${virtual[1]}`);
    const zip = await loadPayloadZip(assets.files[virtual[1]]);
    const nested = emptyAssets();
    for (const entry of Object.values(zip.files)) {
      safePackagePath(entry.name, entry.dir);
      if (entry.dir) nested.directories.push(entry.name);
      else nested.files[entry.name] = await entry.async('uint8array');
    }
    return hashPackagePath('${mod_path}/' + virtual[2], nested);
  }
  let content;
  if (!value.endsWith('/')) {
    if (!Object.hasOwn(assets.files, relative))
      throw new Error(`Missing bundled file: ${relative}`);
    content = await fileBytes(assets.files[relative]);
  } else {
    const prefix = relative ? relative + '/' : '',
      directories = new Set();
    const entries = new Map();
    for (const path of [...Object.keys(assets.files), ...assets.directories]) {
      if (!path.startsWith(prefix) || path === prefix) continue;
      const key = path.slice(prefix.length).replace(/\/$/, '');
      entries.set(key, path.endsWith('/') ? null : assets.files[path]);
      const parts = key.split('/');
      for (let end = 1; end < parts.length; end++)
        directories.add(parts.slice(0, end).join('/'));
    }
    if (!entries.size && !assets.directories.includes(prefix))
      throw new Error(`Missing bundled folder: ${relative}`);
    for (const directory of directories)
      if (!entries.has(directory)) entries.set(directory, null);
    const encode = (value) => new TextEncoder().encode(value);
    const integer = (value) => {
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
      return bytes;
    };
    const blocks = [],
      field = (bytes) => {
        blocks.push(integer(bytes.length), bytes);
      };
    const keys = [...entries.keys()].sort((a, b) => {
      const x = encode(a),
        y = encode(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++)
        if (x[i] !== y[i]) return x[i] - y[i];
      return x.length - y.length;
    });
    for (const key of keys) {
      const file = entries.get(key);
      field(encode(file === null ? 'D' : 'F'));
      field(encode(key));
      if (file === null) field(new Uint8Array());
      else {
        const bytes = await fileBytes(file);
        field(integer(bytes.length));
        blocks.push(bytes);
      }
    }
    content = await new Blob(blocks).arrayBuffer();
  }
  const hash = await crypto.subtle.digest('SHA-256', content);
  return (
    'sha256:' +
    [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function downloadZip(blob, filename) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
