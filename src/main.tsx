import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// Ask the browser not to evict our offline data under storage pressure (best effort; may be refused).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
