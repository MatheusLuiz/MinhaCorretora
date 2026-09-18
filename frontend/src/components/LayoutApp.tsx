import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

import { FichaCliente } from '@/components/cliente/FichaCliente';
import { PainelDetalhe } from '@/components/painel/PainelDetalhe';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { ClienteProvider } from '@/contexts/ClienteContext';
import { DetalheProvider } from '@/contexts/DetalheContext';
import { OrigemProvider } from '@/contexts/OrigemContext';
import { TituloProvider } from '@/contexts/TituloContext';

/**
 * Moldura da aplicação. Quem rola é o `<main>`, não o `<body>`, para a sidebar
 * ficar parada; a topbar mora na coluna para não deslizar quando a sidebar expande.
 */
export function LayoutApp(): React.JSX.Element {
  return (
    <ClienteProvider>
    <DetalheProvider>
    <TituloProvider>
    {/* Lembra a tela anterior para o "← Voltar" das filas. */}
    <OrigemProvider>
    <div className="layout">
      <a href="#conteudo" className="pular-navegacao">
        Pular para o conteúdo
      </a>

      <Sidebar />

      <div className="layout__coluna">
        <Topbar />

        <main className="layout__conteudo" id="conteudo">
          {/* Suspense aqui dentro: sidebar e topbar não piscam na troca de tela. */}
          <Suspense fallback={<p className="texto-discreto">Carregando…</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* A ordem importa: a ficha vem depois para ficar POR CIMA da gaveta. */}
      <PainelDetalhe />
      <FichaCliente />
    </div>
    </OrigemProvider>
    </TituloProvider>
    </DetalheProvider>
    </ClienteProvider>
  );
}
