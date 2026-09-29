import { useEffect, useState } from 'react';

import { formatarNumero } from '@/lib/formato';

/**
 * Paginação das filas. `reiniciarCom`: filtro mudou, volta à página 1 (senão
 * ficaria "na página 7" de uma lista de 5 linhas).
 */
export function usePaginacao<T>(
  itens: T[],
  reiniciarCom: unknown[] = [],
  porPaginaInicial = 12,
): {
  visiveis: T[];
  pagina: number;
  paginas: number;
  porPagina: number;
  quantidade: number;
  irPara: (pagina: number) => void;
  mudarPorPagina: (n: number) => void;
} {
  const [porPagina, setPorPagina] = useState(porPaginaInicial);
  const [pagina, setPagina] = useState(1);

  useEffect(() => setPagina(1), reiniciarCom);

  const paginas = Math.max(1, Math.ceil(itens.length / porPagina));
  const atual = Math.min(pagina, paginas);

  return {
    visiveis: itens.slice((atual - 1) * porPagina, atual * porPagina),
    pagina: atual,
    paginas,
    porPagina,
    quantidade: itens.length,
    irPara: (p) => setPagina(Math.min(Math.max(1, p), paginas)),
    mudarPorPagina: (n) => {
      setPorPagina(n);
      setPagina(1);
    },
  };
}

export function Paginacao({ p }: { p: ReturnType<typeof usePaginacao<unknown>> }): React.JSX.Element | null {
  if (p.quantidade === 0) return null;
  const de = (p.pagina - 1) * p.porPagina + 1;
  const ate = Math.min(p.pagina * p.porPagina, p.quantidade);

  return (
    <nav className="paginacao" aria-label="Páginas">
      <span className="texto-discreto">
        {formatarNumero(de)}–{formatarNumero(ate)} de {formatarNumero(p.quantidade)}
      </span>
      <div className="paginacao__botoes">
        <button
          type="button"
          className="botao botao--discreto botao--compacto"
          onClick={() => p.irPara(p.pagina - 1)}
          disabled={p.pagina <= 1}
        >
          ‹ Anterior
        </button>
        <span className="texto-discreto">
          Página {p.pagina} de {p.paginas}
        </span>
        <button
          type="button"
          className="botao botao--discreto botao--compacto"
          onClick={() => p.irPara(p.pagina + 1)}
          disabled={p.pagina >= p.paginas}
        >
          Próxima ›
        </button>
      </div>
      <label className="paginacao__linhas">
        <span className="texto-discreto">Linhas</span>
        <select value={p.porPagina} onChange={(e) => p.mudarPorPagina(Number(e.target.value))}>
          {[12, 25, 50].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
