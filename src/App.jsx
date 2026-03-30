import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LanguageSelector from './components/LanguageSelector/LanguageSelector';
import Home from './pages/Home';
import CreateMod from './pages/CreateMod';
import EditMod from './pages/EditMod';

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
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
