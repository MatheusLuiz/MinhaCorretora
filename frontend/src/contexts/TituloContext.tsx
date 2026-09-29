import { createContext, useCallback, useMemo, useState } from 'react';

/** Título da tela aberta, mostrado na topbar; quem informa é o `CabecalhoPainel` de cada página. */
export interface TituloDaTela {
  titulo: string;
  descricao?: string;
}

interface TituloContextValor {
  atual: TituloDaTela | null;
  definir: (titulo: TituloDaTela | null) => void;
}

export const TituloContext = createContext<TituloContextValor | null>(null);

export function TituloProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [atual, setAtual] = useState<TituloDaTela | null>(null);
  const definir = useCallback((t: TituloDaTela | null) => setAtual(t), []);
  const valor = useMemo(() => ({ atual, definir }), [atual, definir]);
  return <TituloContext.Provider value={valor}>{children}</TituloContext.Provider>;
}
