import { useState } from 'react';
import LanguageSelector from './components/LanguageSelector/LanguageSelector';
import { NavigationProvider, useCurrentPath, useNavigate } from './navigation';
import Home from './pages/Home';
import CreateMod from './pages/CreateMod';
import EditMod from './pages/EditMod';

function CurrentPage() {
  const path = useCurrentPath(),
    navigate = useNavigate();
  const [initialFile, setInitialFile] = useState(null);
  if (path === '/create') return <CreateMod />;
  if (path === '/edit')
    return (
      <EditMod
        initialFile={initialFile}
        onFileConsumed={() => setInitialFile(null)}
      />
    );
  return (
    <Home
      onOpenFile={(file) => {
        setInitialFile(file);
        navigate('/edit');
      }}
    />
  );
}

function App() {
  return (
    <NavigationProvider>
      <div
        className="g3m-app"
        onDragOver={(event) => {
          if (
            [...event.dataTransfer.types].includes('Files') ||
            ([...event.dataTransfer.types].includes('text/uri-list') &&
              !event.target.closest('input, textarea, [contenteditable]'))
          )
            event.preventDefault();
        }}
        onDrop={(event) => {
          if (
            [...event.dataTransfer.types].includes('Files') ||
            ([...event.dataTransfer.types].includes('text/uri-list') &&
              !event.target.closest('input, textarea, [contenteditable]'))
          )
            event.preventDefault();
        }}
      >
        <header className="g3m-app__toolbar">
          <LanguageSelector />
        </header>
        <CurrentPage />
      </div>
    </NavigationProvider>
  );
}

export default App;
