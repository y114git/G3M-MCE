import { useState } from 'react';
import { useFileDrop } from '../utils/fileDrop';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '../navigation';
import logoPng from '../assets/g3m-logo.png';
import Icon from '../components/Icon';
import './Home.css';

export default function Home({ onOpenFiles }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState(''),
    [reading, setReading] = useState(false);
  const drop = useFileDrop({
    onError: setError,
    onBusyChange: setReading,
    onDrop: onOpenFiles,
  });

  return (
    <main className="g3m-home">
      <section className="g3m-home__hero" {...drop}>
        <img src={logoPng} alt="G3M" className="g3m-home__logo" />

        <div className="g3m-home__copy">
          <h1>Mod Creator / Editor</h1>
          <p>{t('home.description')}</p>
        </div>

        <div className="g3m-home__actions">
          <button
            className="g3m-button g3m-button--primary"
            onClick={() => navigate('/create')}
            disabled={reading}
          >
            <Icon name="add_icon" />
            {t('ui.create_mod')}
          </button>
          <button
            className="g3m-button"
            onClick={() => navigate('/edit')}
            disabled={reading}
          >
            <Icon name="edit_icon" />
            {t('ui.edit_mod')}
          </button>
        </div>

        <div className="home-feedback">
          <small>{t('mce.dropImport')}</small>
          <p role="status">{reading ? t('status.loading') : '\u00a0'}</p>
          {error && (
            <p className="g3m-inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="g3m-home__links">
          <a
            href="https://gamebanana.com/tools/20615"
            target="_blank"
            rel="noreferrer"
          >
            {t('ui.download_g3m')}
          </a>
        </div>
      </section>
    </main>
  );
}


