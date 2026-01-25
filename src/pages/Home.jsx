import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import iconIco from '../assets/icon.ico';
import './Home.css';

export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="home container">
      <div className="home-header">
        <img src={iconIco} alt="DELTAHUB" className="home-icon" />
        <h1>DELTAHUB Mod Creator/Editor</h1>
      </div>

      <div className="home-actions">
        <button
          className="action-button primary"
          onClick={() => navigate('/create')}
        >
          {t('ui.create_mod')}
        </button>
        <button
          className="action-button primary"
          onClick={() => navigate('/edit')}
        >
          {t('ui.edit_mod')}
        </button>
      </div>

      <div className="home-footer">
        <a
          href="https://github.com/y114git/DELTAHUB/wiki/Modder's-Guide"
          target="_blank"
          rel="noopener noreferrer"
          className="guide-link"
        >
          {t('ui.view_guide')}
        </a>
        <a
          href="https://gamebanana.com/tools/20615"
          target="_blank"
          rel="noopener noreferrer"
          className="guide-link"
        >
          {t('ui.download_deltahub')}
        </a>
      </div>
    </div>
  );
}

