import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';

import type { PedidoDetalhe } from '@/lib/detalhe';

/** Recorte aberto na gaveta de detalhe; convive com a ficha do cliente, que abre por cima da lista. */
export interface DetalheContextValor {
  aberto: PedidoDetalhe | null;
  abrir: (pedido: PedidoDetalhe) => void;
  fechar: () => void;
}

export const DetalheContext = createContext<DetalheContextValor | null>(null);

export function DetalheProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [aberto, setAberto] = useState<PedidoDetalhe | null>(null);

  const abrir = useCallback((pedido: PedidoDetalhe) => setAberto(pedido), []);
  const fechar = useCallback(() => setAberto(null), []);

  const valor = useMemo<DetalheContextValor>(
    () => ({ aberto, abrir, fechar }),
    [aberto, abrir, fechar],
  );

  return <DetalheContext.Provider value={valor}>{children}</DetalheContext.Provider>;
}
