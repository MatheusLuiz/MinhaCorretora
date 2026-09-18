import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { aplicarTema, lerTema } from '@/lib/tema';
import '@/styles/global.css';
import '@/styles/app.css';
import '@/styles/sidebar.css';
import '@/styles/painel.css';
import '@/styles/widgets.css';
import '@/styles/menu-usuario.css';
import '@/styles/modal.css';

// O script inline de `index.html` já aplicou o tema; isto o reaplica pela mesma função do seletor.
aplicarTema(lerTema());

const container = document.getElementById('root');

if (!container) {
  throw new Error('Elemento #root não encontrado em index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
