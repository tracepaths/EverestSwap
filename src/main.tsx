import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
import App from './App'

window.onerror = (_msg, _url, _line, _col, err) => {
  console.error('[Global onerror]', err?.message);
};
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Rejection]', e.reason?.message || e.reason);
});

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
