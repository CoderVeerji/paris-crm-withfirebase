import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { initTheme } from './lib/theme';
import './lib/pwa'; // beforeinstallprompt ko jaldi capture karo (React mount se pehle fire ho sakta hai)
import { LangProvider } from './i18n';

initTheme();
import { AuthProvider } from './auth';
import { ConfigProvider } from './config';
import { Toaster } from './toast';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LangProvider>
        <AuthProvider>
          <ConfigProvider>
            <App />
            <Toaster />
          </ConfigProvider>
        </AuthProvider>
      </LangProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
