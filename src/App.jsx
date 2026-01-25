import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSelector from './components/LanguageSelector/LanguageSelector';
import Home from './pages/Home';
import CreateMod from './pages/CreateMod';
import EditMod from './pages/EditMod';

function App() {
  const { i18n } = useTranslation();

  useEffect(() => {
    document.body.setAttribute('data-lang', i18n.language);
  }, [i18n.language]);

  useEffect(() => {
    const handleLanguageChanged = (lng) => {
      document.body.setAttribute('data-lang', lng);
    };

    i18n.on('languageChanged', handleLanguageChanged);

    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [i18n]);

  return (
    <BrowserRouter basename="/DELTAHUB-MCE">
      <LanguageSelector />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateMod />} />
        <Route path="/edit" element={<EditMod />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

