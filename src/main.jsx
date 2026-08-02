import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AdminConsole from './components/AdminConsole.jsx';
import { registerServiceWorker } from './push.js';
import './styles.css';

// /admin is the hidden maintenance console — a separate identity, never the
// couple app.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isAdmin ? <AdminConsole /> : <App />}</React.StrictMode>
);

// Register early so a push can arrive even when the app isn't open (skip on admin).
if (!isAdmin) registerServiceWorker();
