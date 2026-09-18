import { useEffect } from 'react';

import { useTitulo } from '@/hooks/useTitulo';

interface PropsCabecalho {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
}

/** Cabeçalho de página: título vai para a topbar (`TituloContext`); aqui só as `acoes`. */
export function CabecalhoPainel({ titulo, descricao, acoes }: PropsCabecalho): React.JSX.Element | null {
  const { definir } = useTitulo();

  useEffect(() => {
    definir({ titulo, descricao });
  }, [definir, titulo, descricao]);

  // Tela sem cabeçalho não herda o título da anterior.
  useEffect(() => () => definir(null), [definir]);

  if (!acoes) return null;

  return (
    <div className="painel__cabecalho painel__cabecalho--so-acoes">
      <div className="painel__acoes">{acoes}</div>
    </div>
  );
}

interface PropsCartao {
  titulo: string;
  /** Explica o que o gráfico mostra; some em tela estreita. */
  subtitulo?: string;
  children: React.ReactNode;
  largo?: boolean;
}

export function CartaoGrafico({ titulo, subtitulo, children, largo }: PropsCartao): React.JSX.Element {
  return (
    <section className={`cartao${largo ? ' cartao--largo' : ''}`}>
      <header className="cartao__cabecalho">
        <h2>{titulo}</h2>
        {subtitulo && <p className="texto-discreto">{subtitulo}</p>}
      </header>
      <div className="cartao__corpo">{children}</div>
    </section>
  );
}

