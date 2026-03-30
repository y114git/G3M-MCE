import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ModEditor from '../components/ModEditor/ModEditor';
import { importZipArchive } from '../utils/zipHandler';

export default function EditMod() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [importState, setImportState] = useState({
    loading: false,
    error: '',
    config: null,
    assets: null
  });

  const handleArchiveSelect = async (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setImportState((prev) => ({ ...prev, loading: true, error: '' }));

    try {
      const imported = await importZipArchive(selectedFile);
      setImportState({
        loading: false,
        error: '',
        config: imported.config,
        assets: imported.assets
      });
    } catch (error) {
      setImportState({
        loading: false,
        error: error instanceof Error ? error.message : t('errors.invalid_mod_format'),
        config: null,
        assets: null
      });
    }
  };

  if (importState.config) {
    return <ModEditor isCreating={false} initialConfig={importState.config} initialAssets={importState.assets} />;
  }

  return (
    <main className="g3m-page-shell">
      <section className="g3m-panel g3m-panel--import">
        <div className="g3m-page-heading">
          <p>{t('edit.importLead', { defaultValue: 'Open an existing archive and continue in the same editor flow.' })}</p>
          <h1>{t('ui.edit_mod')}</h1>
        </div>

        <label className="g3m-upload">
          <span>{t('edit.archiveField', { defaultValue: 'Select mod archive' })}</span>
          <input type="file" accept=".zip" onChange={handleArchiveSelect} disabled={importState.loading} />
        </label>

        {importState.loading ? <div className="g3m-inline-note">{t('status.loading')}</div> : null}
        {importState.error ? <div className="g3m-inline-error">{importState.error}</div> : null}

        <div className="g3m-editor__footer-actions">
          <button className="g3m-button" onClick={() => navigate('/')}>
            {t('ui.cancel_button')}
          </button>
        </div>
      </section>
    </main>
  );
}
