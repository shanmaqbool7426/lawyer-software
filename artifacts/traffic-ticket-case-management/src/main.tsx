import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  // App() owns Clerk provisioning (demo mode, keyed provider, or the
  // missing-key error) — a provider here would nest a second ClerkProvider.
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);