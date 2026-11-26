import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Persistenten Speicher anfordern (iPad/Safari löscht sonst ggf. Offline-Daten)
navigator.storage?.persist?.().catch(() => {});
