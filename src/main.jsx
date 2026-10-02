import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import i18n from './i18n';
import './styles/theme.css';
import faviconUrl from './assets/icon.ico';

const setFavicon = (url) => {
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.getElementsByTagName('head')[0].appendChild(link);
  }
  link.href = url;
};

setFavicon(faviconUrl);
document.body.dataset.lang = i18n.language;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
