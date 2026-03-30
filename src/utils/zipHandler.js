import JSZip from 'jszip';
import { getArchiveFolderName, mapConfigFileKeyToTabFilesKey, mapTabFilesKeyToConfigFileKey } from '../data/gameDefinitions';
import { buildModConfigData, normalizeModConfigData, normalizeStoredPath, parseExtraFilesRaw } from '../data/modConfig';
import { convertDeltamodArchive } from './modConverter';
import { migrateModConfigLegacyFields } from './migrationService';

function findEntryByName(zipEntries, pathCandidates) {
  for (const candidate of pathCandidates) {
    const normalizedCandidate = normalizeStoredPath(candidate);
    if (!normalizedCandidate) continue;

    if (zipEntries[normalizedCandidate] && !zipEntries[normalizedCandidate].dir) {
      return zipEntries[normalizedCandidate];
    }

    const suffixMatch = Object.values(zipEntries).find(
      (entry) => !entry.dir && normalizeStoredPath(entry.name) === normalizedCandidate
    );
    if (suffixMatch) return suffixMatch;
  }
  return null;
}

function findEntriesByPrefix(zipEntries, prefix) {
  const normalizedPrefix = normalizeStoredPath(prefix);
  if (!normalizedPrefix) return [];
  const withSlash = normalizedPrefix.endsWith('/') ? normalizedPrefix : `${normalizedPrefix}/`;
  return Object.values(zipEntries).filter(
    (entry) => !entry.dir && normalizeStoredPath(entry.name).startsWith(withSlash)
  );
}

async function buildImportedAssetsFromConfig(config, zipEntries) {
  const assets = { icon: null, tabs: {} };

  if (config.icon && !/^https?:\/\//i.test(config.icon)) {
    const iconEntry = findEntryByName(zipEntries, [config.icon, `icon/${config.icon}`, 'icon.png']);
    if (iconEntry) {
      const iconBlob = await iconEntry.async('blob');
      assets.icon = {
        id: crypto.randomUUID?.() || `asset_${Math.random().toString(36).slice(2, 10)}`,
        kind: 'file',
        storedPath: config.icon.split('/').pop() || 'icon.png',
        label: config.icon.split('/').pop() || 'icon.png',
        file: new File([iconBlob], config.icon.split('/').pop() || 'icon.png', { type: iconBlob.type || 'image/png' })
      };
    }
  }

  for (const [fileKey, fileInfo] of Object.entries(config.files || {})) {
    const tabFilesKey = mapConfigFileKeyToTabFilesKey(fileKey, config.game);
    assets.tabs[tabFilesKey] = { dataFile: null, extraFiles: [] };

    if (fileInfo.data_file_path) {
      // Look for file directly in root, not in chapter folders
      const dataEntry = findEntryByName(zipEntries, [fileInfo.data_file_path]);
      if (dataEntry) {
        const dataBlob = await dataEntry.async('blob');
        assets.tabs[tabFilesKey].dataFile = {
          id: crypto.randomUUID?.() || `asset_${Math.random().toString(36).slice(2, 10)}`,
          kind: 'file',
          storedPath: normalizeStoredPath(fileInfo.data_file_path),
          label: normalizeStoredPath(fileInfo.data_file_path),
          file: new File([dataBlob], normalizeStoredPath(fileInfo.data_file_path).split('/').pop() || 'data.win', {
            type: dataBlob.type || 'application/octet-stream'
          })
        };
      }
    }

    for (const extraPath of parseExtraFilesRaw(fileInfo.extra_files)) {
      if (extraPath.endsWith('/')) {
        // For directories, look for files with that prefix in root
        const folderEntries = findEntriesByPrefix(zipEntries, extraPath);
        if (folderEntries.length === 0) continue;

        const files = [];
        for (const entry of folderEntries) {
          const blob = await entry.async('blob');
          const normalizedEntry = normalizeStoredPath(entry.name);
          const relativePath = normalizedEntry.replace(extraPath, '');
          const cleanRelativePath = relativePath.replace(/^\/+/, '');
          files.push({
            relativePath: cleanRelativePath,
            file: new File([blob], relativePath.split('/').pop() || 'file.bin', { type: blob.type || 'application/octet-stream' })
          });
        }

        assets.tabs[tabFilesKey].extraFiles.push({
          id: crypto.randomUUID?.() || `asset_${Math.random().toString(36).slice(2, 10)}`,
          kind: 'directory',
          storedPath: normalizeStoredPath(extraPath),
          label: normalizeStoredPath(extraPath),
          files
        });
        continue;
      }

      // For individual files, look directly in root
      const extraEntry = findEntryByName(zipEntries, [extraPath]);
      if (!extraEntry) continue;
      const extraBlob = await extraEntry.async('blob');
      assets.tabs[tabFilesKey].extraFiles.push({
        id: crypto.randomUUID?.() || `asset_${Math.random().toString(36).slice(2, 10)}`,
        kind: 'file',
        storedPath: normalizeStoredPath(extraPath),
        label: normalizeStoredPath(extraPath),
        file: new File([extraBlob], normalizeStoredPath(extraPath).split('/').pop() || 'extra.bin', {
          type: extraBlob.type || 'application/octet-stream'
        })
      });
    }
  }

  return assets;
}

