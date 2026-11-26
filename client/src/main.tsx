import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Persistenten Speicher anfordern (iPad/Safari löscht sonst ggf. Offline-Daten)
navigator.storage?.persist?.().catch(() => {});

// Offline-Speicher (Service Worker): regelmäßig nach neuen Versionen suchen und automatisch aktualisieren.
// Wichtig für das iPad, wo die App am Home-Bildschirm lange im Hintergrund weiterläuft.
import('virtual:pwa-register')
  .then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        const check = () => reg.update().catch(() => {});
        setInterval(check, 30 * 60 * 1000);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
        window.addEventListener('online', check);
      },
    });
  })
  .catch(() => {});
