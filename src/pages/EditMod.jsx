import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '../navigation';
import ModEditor from '../components/ModEditor/ModEditor';
import { createEmptyModConfig } from '../data/modConfig';
import { assetsFromFiles, useFileDrop } from '../utils/fileDrop';
import { importConfigFile, importZipArchive } from '../utils/zipHandler';

export default function EditMod({ initialDrop, onDropConsumed }) {
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
      const imported = /\.json$/i.test(selectedFile.name)
        ? await importConfigFile(selectedFile)
        : /\.zip$/i.test(selectedFile.name)
          ? await importZipArchive(selectedFile)
          : { config: createEmptyModConfig(), assets: assetsFromFiles([selectedFile]) };
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
  const openDrop = async (picked) => {
    const files = Object.values(picked.files);
    if (files.length === 1 && !picked.directories.length && /\.(?:zip|json)$/i.test(files[0].name)) {
      await openArchive(files[0]);
      return;
    }
    setImportState({ loading: false, error: '', config: createEmptyModConfig(), assets: picked });
  };
  const drop = useFileDrop({
    disabled: importState.loading,
    onBusyChange: (loading) =>
      setImportState((previous) => ({ ...previous, loading })),
    onDrop: async (picked) => {
      await openDrop(picked);
    },
    onError: (message) =>
      setImportState((previous) => ({ ...previous, error: message })),
  });
  useEffect(() => {
    if (initialDrop && initialOpened.current !== initialDrop) {
      initialOpened.current = initialDrop;
      openDrop(initialDrop);
      onDropConsumed();
    }
  }, [initialDrop]);

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
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) openArchive(file);
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

