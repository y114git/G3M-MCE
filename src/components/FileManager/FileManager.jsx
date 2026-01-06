import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './FileManager.css';

const CHAPTER_TABS = {
  deltarune: ['0', '1', '2', '3', '4'],
  deltarunedemo: ['demo'],
  undertale: ['undertale'],
  undertaleyellow: ['undertaleyellow'],
  pizzatower: ['pizzatower'],
  sugaryspire: ['sugaryspire']
};

export default function FileManager({ game, modgame, files, isPublic, onChange, onFileChange }) {
  const { t } = useTranslation();
  const gameValue = game || modgame;
  const tabs = CHAPTER_TABS[gameValue] || CHAPTER_TABS.deltarune;
  const defaultTab = tabs[0] || '0';
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    const newTabs = CHAPTER_TABS[gameValue] || CHAPTER_TABS.deltarune;
    const newDefaultTab = newTabs[0] || '0';
    if (!newTabs.includes(activeTab)) {
      setActiveTab(newDefaultTab);
    }
  }, [gameValue, activeTab]);

  const getTabLabel = (tab) => {
    if (tab === '0') return t('tabs.menu_root');
    if (tab === 'demo') return t('tabs.demo');
    if (tab === 'undertale') return t('tabs.undertale');
    if (tab === 'undertaleyellow') return t('tabs.undertaleyellow');
    if (tab === 'pizzatower') return t('tabs.pizzatower');
    if (tab === 'sugaryspire') return t('tabs.sugaryspire');
    return t('tabs.chapter_' + tab);
  };

  const addDataFile = () => {
    const chapterFiles = files[activeTab] || {};
    const newFiles = {
      ...files,
      [activeTab]: {
        ...chapterFiles,
        data_file_url: '',
        data_file_version: '1.0.0'
      }
    };
    onChange(newFiles);
  };

  const addExtraFiles = () => {
    const key = prompt(t('dialogs.enter_file_group_key'));
    if (!key || !key.trim()) return;

    const chapterFiles = files[activeTab] || {};
    const extraFiles = chapterFiles.extra_files || [];
    const newFiles = {
      ...files,
      [activeTab]: {
        ...chapterFiles,
        extra_files: [...extraFiles, { key: key.trim(), url: '', version: '1.0.0' }]
      }
    };
    onChange(newFiles);
  };

  const updateDataFile = (field, value) => {
    const chapterFiles = files[activeTab] || {};
    const newFiles = {
      ...files,
      [activeTab]: {
        ...chapterFiles,
        [field]: value
      }
    };
    onChange(newFiles);
  };

  const removeDataFile = () => {
    const chapterFiles = { ...files[activeTab] };
    delete chapterFiles.data_file_url;
    delete chapterFiles.data_file_version;
    const newFiles = { ...files, [activeTab]: chapterFiles };
    onChange(newFiles);
    if (onFileChange) {
      onFileChange(`${activeTab}:data_file`, null);
    }
  };

  const removeExtraFile = (index) => {
    const chapterFiles = files[activeTab] || {};
    const extraFiles = [...(chapterFiles.extra_files || [])];
    const removedExtra = extraFiles[index];
    extraFiles.splice(index, 1);
    const newFiles = {
      ...files,
      [activeTab]: {
        ...chapterFiles,
        extra_files: extraFiles
      }
    };
    onChange(newFiles);
    if (onFileChange && removedExtra) {
      onFileChange(`${activeTab}:extra:${removedExtra.key}`, null);
    }
  };

  const chapterFiles = files[activeTab] || {};

  return (
    <div className="file-manager">
      <h3>{t('ui.files_management')}</h3>
      <div className="tabs">
        {tabs.map(tab => (
          <div
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {getTabLabel(tab)}
          </div>
        ))}
      </div>

      <div className="tab-content">
        <div className="file-actions">
          {!chapterFiles.data_file_url && (
            <button onClick={addDataFile}>{t('ui.add_data_file')}</button>
          )}
          <button onClick={addExtraFiles}>{t('ui.add_extra_files')}</button>
        </div>

        {(chapterFiles.data_file_url !== undefined && chapterFiles.data_file_url !== null) && (
          <div className="frame file-frame">
            <h4>{t('files.data_file')}</h4>
            <div className="form-group">
              <label>{isPublic ? t('files.download_link') : t('files.path_to')}</label>
              {isPublic ? (
                <input
                  type="url"
                  value={chapterFiles.data_file_url}
                  onChange={(e) => updateDataFile('data_file_url', e.target.value)}
                />
              ) : (
                <div className="form-row">
                  <input
                    type="text"
                    value={chapterFiles.data_file_url || ''}
                    readOnly
                    placeholder={t('ui.select_file')}
                  />
                  <input
                    type="file"
                    accept=".win,.ios,.xdelta,.vcdiff,.csx"
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        const file = e.target.files[0];
                        updateDataFile('data_file_url', file.name);
                        if (onFileChange) {
                          onFileChange(`${activeTab}:data_file`, file);
                        }
                      }
                    }}
                    style={{ display: 'none' }}
                    id={`data-file-input-${activeTab}`}
                  />
                  <button onClick={() => document.getElementById(`data-file-input-${activeTab}`).click()}>
                    {t('ui.browse_button')}
                  </button>
                </div>
              )}
            </div>
            <div className="form-group">
              <label>{t('files.version_label', { file_type: 'DATA' })}</label>
              <input
                type="text"
                value={chapterFiles.data_file_version || '1.0.0'}
                onChange={(e) => updateDataFile('data_file_version', e.target.value)}
                placeholder="1.0.0"
              />
            </div>
            <button onClick={removeDataFile}>{t('buttons.delete')}</button>
          </div>
        )}

        {chapterFiles.extra_files?.map((extra, index) => (
          <div key={index} className="frame file-frame">
            <h4>{t('files.extra_files_title', { key_name: extra.key })}</h4>
            <div className="form-group">
              <label>{isPublic ? t('files.archive_link') : t('files.path_to')}</label>
              {isPublic ? (
                <input
                  type="url"
                  value={extra.url}
                  onChange={(e) => {
                    const newExtraFiles = [...chapterFiles.extra_files];
                    newExtraFiles[index] = { ...extra, url: e.target.value };
                    const newFiles = {
                      ...files,
                      [activeTab]: {
                        ...chapterFiles,
                        extra_files: newExtraFiles
                      }
                    };
                    onChange(newFiles);
                  }}
                />
              ) : (
                <div className="form-row">
                  <input
                    type="text"
                    value={extra.url || ''}
                    readOnly
                    placeholder={t('ui.select_archive')}
                  />
                  <input
                    type="file"
                    accept=".zip,.rar,.7z"
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        const file = e.target.files[0];
                        const newExtraFiles = [...chapterFiles.extra_files];
                        newExtraFiles[index] = { ...extra, url: file.name };
                        const newFiles = {
                          ...files,
                          [activeTab]: {
                            ...chapterFiles,
                            extra_files: newExtraFiles
                          }
                        };
                        onChange(newFiles);
                        if (onFileChange) {
                          onFileChange(`${activeTab}:extra:${extra.key}`, file);
                        }
                      }
                    }}
                    style={{ display: 'none' }}
                    id={`extra-file-input-${activeTab}-${index}`}
                  />
                  <button onClick={() => document.getElementById(`extra-file-input-${activeTab}-${index}`).click()}>
                    {t('ui.browse_button')}
                  </button>
                </div>
              )}
            </div>
            <div className="form-group">
              <label>{t('files.version')}</label>
              <input
                type="text"
                value={extra.version}
                onChange={(e) => {
                  const newExtraFiles = [...chapterFiles.extra_files];
                  newExtraFiles[index] = { ...extra, version: e.target.value };
                  const newFiles = {
                    ...files,
                    [activeTab]: {
                      ...chapterFiles,
                      extra_files: newExtraFiles
                    }
                  };
                  onChange(newFiles);
                }}
                placeholder="1.0.0"
              />
            </div>
            <button onClick={() => removeExtraFile(index)}>{t('buttons.delete')}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

