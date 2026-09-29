import { createContext, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useTitulo } from '@/hooks/useTitulo';

/**
 * De onde a pessoa veio, para o "← Voltar" das filas. O layout lembra a tela anterior
 * (endereço com filtros e título); só mudança de pathname conta. Guardado na sessão.
 */
export interface Origem {
  /** `pathname` + `search` da tela anterior. */
  caminho: string;
  /** O título que ela mostrava na topbar; null se não tinha cabeçalho. */
  titulo: string | null;
}

const CHAVE = 'minhacorretora:origem';

function ler(): Origem | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as Origem) : null;
  } catch {
    return null;
  }
}

function gravar(origem: Origem): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(origem));
  } catch {
    // Sessão bloqueada (navegação privada): o voltar cai no destino padrão.
  }
}

export const OrigemContext = createContext<Origem | null>(null);

export function OrigemProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const local = useLocation();
  const { atual } = useTitulo();
  const [origem, setOrigem] = useState<Origem | null>(ler);

  const anterior = useRef<{ pathname: string; caminho: string; titulo: string | null } | null>(null);

  useLayoutEffect(() => {
    const aqui = { pathname: local.pathname, caminho: `${local.pathname}${local.search}` };
    const antes = anterior.current;
    // Tela sem título é redirecionamento: voltar para ela cairia de novo na fila.
    if (antes && antes.pathname !== aqui.pathname && antes.titulo !== null) {
      const nova = { caminho: antes.caminho, titulo: antes.titulo };
      setOrigem(nova);
      gravar(nova);
    }
    anterior.current = { ...aqui, titulo: antes && antes.pathname === aqui.pathname ? antes.titulo : null };
  }, [local.pathname, local.search]);

  // A tela define o título no efeito passivo, DEPOIS do efeito acima (que leu o da tela que saiu).
  useLayoutEffect(() => {
    if (anterior.current) anterior.current.titulo = atual?.titulo ?? null;
  }, [atual]);

  return <OrigemContext.Provider value={origem}>{children}</OrigemContext.Provider>;
}
