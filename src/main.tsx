import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/tokens.css';
import './styles/components.css';
import './styles/site.css';
import './styles/admin.css';
import './styles/kitchen.css';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './context/AuthProvider';
import { CartProvider } from './context/CartProvider';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
