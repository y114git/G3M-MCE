import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { importZip } from '../utils/zipHandler';
import { convertDeltamodToDELTAHUB, extractFileMapping } from '../utils/modConverter';
import ModEditor from '../components/ModEditor/ModEditor';

export default function EditMod() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [modData, setModData] = useState(null);
  const [iconFile, setIconFile] = useState(null);
  const [initialFileObjects, setInitialFileObjects] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setIconFile(null);

    try {
      const result = await importZip(file);

      let extractedIconFile = null;
      const iconEntry = result.files['icon.png'] || result.files['icon/icon.png'] ||
        Object.values(result.files).find(f => f.name === 'icon.png' || f.name.endsWith('/icon.png'));
      if (iconEntry && !iconEntry.dir) {
        const iconBlob = await iconEntry.async('blob');
        extractedIconFile = new File([iconBlob], 'icon.png', { type: 'image/png' });
        setIconFile(extractedIconFile);
      }

      if (result.isDeltamod) {
        let deltamodInfoText = '';
        for (const path of ['deltamodInfo.json', '_deltamodInfo.json', 'meta.json']) {
          const entry = result.files[path] || Object.values(result.files).find(f => f.name === path);
          if (entry && !entry.dir) {
            deltamodInfoText = await entry.async('string');
            break;
          }
        }
        const deltamodInfo = JSON.parse(deltamodInfoText || '{}');

        let moddingXmlText = '';
        const xmlEntry = result.files['modding.xml'] || Object.values(result.files).find(f => f.name === 'modding.xml');
        if (xmlEntry && !xmlEntry.dir) {
          moddingXmlText = await xmlEntry.async('string');
        }

        const parser = new DOMParser();
        let moddingXml = parser.parseFromString(moddingXmlText.trim(), 'text/xml');

        if (moddingXml.querySelector('parsererror')) {
          let wrappedContent = moddingXmlText.trim();
          if (!wrappedContent.startsWith('<?xml')) {
            wrappedContent = `<?xml version="1.0" encoding="UTF-8"?>\n<patches>\n${wrappedContent}\n</patches>`;
          } else {
            const lines = wrappedContent.split('\n');
            wrappedContent = lines[0] + '\n<patches>\n' + lines.slice(1).join('\n') + '\n</patches>';
          }
          moddingXml = parser.parseFromString(wrappedContent, 'text/xml');
        }

        const files = {};
        for (const [path, entry] of Object.entries(result.files)) {
          if (!entry.dir) {
            files[path] = await entry.async('blob');
          }
        }

        const converted = convertDeltamodToDELTAHUB(deltamodInfo, moddingXml);
        setModData(converted);

        const fileMapping = extractFileMapping(converted, files);
        const fileObjectsMap = new Map();

        for (const [chapterKey, chapterFiles] of Object.entries(converted.files || {})) {
          if (chapterFiles.data_file_url) {
            const sourceKey = `${chapterKey}:data_file`;
            const sourcePath = fileMapping.get(sourceKey);
            if (sourcePath && files[sourcePath]) {
              const blob = files[sourcePath];
              const fileName = chapterFiles.data_file_url.split('/').pop() || chapterFiles.data_file_url;
              const file = new File([blob], fileName, { type: blob.type });
              fileObjectsMap.set(sourceKey, file);
            }
          }

          if (chapterFiles.extra_files && Array.isArray(chapterFiles.extra_files)) {
            for (const extra of chapterFiles.extra_files) {
              const fileKey = `${chapterKey}:extra:${extra.key}`;
              const sourcePath = fileMapping.get(fileKey) || extra._sourceFile;

              if (sourcePath && files[sourcePath]) {
                const blob = files[sourcePath];
                const fileName = sourcePath.split('/').pop() || extra.key;
                const file = new File([blob], fileName, { type: blob.type });
                fileObjectsMap.set(fileKey, file);
              }
            }
          }
        }
        setInitialFileObjects(fileObjectsMap);
      } else if (result.modConfig) {
        setModData(result.modConfig);

        const getChapterFolderName = (chapterKey) => {
          if (chapterKey === 'demo') return 'demo';
          if (chapterKey === 'undertale') return 'undertale';
          if (chapterKey === 'undertaleyellow') return 'undertaleyellow';
          if (chapterKey === 'pizzatower') return 'pizzatower';
          if (chapterKey === 'sugaryspire') return 'sugaryspire';
          if (chapterKey === '0') {
            const game = result.modConfig?.game || 'deltarune';
            if (game === 'pizzatower' || game === 'pizzaoven') {
              return 'pizzatower';
            }
            return 'chapter_0';
          }
          if (/^\d+$/.test(chapterKey)) return `chapter_${chapterKey}`;
          return `chapter_${chapterKey}`;
        };

        const fileObjectsMap = new Map();
        for (const [chapterKey, chapterFiles] of Object.entries(result.modConfig.files || {})) {
          const chapterFolder = getChapterFolderName(chapterKey);

          if (chapterFiles.data_file_url && !chapterFiles.data_file_url.startsWith('http')) {
            const fileName = chapterFiles.data_file_url.split('/').pop() || chapterFiles.data_file_url;
            const pathsToTry = [
              `${chapterFolder}/${fileName}`,
              chapterFiles.data_file_url,
              fileName
            ];

            let entry = null;
            for (const path of pathsToTry) {
              entry = result.files[path];
              if (entry && !entry.dir) break;
            }

            if (!entry) {
              entry = Object.values(result.files).find(f =>
                !f.dir && (f.name === fileName || f.name.endsWith('/' + fileName))
              );
            }

            if (entry && !entry.dir) {
              const blob = await entry.async('blob');
              const file = new File([blob], fileName, { type: blob.type });
              fileObjectsMap.set(`${chapterKey}:data_file`, file);
              chapterFiles.data_file_url = fileName;
            }
          }

          if (chapterFiles.extra_files) {
            for (const extra of chapterFiles.extra_files) {
              if (extra.url && !extra.url.startsWith('http')) {
                const fileName = extra.url.split('/').pop() || extra.url;
                const pathsToTry = [
                  `${chapterFolder}/${fileName}`,
                  extra.url,
                  fileName
                ];

                let entry = null;
                for (const path of pathsToTry) {
                  entry = result.files[path];
                  if (entry && !entry.dir) break;
                }

                if (!entry) {
                  entry = Object.values(result.files).find(f =>
                    !f.dir && (f.name === fileName || f.name.endsWith('/' + fileName))
                  );
                }

                if (entry && !entry.dir) {
                  const blob = await entry.async('blob');
                  const file = new File([blob], fileName, { type: blob.type });
                  fileObjectsMap.set(`${chapterKey}:extra:${extra.key}`, file);
                  extra.url = fileName;
                }
              }
            }
          }
        }
        setInitialFileObjects(fileObjectsMap);
      } else {
        throw new Error(t('errors.invalid_mod_format'));
      }
    } catch (err) {
      setError(err.message || t('errors.error'));
    } finally {
      setLoading(false);
    }
  };

  if (modData) {
    return (
      <div className="container">
        <ModEditor
          isCreating={false}
          modData={modData}
          initialIconFile={iconFile}
          initialFileObjects={initialFileObjects}
          onCancel={() => navigate('/')}
        />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="frame">
        <h2>{t('ui.import_mod')}</h2>
        <div className="form-group">
          <input
            type="file"
            accept=".zip"
            onChange={handleFileSelect}
            disabled={loading}
          />
        </div>
        {error && <div className="error">{error}</div>}
        {loading && <div>{t('status.loading')}</div>}
        <div className="actions">
          <button onClick={() => navigate('/')}>{t('ui.cancel_button')}</button>
        </div>
      </div>
    </div>
  );
}