export async function importZipArchive(file) {
  const zip = await new JSZip().loadAsync(file);
  const zipEntries = zip.files;

  // First check for G3M format (mod_config.json)
  const modConfigEntry = Object.values(zipEntries).find(
    (entry) => !entry.dir && /(^|\/)mod_config\.json$/i.test(entry.name)
  );

  if (modConfigEntry) {
    try {
      const configText = await modConfigEntry.async('string');
      let config = JSON.parse(configText);
      
      // Apply legacy migrations like main DELTAHUB
      migrateModConfigLegacyFields(config);
      
      // Normalize after migration
      config = normalizeModConfigData(config);
      const assets = await buildImportedAssetsFromConfig(config, zipEntries);
      return { format: 'g3m', config, assets };
    } catch (parseError) {
      throw new Error(`Failed to parse mod_config.json: ${parseError.message}`);
    }
  }

  // If no G3M format, check for Deltamod format (like main DELTAHUB)
  const deltamodInfoEntry = Object.values(zipEntries).find(
    (entry) => !entry.dir && /(^|\/)(deltamodInfo\.json|_deltamodInfo\.json|meta\.json)$/i.test(entry.name)
  );
  const moddingXmlEntry = Object.values(zipEntries).find(
    (entry) => !entry.dir && /(^|\/)modding\.xml$/i.test(entry.name)
  );

  if (deltamodInfoEntry && moddingXmlEntry) {
    try {
      // Convert deltamod to G3M format first, then process normally
      const converted = await convertDeltamodArchive(zipEntries);
      return { format: 'deltamod', ...converted };
    } catch (conversionError) {
      throw new Error(`Failed to convert deltamod format: ${conversionError.message}`);
    }
  }

  throw new Error('Unsupported archive format - neither G3M nor Deltamod format detected');
}

function addDirectoryAsset(zip, basePath, asset) {
  for (const entry of asset.files || []) {
    zip.file(`${basePath}${entry.relativePath}`, entry.file);
  }
}

export async function exportModArchive({ config, assets }) {
  const zip = new JSZip();
  const normalizedConfig = normalizeModConfigData(config);

  if (assets?.icon?.file) {
    const iconName = assets.icon.storedPath || assets.icon.file.name || 'icon.png';
    zip.file(iconName, assets.icon.file);
    normalizedConfig.icon = iconName;
  }

  for (const [tabFilesKey, tabAssets] of Object.entries(assets?.tabs || {})) {
    const configFileKey = mapTabFilesKeyToConfigFileKey(tabFilesKey, normalizedConfig.game);
    const fileEntry = normalizedConfig.files[configFileKey] || {};

    if (tabAssets?.dataFile?.file) {
      const storedPath = normalizeStoredPath(tabAssets.dataFile.storedPath || tabAssets.dataFile.file.name);
      // Store file directly in root with correct path, no chapter folders
      zip.file(storedPath, tabAssets.dataFile.file);
      fileEntry.data_file_path = storedPath;
    }

    if (Array.isArray(tabAssets?.extraFiles) && tabAssets.extraFiles.length > 0) {
      fileEntry.extra_files = [];
      for (const extraAsset of tabAssets.extraFiles) {
        const storedPath = normalizeStoredPath(extraAsset.storedPath || extraAsset.label);
        fileEntry.extra_files.push(storedPath);

        if (extraAsset.kind === 'directory') addDirectoryAsset(zip, storedPath, extraAsset);
        else if (extraAsset.file) zip.file(storedPath, extraAsset.file);
      }
    }

    if (fileEntry.data_file_path || (fileEntry.extra_files && fileEntry.extra_files.length > 0)) {
      normalizedConfig.files[configFileKey] = fileEntry;
    } else {
      delete normalizedConfig.files[configFileKey];
    }
  }

  zip.file('mod_config.json', JSON.stringify(buildModConfigData(normalizedConfig), null, 2));
  return zip.generateAsync({ type: 'blob' });
}

export function downloadZip(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}
