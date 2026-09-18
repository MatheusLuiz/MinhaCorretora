import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';

/** Cliente aberto na ficha lateral: um contexto, para a ficha ser renderizada UMA vez no layout. */
export interface ClienteContextValor {
  /** Id do cliente aberto, ou null. */
  aberto: string | null;
  abrir: (id: string) => void;
  fechar: () => void;
}

export const ClienteContext = createContext<ClienteContextValor | null>(null);

export function ClienteProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [aberto, setAberto] = useState<string | null>(null);

  const abrir = useCallback((id: string) => setAberto(id), []);
  const fechar = useCallback(() => setAberto(null), []);

  const valor = useMemo<ClienteContextValor>(() => ({ aberto, abrir, fechar }), [aberto, abrir, fechar]);

  return <ClienteContext.Provider value={valor}>{children}</ClienteContext.Provider>;
}
