import { useContext } from 'react';

import { TituloContext } from '@/contexts/TituloContext';

/** O título da tela aberta. Fora do layout (login), não há provedor: fica nulo. */
export function useTitulo(): { atual: { titulo: string; descricao?: string } | null; definir: (t: { titulo: string; descricao?: string } | null) => void } {
  return useContext(TituloContext) ?? { atual: null, definir: () => {} };
}
