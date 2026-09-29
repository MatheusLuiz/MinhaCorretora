import { useContext } from 'react';

import { DetalheContext, type DetalheContextValor } from '@/contexts/DetalheContext';

export function useDetalhe(): DetalheContextValor {
  const contexto = useContext(DetalheContext);

  if (!contexto) {
    throw new Error('useDetalhe precisa estar dentro de <DetalheProvider>.');
  }

  return contexto;
}
