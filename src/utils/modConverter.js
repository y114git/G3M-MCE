function parseToPath(toPath) {
  if (!toPath) {
    return { chapterKey: null, relativePath: '', filename: '' };
  }

  let normalizedPath = toPath.replace(/^\.\//, '').replace(/\\/g, '/');

  let chapterKey = null;
  if (normalizedPath.toLowerCase().includes('demo')) {
    chapterKey = 'demo';
  } else {
    const chapterMatch = normalizedPath.match(/chapter(\d+)/i);
    if (chapterMatch) {
      const chapterNum = parseInt(chapterMatch[1], 10);
      if (chapterNum >= 0) {
        chapterKey = String(chapterNum);
      }
    } else {
      chapterKey = '0';
    }
  }

  if (!chapterKey) {
    return { chapterKey: null, relativePath: '', filename: '' };
  }

  const pathWithoutChapter = normalizedPath
    .replace(/chapter\d+_windows?\//i, '')
    .replace(/^\.\//, '');

  const lastSlash = pathWithoutChapter.lastIndexOf('/');
  let dirPart = '';
  let filename = pathWithoutChapter;

  if (lastSlash !== -1) {
    dirPart = pathWithoutChapter.substring(0, lastSlash);
    filename = pathWithoutChapter.substring(lastSlash + 1);
  }

  const relativePath = dirPart ? dirPart.replace(/\\/g, '/') + '/' : '';

  return { chapterKey, relativePath, filename };
}

function getAttr(element, attr) {
  if (!element) return null;
  if (typeof element.getAttribute === 'function') {
    return element.getAttribute(attr);
  }
  if (typeof element.get === 'function') {
    return element.get(attr);
  }
  return element[attr] || null;
}

function findChildren(element, tagName) {
  if (!element) return [];

  if (element.documentElement) {
    element = element.documentElement;
  }

  if (typeof element.getElementsByTagName === 'function') {
    return Array.from(element.getElementsByTagName(tagName));
  }
  if (typeof element.findall === 'function') {
    return element.findall(tagName);
  }
  if (element.patches && Array.isArray(element.patches)) {
    return element.patches;
  }
  return [];
}

function getTagName(element) {
  if (!element) return '';
  if (element.documentElement) {
    element = element.documentElement;
  }
  if (element.tagName) {
    return element.tagName.toLowerCase();
  }
  if (element.tag) {
    return element.tag.toLowerCase();
  }
  return '';
}

function generateFilesStructure(moddingXml, deltamodInfo) {
  const filesStructure = {};

  if (!moddingXml) {
    return filesStructure;
  }

  let root = moddingXml;
  if (moddingXml.documentElement) {
    root = moddingXml.documentElement;
  }

  let patches = [];
  const rootTag = getTagName(root);

  if (rootTag === 'patch') {
    patches.push(root);
  } else {
    patches = findChildren(root, 'patch');
  }

  const modVersion = deltamodInfo?.metadata?.version || '1.0.0';

  for (const patch of patches) {
    const toPath = getAttr(patch, 'to');
    const patchFile = getAttr(patch, 'patch');
    const patchType = getAttr(patch, 'type');

    if (!toPath || !patchFile || !patchType) {
      continue;
    }

    const { chapterKey, relativePath, filename } = parseToPath(toPath);

    if (!chapterKey) {
      continue;
    }

    if (!filesStructure[chapterKey]) {
      filesStructure[chapterKey] = {};
    }

    if (patchType === 'xdelta') {
      const patchBasename = patchFile.replace(/^\.\//, '').split('/').pop();
      filesStructure[chapterKey].data_file_url = patchBasename;
      filesStructure[chapterKey].data_file_version = modVersion;
    } else if (patchType === 'override') {
      if (!filesStructure[chapterKey].extra_files) {
        filesStructure[chapterKey].extra_files = [];
      }

      let archiveKey = (relativePath + filename).replace(/\//g, '_').replace(/\\/g, '_');
      archiveKey = archiveKey || filename;
      const archiveName = `extra_file_${archiveKey}.zip`;
      const sourceFilePath = patchFile.replace(/^\.\//, '');

      const existingExtra = filesStructure[chapterKey].extra_files.find(e => e.key === archiveKey);
      if (!existingExtra) {
        filesStructure[chapterKey].extra_files.push({
          key: archiveKey,
          url: archiveName,
          version: modVersion,
          _sourceFile: sourceFilePath,
          _targetPath: relativePath + filename
        });
      }
    }
  }

  return filesStructure;
}

export function convertDeltamodToDELTAHUB(deltamodInfo, moddingXml) {
  const meta = deltamodInfo.metadata || {};
  const packageID = meta.packageID || '';

  let modKey;
  if (packageID && packageID !== 'und.und.und') {
    modKey = packageID.replace(/\./g, '_');
  } else {
    modKey = `local_${meta.name || 'unnamed'}_${Date.now().toString(36)}`;
  }

  const createdDate = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const author = Array.isArray(meta.author) ? meta.author.join(', ') : (meta.author || 'Unknown');

  return {
    is_local_mod: true,
    key: modKey,
    created_date: createdDate,
    is_available_on_server: false,
    name: meta.name || 'Local Mod',
    version: meta.version || '1.0.0',
    author: author,
    tagline: meta.description || 'No description',
    external_url: meta.url || '',
    game_version: deltamodInfo.deltaruneTargetVersion || 'Not specified',
    game: meta.demoMod ? 'deltarunedemo' : 'deltarune',
    files: generateFilesStructure(moddingXml, deltamodInfo),
    tags: meta.tags || []
  };
}

function findFileInZip(files, searchPath) {
  if (files[searchPath]) {
    return searchPath;
  }

  const normalizedPath = searchPath.replace(/\\/g, '/');
  if (files[normalizedPath]) {
    return normalizedPath;
  }

  const withDotSlash = `./${normalizedPath}`;
  if (files[withDotSlash]) {
    return withDotSlash;
  }

  const filename = searchPath.split('/').pop().split('\\').pop();
  if (filename) {
    const filenameLower = filename.toLowerCase();
    for (const [filePath, fileEntry] of Object.entries(files)) {
      if (!fileEntry.dir) {
        const filePathLower = filePath.toLowerCase();
        const pathFilename = filePath.split('/').pop().split('\\').pop().toLowerCase();
        if (pathFilename === filenameLower || filePathLower.endsWith('/' + filenameLower) || filePathLower.endsWith('\\' + filenameLower)) {
          return filePath;
        }
      }
    }
  }

  return null;
}

export function extractFileMapping(config, files) {
  const mapping = new Map();

  for (const [chapterKey, chapterFiles] of Object.entries(config.files || {})) {
    if (chapterFiles.data_file_url) {
      const possiblePaths = [
        chapterFiles.data_file_url,
        `./${chapterFiles.data_file_url}`,
        `chapter${chapterKey}_windows/${chapterFiles.data_file_url}`
      ];

      for (const path of possiblePaths) {
        const foundPath = findFileInZip(files, path);
        if (foundPath) {
          mapping.set(`${chapterKey}:data_file`, foundPath);
          break;
        }
      }
    }

    if (chapterFiles.extra_files) {
      for (const extra of chapterFiles.extra_files) {
        if (extra._sourceFile) {
          const foundPath = findFileInZip(files, extra._sourceFile);
          if (foundPath) {
            mapping.set(`${chapterKey}:extra:${extra.key}`, foundPath);
          }
        }
      }
    }
  }

  return mapping;
}
