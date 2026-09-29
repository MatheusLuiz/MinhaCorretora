import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useCliente } from '@/hooks/useCliente';
import { useDetalhe } from '@/hooks/useDetalhe';
import { formatarData, formatarNumero, formatarReais } from '@/lib/formato';
import { detalheApi, type ResultadoDetalhe } from '@/lib/detalhe';

/**
 * Gaveta com as linhas por trás do número clicado. Gaveta, não página: o uso
 * é conferir número a número sem perder o painel; a ficha abre por cima.
 */
export function PainelDetalhe(): React.JSX.Element | null {
  const { aberto, fechar } = useDetalhe();
  const { abrir: abrirCliente } = useCliente();

  const [dados, setDados] = useState<ResultadoDetalhe | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);

  const painel = useRef<HTMLElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) {
      setDados(null);
      setErro(false);
      return;
    }

    let cancelado = false;
    setCarregando(true);
    setErro(false);
    focoAnterior.current = document.activeElement as HTMLElement | null;

    void detalheApi
      .carregar(aberto)
      .then((r) => {
        if (!cancelado) setDados(r);
      })
      .catch(() => {
        if (!cancelado) setErro(true);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [aberto]);

  // Devolve o foco a quem abriu; senão o teclado recomeça do topo a cada número.
  useEffect(() => {
    if (!aberto) return;

    function aoTeclar(evento: KeyboardEvent): void {
      if (evento.key === 'Escape') {
        fechar();
        focoAnterior.current?.focus();
      }
    }

    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto, fechar]);

  useEffect(() => {
    if (dados) painel.current?.focus();
  }, [dados]);

  if (!aberto) return null;

  const encerrar = (): void => {
    fechar();
    focoAnterior.current?.focus();
  };

  return (
    <>
      <div className="detalhe__fundo" onClick={encerrar} aria-hidden="true" />

      <aside
        ref={painel}
        className="detalhe"
        role="dialog"
        aria-modal="true"
        aria-label={aberto.titulo}
        tabIndex={-1}
      >
        <header className="detalhe__topo">
          <div>
            <h3>{aberto.titulo}</h3>
            {dados && (
              <p className="texto-discreto">
                {dados.mostrando < dados.total
                  ? `${formatarNumero(dados.mostrando)} de ${formatarNumero(dados.total)} — as de maior valor`
                  : `${formatarNumero(dados.total)} ${dados.tipo === 'clientes' ? 'cliente(s)' : 'apólice(s)'}`}
              </p>
            )}
            {aberto.nota && <p className="texto-discreto">{aberto.nota}</p>}
          </div>

          <div className="detalhe__acoes">
            {/* Fecha a gaveta ao sair, senão ela ficaria aberta sobre a fila. */}
            {aberto.fila && (
              <Link className="botao botao--principal botao--compacto" to={aberto.fila} onClick={fechar}>
                Abrir na fila
              </Link>
            )}
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={encerrar}
            >
              Fechar
            </button>
          </div>
        </header>

        {carregando && <p className="detalhe__estado">Carregando…</p>}

        {erro && (
          <p className="detalhe__estado">
            Não foi possível carregar o detalhe. Se o recorte for de outra
            carteira, ele não aparece aqui — de propósito.
          </p>
        )}

        {dados && dados.total === 0 && (
          <p className="detalhe__estado">
            Nenhum registro neste recorte dentro da sua carteira.
          </p>
        )}

        {dados && dados.tipo === 'apolices' && dados.itens.length > 0 && (
          <div className="tabela-rolante">
            <table className="tabela tabela--densa">
              <thead>
                <tr>
                  <th scope="col">Segurado</th>
                  <th scope="col">Apólice</th>
                  <th scope="col">Seguradora</th>
                  <th scope="col">Produto</th>
                  <th scope="col">Vigência</th>
                  <th scope="col" className="tabela__num">Prêmio</th>
                  <th scope="col" className="tabela__num">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((a) => (
                  <tr
                    key={a.uuid}
                    className={a.clienteUuid ? 'tabela__linha--clicavel' : undefined}
                    onClick={a.clienteUuid ? () => abrirCliente(a.clienteUuid!) : undefined}
                    tabIndex={a.clienteUuid ? 0 : undefined}
                    onKeyDown={
                      a.clienteUuid
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              abrirCliente(a.clienteUuid!);
                            }
                          }
                        : undefined
                    }
                  >
                    <td>
                      {a.segurado || <span className="texto-discreto">—</span>}
                      {!a.clienteUuid && (
                        <span className="texto-discreto"> · sem cadastro</span>
                      )}
                    </td>
                    <td className="tabela__mono">
                      {a.numero}
                      {/* Identificador provisório não é nº de apólice: avisa onde se copia. */}
                      {a.provisoria && (
                        <span className="texto-discreto"> · nº não recuperado</span>
                      )}
                    </td>
                    <td>{a.seguradora}</td>
                    <td>{a.produto ?? <span className="texto-discreto">—</span>}</td>
                    <td>
                      {a.vigenciaInicio ? formatarData(a.vigenciaInicio) : '—'}
                      {a.vigenciaFim ? ` → ${formatarData(a.vigenciaFim)}` : ''}
                    </td>
                    <td className="tabela__num">
                      {a.premio === null ? (
                        <span className="texto-discreto">—</span>
                      ) : (
                        formatarReais(a.premio)
                      )}
                    </td>
                    <td className="tabela__num">
                      {a.comissao === null ? (
                        <span className="texto-discreto">—</span>
                      ) : (
                        formatarReais(a.comissao)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dados && dados.tipo === 'clientes' && dados.itens.length > 0 && (
          <div className="tabela-rolante">
            <table className="tabela tabela--densa">
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">Documento</th>
                  <th scope="col">Contato</th>
                  <th scope="col">Corretor</th>
                  <th scope="col" className="tabela__num">Apólices</th>
                  <th scope="col" className="tabela__num">Prêmio</th>
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((c) => (
                  <tr
                    key={c.uuid}
                    className="tabela__linha--clicavel"
                    onClick={() => abrirCliente(c.uuid)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        abrirCliente(c.uuid);
                      }
                    }}
                  >
                    <td>{c.nome || <span className="texto-discreto">—</span>}</td>
                    <td className="tabela__mono">
                      {c.documento ?? <span className="texto-discreto">—</span>}
                    </td>
                    <td>
                      {c.telefone ?? c.email ?? (
                        <span className="situacao--inadimplente">sem contato</span>
                      )}
                    </td>
                    <td>{c.corretor ?? <span className="texto-discreto">—</span>}</td>
                    <td className="tabela__num">{formatarNumero(c.apolices)}</td>
                    <td className="tabela__num">{formatarReais(c.premio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </aside>
    </>
  );
}
