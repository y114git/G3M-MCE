import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import logoPng from '../assets/g3m-logo.png';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <main className="g3m-home">
      <section className="g3m-home__hero">
        <img src={logoPng} alt="G3M" className="g3m-home__logo" />

        <div className="g3m-home__copy">
          <h1>Mod Creator / Editor</h1>
          <p dangerouslySetInnerHTML={{ __html: t('home.description', {
            defaultValue: 'Web workflow for packaging, migrating, and editing local mods in the current G3M format.'
          }) }} />
        </div>

        <div className="g3m-home__actions">
          <button className="g3m-button g3m-button--primary" onClick={() => navigate('/create')}>
            {t('ui.create_mod')}
          </button>
          <button className="g3m-button" onClick={() => navigate('/edit')}>
            {t('ui.edit_mod')}
          </button>
        </div>

        <div className="g3m-home__links">
          <a href="https://gamebanana.com/tools/20615" target="_blank" rel="noreferrer">
            {t('ui.download_g3m')}
          </a>
        </div>
      </section>
    </main>
  );
}
