import { useState } from 'react';
import LanguageSelector from './components/LanguageSelector/LanguageSelector';
import { NavigationProvider, useCurrentPath, useNavigate } from './navigation';
import Home from './pages/Home';
import CreateMod from './pages/CreateMod';
import EditMod from './pages/EditMod';

function CurrentPage() {
  const path = useCurrentPath(),
    navigate = useNavigate();
  const [initialDrop, setInitialDrop] = useState(null);
  if (path === '/create') return <CreateMod />;
  if (path === '/edit')
    return (
      <EditMod
        initialDrop={initialDrop}
        onDropConsumed={() => setInitialDrop(null)}
      />
    );
  return (
    <Home
      onOpenFiles={(picked) => {
        setInitialDrop(picked);
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

