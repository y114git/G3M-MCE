import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { exportZip, downloadZip } from '../../utils/zipHandler';
import { validateModName, validateModAuthor, validateVersion, validateExternalURL, validateIconURL } from '../../utils/validation';
import FileManager from '../FileManager/FileManager';
import IconPreview from '../IconPreview/IconPreview';
import JSZip from 'jszip';
import './ModEditor.css';

export default function ModEditor({ isCreating, modData: initialModData, initialIconFile, initialFileObjects, onCancel }) {
  const { t } = useTranslation();

  const [modData, setModData] = useState(initialModData || {
    name: '',
    author: '',
    tagline: '',
    external_url: '',
    version: '1.0.0',
    game_version: '1.04',
    game: 'deltarune',
    tags: [],
    files: {}
  });

  const [iconFile, setIconFile] = useState(initialIconFile || null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [fileObjects, setFileObjects] = useState(initialFileObjects || new Map());

  useEffect(() => {
    setIconFile(initialIconFile || null);
  }, [initialIconFile]);

  const updateField = (field, value) => {
    setModData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const toggleTag = (tag) => {
    setModData(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag]
    }));
  };

  const validate = () => {
    const newErrors = {};

    const nameValidation = validateModName(modData.name);
    if (!nameValidation.valid) newErrors.name = t(nameValidation.error);

    const authorValidation = validateModAuthor(modData.author, false);
    if (!authorValidation.valid) newErrors.author = t(authorValidation.error);

    const versionValidation = validateVersion(modData.version);
    if (!versionValidation.valid) newErrors.version = t(versionValidation.error);

    if (modData.external_url) {
      const urlValidation = validateExternalURL(modData.external_url);
      if (!urlValidation.valid) newErrors.external_url = t(urlValidation.error);
    }

    const hasFiles = Object.keys(modData.files || {}).length > 0;
    if (!hasFiles) {
      newErrors.files = t('dialogs.mod_must_have_files');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFileChange = (key, file) => {
    setFileObjects(prev => {
      const newMap = new Map(prev);
      if (file) {
        newMap.set(key, file);
      } else {
        newMap.delete(key);
      }
      return newMap;
    });
  };

  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);

    try {
      const filesToExport = {};

      if (iconFile) {
        filesToExport['icon.png'] = iconFile;
      }

      const getChapterFolderName = (chapterKey) => {
        if (chapterKey === 'demo') return 'demo';
        if (chapterKey === 'undertale') return 'undertale';
        if (chapterKey === 'undertaleyellow') return 'undertaleyellow';
        if (chapterKey === 'pizzatower') return 'pizzatower';
        if (chapterKey === 'sugaryspire') return 'sugaryspire';
        if (chapterKey === '0') {
          const game = modData?.game || modData?.game || 'deltarune';
          if (game === 'pizzatower' || game === 'pizzaoven') {
            return 'pizzatower';
          }
          return 'chapter_0';
        }
        if (/^\d+$/.test(chapterKey)) return `chapter_${chapterKey}`;
        return `chapter_${chapterKey}`;
      };

      const modDataForExport = JSON.parse(JSON.stringify(modData));

      for (const [chapterKey, chapterFiles] of Object.entries(modData.files || {})) {
        const chapterFolder = getChapterFolderName(chapterKey);

        if (chapterFiles.data_file_url && !chapterFiles.data_file_url.startsWith('http')) {
          const fileKey = `${chapterKey}:data_file`;
          const file = fileObjects.get(fileKey);
          if (file) {
            const fileName = chapterFiles.data_file_url.split('/').pop() || chapterFiles.data_file_url;
            filesToExport[`${chapterFolder}/${fileName}`] = file;
          }
        }

        if (chapterFiles.extra_files) {
          const chapterFilesForExport = modDataForExport.files[chapterKey];
          for (let i = 0; i < chapterFiles.extra_files.length; i++) {
            const extra = chapterFiles.extra_files[i];
            if (extra.url && !extra.url.startsWith('http')) {
              const fileKey = `${chapterKey}:extra:${extra.key}`;
              const file = fileObjects.get(fileKey);
              if (file) {
                let archiveName = extra.url;
                if (!archiveName.endsWith('.zip')) {
                  const archiveKey = extra.key || file.name.replace(/\./g, '_');
                  archiveName = `extra_file_${archiveKey}.zip`;
                }

                if (chapterFilesForExport.extra_files && chapterFilesForExport.extra_files[i]) {
                  chapterFilesForExport.extra_files[i].url = archiveName;
                }

                const isZipFile = file.name.toLowerCase().endsWith('.zip') ||
                  file.type === 'application/zip' ||
                  file.type === 'application/x-zip-compressed';

                let extraZipBlob;

                if (isZipFile && !extra._targetPath) {
                  extraZipBlob = await file.arrayBuffer();
                } else {
                  let targetPath = '';
                  if (extra._targetPath) {
                    targetPath = extra._targetPath;
                  } else {
                    const baseFileName = file.name.endsWith('.zip') ? file.name.slice(0, -4) : file.name;
                    targetPath = baseFileName;
                  }

                  const extraZip = new JSZip();
                  const fileData = await file.arrayBuffer();
                  extraZip.file(targetPath, fileData);

                  extraZipBlob = await extraZip.generateAsync({ type: 'blob' });
                }

                filesToExport[`${chapterFolder}/${archiveName}`] = extraZipBlob;
              }
            }
          }
        }
      }

      const zipBlob = await exportZip(modDataForExport, filesToExport);
      downloadZip(zipBlob, `${modData.name || 'mod'}.zip`);
      const messageKey = isCreating ? 'dialogs.mod_created_message' : 'dialogs.mod_updated_message';
      alert(t(messageKey, { mod_name: modData.name }));

      if (onCancel) onCancel();
    } catch (error) {
      alert(t('errors.error') + ': ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mod-editor">
      <h1>{isCreating ? t('ui.create_mod') : t('ui.edit_mod')}</h1>

      <div className="frame">
        <div className="form-group">
          <label>{t('ui.mod_type_label')}</label>
          <select
            value={modData.game || modData.modgame}
            onChange={(e) => updateField('game', e.target.value)}
          >
            <option value="deltarune">{t('ui.deltarune')}</option>
            <option value="deltarunedemo">{t('ui.deltarunedemo')}</option>
            <option value="undertale">{t('ui.undertale')}</option>
            <option value="undertaleyellow">{t('ui.undertaleyellow')}</option>
            <option value="pizzatower">{t('ui.pizzatower')}</option>
            <option value="sugaryspire">{t('ui.sugaryspire')}</option>
          </select>
        </div>

        <div className="form-group">
          <label>{t('ui.mod_name_label')}</label>
          <input
            type="text"
            value={modData.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder={t('ui.enter_mod_name')}
          />
          {errors.name && <div className="error">{errors.name}</div>}
        </div>

        <div className="form-group">
          <label>{t('ui.mod_author_optional')}</label>
          <input
            type="text"
            value={modData.author}
            onChange={(e) => updateField('author', e.target.value)}
            placeholder={t('ui.enter_author_name_optional')}
          />
          {errors.author && <div className="error">{errors.author}</div>}
        </div>

        <div className="form-group">
          <label>{t('ui.short_description')}</label>
          <input
            type="text"
            value={modData.tagline}
            onChange={(e) => updateField('tagline', e.target.value)}
            placeholder={t('ui.short_description_placeholder')}
            maxLength={200}
          />
        </div>

        <div className="form-group">
          <label>{t('ui.external_url_optional')}</label>
          <input
            type="url"
            value={modData.external_url}
            onChange={(e) => updateField('external_url', e.target.value)}
            placeholder="https://example.com"
          />
          {errors.external_url && <div className="error">{errors.external_url}</div>}
        </div>

        <div className="form-group">
          <label>{t('files.icon_label')}</label>
          <div className="form-row">
            <input
              type="text"
              value={iconFile?.name || ''}
              readOnly
              placeholder={t('ui.select_icon_file')}
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setIconFile(e.target.files[0])}
              style={{ display: 'none' }}
              id="icon-file-input"
            />
            <button onClick={() => document.getElementById('icon-file-input').click()}>
              {t('ui.browse_button')}
            </button>
            <IconPreview
              file={iconFile}
            />
          </div>
        </div>

        <div className="form-group">
          <label>{t('ui.mod_tags_label')}</label>
          <div className="checkbox-group">
            {['textedit', 'customization', 'gameplay', 'other'].map(tag => (
              <div key={tag} className="checkbox-item">
                <input
                  type="checkbox"
                  checked={modData.tags.includes(tag)}
                  onChange={() => toggleTag(tag)}
                />
                <label>{t(`tags.${tag}_text`)}</label>
              </div>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>{t('ui.overall_mod_version')}</label>
          <input
            type="text"
            value={modData.version}
            onChange={(e) => updateField('version', e.target.value)}
            placeholder="1.0.0"
          />
          {errors.version && <div className="error">{errors.version}</div>}
        </div>

        <div className="form-group">
          <label>{t('ui.game_version_label')}</label>
          <input
            type="text"
            value={modData.game_version}
            onChange={(e) => updateField('game_version', e.target.value)}
            placeholder="1.04"
          />
        </div>

        <div className="form-group">
          <FileManager
            game={modData.game || modData.modgame}
            files={modData.files}
            onChange={(files) => updateField('files', files)}
            onFileChange={handleFileChange}
          />
          {errors.files && <div className="error">{errors.files}</div>}
        </div>
      </div>

      <div className="actions">
        <button onClick={handleSave} disabled={saving}>
          {saving ? t('status.loading') : (isCreating ? t('ui.finish_creation') : t('ui.save_changes'))}
        </button>
        <button onClick={onCancel} disabled={saving}>
          {t('ui.cancel_button')}
        </button>
      </div>
    </div>
  );
}

