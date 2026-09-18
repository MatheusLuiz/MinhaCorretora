import { useContext } from 'react';

import { ClienteContext, type ClienteContextValor } from '@/contexts/ClienteContext';

export function useCliente(): ClienteContextValor {
  const contexto = useContext(ClienteContext);

  if (!contexto) {
    throw new Error('useCliente precisa estar dentro de <ClienteProvider>.');
  }

  return contexto;
}
