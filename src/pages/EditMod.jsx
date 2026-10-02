import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '../navigation';
import ModEditor from '../components/ModEditor/ModEditor';
import { importConfigFile, importZipArchive } from '../utils/zipHandler';
import { useFileDrop } from '../utils/fileDrop';

export default function EditMod({ initialFile, onFileConsumed }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [importState, setImportState] = useState({
    loading: false,
    error: '',
    config: null,
    assets: null,
  });

  const initialOpened = useRef(null);
  const openArchive = async (selectedFile) => {
    if (!selectedFile || importState.loading) return;

    setImportState((prev) => ({ ...prev, loading: true, error: '' }));

    try {
      const imported = await (/\.json$/i.test(selectedFile.name)
        ? importConfigFile(selectedFile)
        : importZipArchive(selectedFile));
      setImportState({
        loading: false,
        error: '',
        config: imported.config,
        assets: imported.assets,
      });
    } catch (error) {
      setImportState({
        loading: false,
        error: error instanceof Error ? error.message : t('mce.invalidImport'),
        config: null,
        assets: null,
      });
    }
  };
  const drop = useFileDrop({
    disabled: importState.loading,
    onBusyChange: (loading) =>
      setImportState((previous) => ({ ...previous, loading })),
    onDrop: async (picked) => {
      const files = Object.values(picked.files);
      if (files.length !== 1 || picked.directories.length)
        throw new Error(t('mce.singleFile'));
      await openArchive(files[0]);
    },
    onError: (message) =>
      setImportState((previous) => ({ ...previous, error: message })),
  });
  useEffect(() => {
    if (initialFile && initialOpened.current !== initialFile) {
      initialOpened.current = initialFile;
      openArchive(initialFile);
      onFileConsumed();
    }
  }, [initialFile]);

  if (importState.config) {
    return (
      <ModEditor
        isCreating={false}
        initialConfig={importState.config}
        initialAssets={importState.assets}
      />
    );
  }

  return (
    <main className="g3m-page-shell">
      <section className="g3m-panel g3m-panel--import" {...drop}>
        <div className="g3m-page-heading">
          <p>{t('mce.importHint')}</p>
          <h1>{t('ui.edit_mod')}</h1>
        </div>

        <label className="g3m-upload">
          <span>{t('mce.importConfig')}</span>
          <input
            type="file"
            accept=".zip,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              openArchive(file);
            }}
            disabled={importState.loading}
          />
        </label>

        <div className="import-feedback">
          {importState.loading ? (
            <div className="g3m-inline-note">{t('status.loading')}</div>
          ) : null}
          {importState.error ? (
            <div className="g3m-inline-error" role="alert">
              {importState.error}
            </div>
          ) : null}
        </div>
        <div className="g3m-editor__footer-actions">
          <button className="g3m-button" onClick={() => navigate('/')}>
            {t('ui.cancel_button')}
          </button>
        </div>
      </section>
    </main>
  );
}
