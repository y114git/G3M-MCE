// Migration service for DH-MCE - mirrors main DELTAHUB migration logic

// Legacy chapter ID mapping from main DELTAHUB
const LEGACY_CHAPTER_IDS = {
  "-1": "deltarune",
  "0": "deltarune_0", 
  "1": "deltarune_1",
  "2": "deltarune_2",
  "3": "deltarune_3",
  "4": "deltarune_4",
  "-10": "deltarunedemo",
  "-20": "undertale",
  "-30": "undertaleyellow", 
  "-40": "pizzatower",
  "-50": "sugaryspire",
};

// Legacy field mappings from main DELTAHUB
const LEGACY_DESCRIPTION_KEY = "tagline";
const LEGACY_ICON_KEY = "icon_url";
const LEGACY_MOD_ID_KEYS = ["key", "mod_key"];
const LEGACY_HOMEPAGE_KEYS = ["homepage", "external_url", "external_link", "site", "url"];

export function migrateLegacyChapterId(chapterId) {
  return LEGACY_CHAPTER_IDS[String(chapterId)] || String(chapterId);
}

export function migrateModConfigLegacyFields(configData) {
  if (!configData || typeof configData !== 'object') {
    return false;
  }
  
  let changed = false;

  // Migrate description field
  const descriptionValue = configData.description;
  if (!descriptionValue && configData[LEGACY_DESCRIPTION_KEY]) {
    configData.description = configData[LEGACY_DESCRIPTION_KEY];
    delete configData[LEGACY_DESCRIPTION_KEY];
    changed = true;
  }

  // Migrate icon field  
  const iconValue = configData.icon;
  if (!iconValue && configData[LEGACY_ICON_KEY]) {
    configData.icon = configData[LEGACY_ICON_KEY];
    delete configData[LEGACY_ICON_KEY];
    changed = true;
  }

  // Migrate homepage field
  for (const legacyKey of LEGACY_HOMEPAGE_KEYS) {
    if (configData[legacyKey]) {
      if (!configData.homepage) {
        configData.homepage = configData[legacyKey];
      }
      delete configData[legacyKey];
      changed = true;
    }
  }

  // Migrate mod ID
  if (!configData.id) {
    for (const legacyKey of LEGACY_MOD_ID_KEYS) {
      const legacyId = configData[legacyKey];
      if (typeof legacyId === 'string' && legacyId.trim()) {
        configData.id = legacyId.trim();
        delete configData[legacyKey];
        changed = true;
        break;
      }
    }
  }

  // Migrate files section
  if (configData.files && typeof configData.files === 'object') {
    const migratedFiles = {};
    for (const [fileKey, fileInfo] of Object.entries(configData.files)) {
      const migratedKey = migrateLegacyChapterId(fileKey);
      let migratedInfo = fileInfo;

      if (fileInfo && typeof fileInfo === 'object') {
        migratedInfo = { ...fileInfo };
        
        // Migrate data_file_url to data_file_path
        if (migratedInfo.data_file_url && !migratedInfo.data_file_path) {
          migratedInfo.data_file_path = migratedInfo.data_file_url;
          delete migratedInfo.data_file_url;
          changed = true;
        }

        // Normalize extra_files
        const extraFiles = migratedInfo.extra_files;
        if (extraFiles) {
          const normalizedExtraFiles = [];
          if (Array.isArray(extraFiles)) {
            for (const extraFile of extraFiles) {
              if (typeof extraFile === 'string') {
                normalizedExtraFiles.push(extraFile);
              } else if (extraFile && typeof extraFile === 'object') {
                const filePath = extraFile.file_path || extraFile.url;
                if (filePath) normalizedExtraFiles.push(filePath);
              }
            }
          } else if (typeof extraFiles === 'object') {
            for (const filenames of Object.values(extraFiles)) {
              if (Array.isArray(filenames)) {
                for (const filePath of filenames) {
                  if (filePath) normalizedExtraFiles.push(filePath);
                }
              }
            }
          }
          
          if (normalizedExtraFiles.length > 0) {
            migratedInfo.extra_files = normalizedExtraFiles;
          } else if (extraFiles && extraFiles !== '' && extraFiles !== null) {
            migratedInfo.extra_files = [];
          }
          
          if (JSON.stringify(extraFiles) !== JSON.stringify(migratedInfo.extra_files)) {
            changed = true;
          }
        }
      }
      
      migratedFiles[migratedKey] = migratedInfo;
    }
    
    if (JSON.stringify(configData.files) !== JSON.stringify(migratedFiles)) {
      configData.files = migratedFiles;
      changed = true;
    }
  }

  return changed;
}
