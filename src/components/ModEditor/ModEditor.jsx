import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getGameDefinition, getVisibleGames, mapTabFilesKeyToConfigFileKey } from '../../data/gameDefinitions';
import {
  MOD_ALLOWED_TAGS,
  MOD_FIELD_LIMITS,
  createEmptyModConfig,
  normalizeModConfigData,
  normalizeStoredPath,
  parseExtraFilesRaw,
  DATA_FILE_EXTENSIONS,
  sanitizeTags
} from '../../data/modConfig';
import { downloadZip, exportModArchive } from '../../utils/zipHandler';
import './ModEditor.css';

const TAG_OPTIONS = [
  { value: 'textedit', labelKey: 'tags.textedit_text', fallback: 'Text Edit' },
  { value: 'customization', labelKey: 'tags.customization', fallback: 'Customization' },
  { value: 'gameplay', labelKey: 'tags.gameplay', fallback: 'Gameplay' },
  { value: 'other', labelKey: 'tags.other', fallback: 'Other' }
];

function createAssetId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `asset_${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyTabAssets(gameId) {
  const game = getGameDefinition(gameId);
  return Object.fromEntries(game.tabs.map((tab) => [tab.filesKey, { dataFile: null, extraFiles: [] }]));
}

function createInitialState(initialConfig, initialAssets) {
  const config = normalizeModConfigData(initialConfig || createEmptyModConfig('deltarune'));
  const mergedAssets = {
    icon: initialAssets?.icon || null,
    tabs: {
      ...createEmptyTabAssets(config.game),
      ...(initialAssets?.tabs || {})
    }
  };

  for (const [fileKey, fileInfo] of Object.entries(config.files || {})) {
    if (!mergedAssets.tabs[fileKey]) mergedAssets.tabs[fileKey] = { dataFile: null, extraFiles: [] };

    if (!mergedAssets.tabs[fileKey].dataFile && fileInfo.data_file_path) {
      mergedAssets.tabs[fileKey].dataFile = {
        id: createAssetId(),
        kind: 'missing',
        storedPath: normalizeStoredPath(fileInfo.data_file_path),
        label: normalizeStoredPath(fileInfo.data_file_path)
      };
    }

    if ((!mergedAssets.tabs[fileKey].extraFiles || mergedAssets.tabs[fileKey].extraFiles.length === 0) && fileInfo.extra_files) {
      mergedAssets.tabs[fileKey].extraFiles = parseExtraFilesRaw(fileInfo.extra_files).map((entry) => ({
        id: createAssetId(),
        kind: entry.endsWith('/') ? 'directory' : 'missing',
        storedPath: normalizeStoredPath(entry),
        label: normalizeStoredPath(entry),
        files: []
      }));
    }
  }

  return { config, assets: mergedAssets };
}

function deriveCanonicalConfig(formState, assets) {
  const files = {};

  for (const [tabFilesKey, tabAssets] of Object.entries(assets.tabs || {})) {
    const configFileKey = mapTabFilesKeyToConfigFileKey(tabFilesKey, formState.game);
    const entry = {};
    if (tabAssets.dataFile?.storedPath) entry.data_file_path = normalizeStoredPath(tabAssets.dataFile.storedPath);

    const extraFiles = (tabAssets.extraFiles || []).map((item) => normalizeStoredPath(item.storedPath)).filter(Boolean);
    if (extraFiles.length > 0) entry.extra_files = extraFiles;

    if (Object.keys(entry).length > 0) files[configFileKey] = entry;
  }

  return normalizeModConfigData({
    ...formState,
    tags: sanitizeTags(formState.tags),
    files
  });
}

function createPreviewUrl(asset) {
  if (!asset) return '';
  if (asset.remoteUrl) return asset.remoteUrl;
  if (asset.file) return URL.createObjectURL(asset.file);
  return '';
}

export default function ModEditor({ isCreating, initialConfig, initialAssets }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const initialState = useMemo(() => createInitialState(initialConfig, initialAssets), [initialConfig, initialAssets]);

  const [formState, setFormState] = useState(initialState.config);
  const [assets, setAssets] = useState(initialState.assets);
  const [activeTab, setActiveTab] = useState(getGameDefinition(initialState.config.game).tabs[0]?.filesKey || '0');
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ kind: '', message: '' });
  const [saving, setSaving] = useState(false);
  const iconTimeoutRef = useRef(null);

  const iconInputRef = useRef(null);
  const dataInputRef = useRef(null);
  const extraFileInputRef = useRef(null);
  const extraFolderInputRef = useRef(null);
  const pendingFileKeyRef = useRef('');

  const games = useMemo(() => getVisibleGames(), []);
  const gameDefinition = useMemo(() => getGameDefinition(formState.game), [formState.game]);
  const iconPreviewUrl = useMemo(() => createPreviewUrl(assets.icon), [assets.icon]);

  useEffect(() => () => {
    if (iconPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(iconPreviewUrl);
  }, [iconPreviewUrl]);

  useEffect(() => {
    if (formState.icon) {
      setIconRemote();
    }
  }, [formState.icon]);

  useEffect(() => {
    const firstTab = getGameDefinition(formState.game).tabs[0]?.filesKey || '0';
    setActiveTab((currentTab) => {
      const exists = getGameDefinition(formState.game).tabs.some((tab) => tab.filesKey === currentTab);
      return exists ? currentTab : firstTab;
    });

    setAssets((prev) => ({
      ...prev,
      tabs: {
        ...createEmptyTabAssets(formState.game),
        ...prev.tabs
      }
    }));
  }, [formState.game]);

  const updateField = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setStatus({ kind: '', message: '' });
  };

  const updateTags = (tag) => {
    const nextTags = formState.tags.includes(tag)
      ? formState.tags.filter((entry) => entry !== tag)
      : [...formState.tags, tag];
    updateField('tags', nextTags.length > 0 ? nextTags : ['other']);
  };

  const selectIconFile = (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setAssets((prev) => ({
      ...prev,
      icon: {
        id: createAssetId(),
        kind: 'file',
        storedPath: selectedFile.name,
        label: selectedFile.name,
        file: selectedFile
      }
    }));
    updateField('icon', selectedFile.name);
    event.target.value = '';
  };

  const setIconRemote = () => {
    const nextValue = formState.icon.trim();
    if (!/^https?:\/\//i.test(nextValue)) return;
    setAssets((prev) => ({
      ...prev,
      icon: {
        id: createAssetId(),
        kind: 'remote',
        storedPath: nextValue,
        label: nextValue,
        remoteUrl: nextValue
      }
    }));
  };

  const setIconRemoteDebounced = () => {
    if (iconTimeoutRef.current) {
      clearTimeout(iconTimeoutRef.current);
    }
    iconTimeoutRef.current = setTimeout(() => {
      setIconRemote();
    }, 300);
  };

  const handleIconInputChange = (event) => {
    updateField('icon', event.target.value);
    setIconRemoteDebounced();
  };

  const handleIconPaste = (event) => {
    const pastedText = event.clipboardData.getData('text');
    if (pastedText && /^https?:\/\//i.test(pastedText.trim())) {
      event.preventDefault();
      updateField('icon', pastedText.trim());
      setIconRemote();
    }
  };

  const clearIcon = () => {
    setAssets((prev) => ({ ...prev, icon: null }));
    updateField('icon', '');
  };

  const openDataPicker = (fileKey) => {
    pendingFileKeyRef.current = fileKey;
    dataInputRef.current?.click();
  };

  const openExtraFilePicker = (fileKey) => {
    pendingFileKeyRef.current = fileKey;
    extraFileInputRef.current?.click();
  };

  const openExtraFolderPicker = (fileKey) => {
    pendingFileKeyRef.current = fileKey;
    extraFolderInputRef.current?.click();
  };

  const handleDataFileSelected = (event) => {
    const selectedFile = event.target.files?.[0];
    const targetKey = pendingFileKeyRef.current;
    if (!selectedFile || !targetKey) return;

    // Check if file extension is allowed
    const hasExtension = selectedFile.name.includes('.');
    const fileExtension = hasExtension ? `.${selectedFile.name.split('.').pop().toLowerCase()}` : '';
    if (!DATA_FILE_EXTENSIONS.includes(fileExtension)) {
      // You could add an error message here
      console.error(`File extension ${fileExtension} is not allowed for data files`);
      event.target.value = '';
      return;
    }

    setAssets((prev) => ({
      ...prev,
      tabs: {
        ...prev.tabs,
        [targetKey]: {
          ...prev.tabs[targetKey],
          dataFile: {
            id: createAssetId(),
            kind: 'file',
            storedPath: selectedFile.name,
            label: selectedFile.name,
            file: selectedFile
          }
        }
      }
    }));

    event.target.value = '';
  };

  const handleExtraFilesSelected = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    const targetKey = pendingFileKeyRef.current;
    if (selectedFiles.length === 0 || !targetKey) return;

    setAssets((prev) => ({
      ...prev,
      tabs: {
        ...prev.tabs,
        [targetKey]: {
          ...prev.tabs[targetKey],
          extraFiles: [
            ...(prev.tabs[targetKey]?.extraFiles || []),
            ...selectedFiles.map((file) => ({
              id: createAssetId(),
              kind: 'file',
              storedPath: file.name,
              label: file.name,
              file
            }))
          ]
        }
      }
    }));

    event.target.value = '';
  };

  const handleExtraFolderSelected = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    const targetKey = pendingFileKeyRef.current;
    if (selectedFiles.length === 0 || !targetKey) return;

    const firstPath = selectedFiles[0].webkitRelativePath || selectedFiles[0].name;
    const [folderName] = firstPath.split('/');
    if (!folderName) return;
    const files = selectedFiles.map((file) => ({
      relativePath: file.webkitRelativePath.split('/').slice(1).join('/') || file.name,
      file
    }));

    setAssets((prev) => ({
      ...prev,
      tabs: {
        ...prev.tabs,
        [targetKey]: {
          ...prev.tabs[targetKey],
          extraFiles: [
            ...(prev.tabs[targetKey]?.extraFiles || []),
            {
              id: createAssetId(),
              kind: 'directory',
              storedPath: `${folderName}/`,
              label: `${folderName}/`,
              files
            }
          ]
        }
      }
    }));

    event.target.value = '';
  };

  const removeDataFile = (fileKey) => {
    setAssets((prev) => ({
      ...prev,
      tabs: {
        ...prev.tabs,
        [fileKey]: {
          ...prev.tabs[fileKey],
          dataFile: null
        }
      }
    }));
  };

  const removeExtraFile = (fileKey, assetId) => {
    setAssets((prev) => ({
      ...prev,
      tabs: {
        ...prev.tabs,
        [fileKey]: {
          ...prev.tabs[fileKey],
          extraFiles: (prev.tabs[fileKey]?.extraFiles || []).filter((entry) => entry.id !== assetId)
        }
      }
    }));
  };
    const validate = () => {
    const nextErrors = {};
    const canonical = deriveCanonicalConfig(formState, assets);

    if (!canonical.name.trim()) nextErrors.name = t('dialogs.mod_name_empty');
    if (canonical.version.length > MOD_FIELD_LIMITS.version) nextErrors.version = t('dialogs.mod_version_too_long');

    if (canonical.homepage) {
      try {
        const url = new URL(canonical.homepage);
        const lowerPath = url.pathname.toLowerCase();
        const directExtensions = ['.zip', '.rar', '.7z', '.exe', '.xdelta', '.patch', '.tar', '.gz', '.win'];
        if (directExtensions.some((ext) => lowerPath.endsWith(ext))) {
          nextErrors.homepage = t('dialogs.invalid_external_url_direct_download');
        }
      } catch {
        nextErrors.homepage = t('dialogs.invalid_external_url');
      }
    }

    const hasFiles = Object.values(assets.tabs || {}).some(
      (entry) => entry.dataFile || (entry.extraFiles && entry.extraFiles.length > 0)
    );
    if (!hasFiles) nextErrors.files = t('dialogs.mod_must_have_files');

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setStatus({ kind: '', message: '' });

    try {
      const canonical = deriveCanonicalConfig(formState, assets);
      const archive = await exportModArchive({ config: canonical, assets });
      downloadZip(archive, `${canonical.name || 'mod'}.zip`);
      setStatus({
        kind: 'success',
        message: isCreating
          ? t('dialogs.local_mod_created_message', { mod_name: canonical.name })
          : t('dialogs.local_mod_updated_message', { mod_name: canonical.name })
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : t('errors.mod_creation_failed', { error: 'unknown' })
      });
    } finally {
      setSaving(false);
    }
  };

  const activeAssets = assets.tabs[activeTab] || { dataFile: null, extraFiles: [] };

  return (
    <main className="g3m-page-shell">
      <input ref={iconInputRef} type="file" accept="image/*" hidden onChange={selectIconFile} />
      <input ref={dataInputRef} type="file" accept={DATA_FILE_EXTENSIONS.join(',')} hidden onChange={handleDataFileSelected} />
      <input ref={extraFileInputRef} type="file" multiple hidden onChange={handleExtraFilesSelected} />
      <input ref={extraFolderInputRef} type="file" hidden multiple onChange={handleExtraFolderSelected} webkitdirectory="" directory="" />

      <section className="g3m-panel g3m-panel--editor">
        <div className="g3m-page-heading">
          <h1>{isCreating ? t('ui.create_mod') : t('ui.edit_mod')}</h1>
        </div>

        <div className="g3m-editor">
          <section className="g3m-editor__meta">
            <div className="g3m-editor__section-heading">
              <h2>{t('editor.metadataTitle', { defaultValue: 'Metadata' })}</h2>
              <p>{t('ui.mod_editor_fields_hint', { defaultValue: 'Only fill in the fields that help explain the mod.' })}</p>
            </div>

            <div className="g3m-form-grid">
              <label className="g3m-field g3m-field--full">
                <span>{t('ui.mod_type_label')}</span>
                <select value={formState.game} onChange={(event) => updateField('game', event.target.value)}>
                  {games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {t(game.labelKey, { defaultValue: game.fallbackLabel })}
                    </option>
                  ))}
                </select>
              </label>

              <label className="g3m-field g3m-field--full">
                <span>{t('ui.mod_name_label')}</span>
                <input type="text" value={formState.name} onChange={(event) => updateField('name', event.target.value)} placeholder={t('ui.enter_mod_name')} maxLength={MOD_FIELD_LIMITS.name} />
                {errors.name ? <em className="g3m-inline-error">{errors.name}</em> : null}
              </label>

              <label className="g3m-field">
                <span>{t('ui.mod_author')}</span>
                <input type="text" value={formState.author} onChange={(event) => updateField('author', event.target.value)} placeholder={t('ui.enter_author_name')} maxLength={50} />
              </label>

              <label className="g3m-field">
                <span>{t('ui.overall_mod_version')}</span>
                <input type="text" value={formState.version} onChange={(event) => updateField('version', event.target.value)} placeholder="1.0.0" maxLength={20} />
                {errors.version ? <em className="g3m-inline-error">{errors.version}</em> : null}
              </label>

              <label className="g3m-field g3m-field--full">
                <span>{t('ui.description')}</span>
                <input type="text" value={formState.description} onChange={(event) => updateField('description', event.target.value)} maxLength={200} placeholder={t('ui.description_placeholder')} />
              </label>

              <div className="g3m-field g3m-field--full">
                <span>{t('files.icon_label')}</span>
                <div className="g3m-icon-container">
                  <div className="g3m-icon-input-wrapper">
                    <input type="text" value={formState.icon} onChange={handleIconInputChange} onPaste={handleIconPaste} onBlur={setIconRemote} placeholder={t('ui.icon_file_path_placeholder')} maxLength={200} />
                    <div className="g3m-icon-buttons">
                      <button type="button" className="g3m-button" onClick={() => iconInputRef.current?.click()}>
                        {t('ui.browse_button')}
                      </button>
                      <button type="button" className="g3m-button g3m-button--ghost" onClick={clearIcon}>
                        {t('ui.clear')}
                      </button>
                    </div>
                  </div>
                  <div className="g3m-icon-preview">
                    {iconPreviewUrl ? <img src={iconPreviewUrl} alt={t('ui.icon_preview')} /> : <span>G3M</span>}
                  </div>
                </div>
                <small>{t('editor.iconHint', { defaultValue: 'Paste an image URL or select a local icon file.' })}</small>

              <label className="g3m-field g3m-field--full">
                <span>{t('ui.homepage', { defaultValue: 'Homepage' })}</span>
                <input type="url" value={formState.homepage} onChange={(event) => updateField('homepage', event.target.value)} placeholder="https://example.com/mod-page" maxLength={200} />
                {errors.homepage ? <em className="g3m-inline-error">{errors.homepage}</em> : null}
              </label>

              <label className="g3m-field">
                <span>{t('ui.game_version_label')}</span>
                <input type="text" value={formState.game_version} onChange={(event) => updateField('game_version', event.target.value)} placeholder="1.04" maxLength={20} />
              </label>

              <div className="g3m-field g3m-field--full">
                <span>{t('ui.mod_tags_label')}</span>
                <div className="g3m-tag-grid">
                  {TAG_OPTIONS.filter((entry) => MOD_ALLOWED_TAGS.includes(entry.value)).map((tag) => (
                    <label key={tag.value} className="g3m-tag-toggle">
                      <input type="checkbox" checked={formState.tags.includes(tag.value)} onChange={() => updateTags(tag.value)} />
                      <span>{t(tag.labelKey, { defaultValue: tag.fallback })}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </section>

          <section className="g3m-editor__files">
            <div className="g3m-editor__section-heading">
              <h2>{t('ui.files_management')}</h2>
              <p dangerouslySetInnerHTML={{ __html: t('ui.mod_editor_files_hint', { defaultValue: 'Each game tab can hold one DATA file and any number of extra files or folders.' }) }}></p>
            </div>

            <div className="g3m-tabbar">
              {gameDefinition.tabs.map((tab) => (
                <button key={tab.filesKey} type="button" className={`g3m-tabbar__tab${activeTab === tab.filesKey ? ' is-active' : ''}`} onClick={() => setActiveTab(tab.filesKey)}>
                  {t(tab.labelKey, { defaultValue: tab.fallbackLabel })}
                </button>
              ))}
            </div>

            <div className="g3m-files-toolbar">
              <button type="button" className="g3m-button" onClick={() => openDataPicker(activeTab)} disabled={Boolean(activeAssets.dataFile)}>
                {t('ui.add_data_file')}
              </button>
              <button type="button" className="g3m-button" onClick={() => openExtraFilePicker(activeTab)}>
                {t('ui.add_extra_files')}
              </button>
              <button type="button" className="g3m-button g3m-button--ghost" onClick={() => openExtraFolderPicker(activeTab)}>
                {t('editor.addFolder', { defaultValue: 'Add folder' })}
              </button>
            </div>

            <div className="g3m-file-list">
              {activeAssets.dataFile ? (
                <article className="g3m-file-card">
                  <div>
                    <p className="g3m-file-card__label">{t('files.data_file')}</p>
                    <strong>{activeAssets.dataFile.label}</strong>
                  </div>
                  <button type="button" className="g3m-button g3m-button--danger" onClick={() => removeDataFile(activeTab)}>
                    {t('buttons.delete')}
                  </button>
                </article>
              ) : (
                <div className="g3m-empty-block">
                  {t('editor.noDataFile', { defaultValue: 'No DATA file selected for this tab yet.' })}
                </div>
              )}

              {(activeAssets.extraFiles || []).length > 0 ? (
                activeAssets.extraFiles.map((entry) => (
                  <article key={entry.id} className="g3m-file-card">
                    <div>
                      <p className="g3m-file-card__label">
                        {entry.kind === 'directory'
                          ? t('editor.extraFolder', { defaultValue: 'Extra folder' })
                          : t('files.extra_files', { defaultValue: 'Extra file' })}
                      </p>
                      <strong>{entry.label}</strong>
                      {entry.kind === 'directory' ? (
                        <small>{t('editor.folderCount', { defaultValue: '{{count}} files bundled under this folder.', count: entry.files?.length || 0 })}</small>
                      ) : null}
                    </div>
                    <button type="button" className="g3m-button g3m-button--danger" onClick={() => removeExtraFile(activeTab, entry.id)}>
                      {t('buttons.delete')}
                    </button>
                  </article>
                ))
              ) : (
                <div className="g3m-empty-block">
                  {t('editor.noExtraFiles', { defaultValue: 'No extra files selected for this tab.' })}
                </div>
              )}
            </div>

            {errors.files ? <div className="g3m-inline-error">{errors.files}</div> : null}
          </section>
        </div>

        {status.message ? <div className={`g3m-status ${status.kind === 'error' ? 'is-error' : 'is-success'}`}>{status.message}</div> : null}

        <div className="g3m-editor__footer-actions">
          <button className="g3m-button g3m-button--ghost" onClick={() => navigate('/')}>
            {t('ui.cancel_button')}
          </button>
          <button className="g3m-button g3m-button--primary" onClick={handleSave} disabled={saving}>
            {saving ? t('status.loading') : isCreating ? t('ui.finish_creation') : t('ui.save_changes')}
          </button>
        </div>
      </section>
    </main>
  );
}
