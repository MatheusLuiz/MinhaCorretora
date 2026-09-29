import '@/styles/producao.css';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { CabecalhoPainel } from '@/components/Painel';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { VoltarPara } from '@/components/VoltarPara';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import { filaEmissoesApi, type LinhaEmissao, type ResultadoFilaEmissoes } from '@/lib/filaEmissoes';
import { formatarCompetencia, formatarData, formatarNumero, formatarReais } from '@/lib/formato';

/**
 * Fila de emissões. Emitida = INÍCIO DE VIGÊNCIA no mês, a régua do dashboard (a soma
 * do rodapé bate com o número clicado). Tipo de negócio vazio é "não informado", nunca
 * "novo". Filtros na URL: um novo clique no dashboard e o "voltar" valem de novo.
 */

const NAO_INFORMADO = 'nao_informado';
const ANO_ATUAL = String(new Date().getFullYear());

const rotuloNegocio = (x: LinhaEmissao['tipoNegocio']): string =>
  x === 'renovacao' ? 'Renovação' : x === 'novo' ? 'Nova' : 'Não informado';

const redondo = (n: number): number => Math.round(n * 100) / 100;

export function FilaEmissoesPage(): React.JSX.Element {
  const { abrir: abrirCliente } = useCliente();
  const [parametros, setParametros] = useSearchParams();

  const mes = parametros.get('mes') ?? '';
  const ano = parametros.get('ano') ?? mes.slice(0, 4);
  const de = parametros.get('de') ?? '';
  const ate = parametros.get('ate') ?? '';
  const seguradora = parametros.get('seguradora') ?? '';
  const tipo = parametros.get('tipo') ?? '';
  const negocio = parametros.get('negocio') ?? '';

  /** Troca um filtro na URL, sem empilhar histórico a cada select. */
  const definir = (mudancas: Record<string, string>): void => {
    const novo = new URLSearchParams(parametros);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor) novo.set(chave, valor);
      else novo.delete(chave);
    }
    setParametros(novo, { replace: true });
  };

  const [dados, setDados] = useState<ResultadoFilaEmissoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Só depois que o servidor disser que cortou (2.000 linhas) o ano vai para a consulta.
  const [cortado, setCortado] = useState(false);
  const anoNaConsulta = cortado ? ano : '';

  useEffect(() => {
    document.title = 'Fila de emissões — MinhaCorretora';
  }, []);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    filaEmissoesApi
      .listar(anoNaConsulta ? { de: `${anoNaConsulta}-01`, ate: `${anoNaConsulta}-12` } : {})
      .then((r) => {
        if (cancelado) return;
        setDados({ ...r, linhas: Array.isArray(r.linhas) ? r.linhas : [] });
        if (r.limitado && !anoNaConsulta) setCortado(true);
      })
      .catch((falha: unknown) => {
        if (cancelado) return;
        setDados({ total: 0, premio: 0, limitado: false, linhas: [] });
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'A fila de emissões precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar as emissões.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, [anoNaConsulta]);

  const linhas = dados?.linhas ?? [];

  const filtradas = useMemo(
    () =>
      linhas.filter((l) => {
        const m = l.vigenciaInicio.slice(0, 7);
        if (mes && m !== mes) return false;
        if (ano && !m.startsWith(ano)) return false;
        if (de && m < de) return false;
        if (ate && m > ate) return false;
        if (seguradora && l.seguradora !== seguradora) return false;
        if (tipo && (l.tipoSeguro ?? '') !== tipo) return false;
        if (negocio === NAO_INFORMADO && l.tipoNegocio !== null) return false;
        if (negocio && negocio !== NAO_INFORMADO && l.tipoNegocio !== negocio) return false;
        return true;
      }),
    [linhas, mes, ano, de, ate, seguradora, tipo, negocio],
  );

  const pag = usePaginacao(filtradas, [mes, ano, de, ate, seguradora, tipo, negocio]);

  const ordenar = (lista: string[]): string[] => [...new Set(lista)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const seguradoras = ordenar(linhas.map((l) => l.seguradora));
  const tipos = ordenar(linhas.map((l) => l.tipoSeguro ?? '').filter(Boolean));
  const anos = [...new Set([ANO_ATUAL, ano, ...linhas.map((l) => l.vigenciaInicio.slice(0, 4))])]
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
  const meses = [...new Set([mes, ...linhas.map((l) => l.vigenciaInicio.slice(0, 7))])]
    .filter((m) => m && (!ano || m.startsWith(ano)))
    .sort((a, b) => b.localeCompare(a));
  const temNova = linhas.some((l) => l.tipoNegocio === 'novo');

  const premioFiltrado = redondo(filtradas.reduce((t, l) => t + (l.premio ?? 0), 0));
  const semPremio = filtradas.filter((l) => l.premio === null).length;
  const algumFiltro = Boolean(mes || ano || de || ate || seguradora || tipo || negocio);

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Fila de emissões"
        descricao="Apólices pelo mês do início de vigência: segurado, seguradora, tipo e prêmio."
      />

      <div className="fila__topo">
        <VoltarPara para="/dashboards/producao" rotulo="Voltar ao dashboard de Produção" />
        <div className="filtros-compactos">
          <label>
            <span>Ano</span>
            <select
              value={ano}
              onChange={(e) =>
                // "Todos" limpa o mês também, senão o ano voltaria derivado dele.
                definir({
                  ano: e.target.value,
                  mes: e.target.value && mes.startsWith(e.target.value) ? mes : '',
                })
              }
            >
              <option value="">Todos</option>
              {anos.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Mês</span>
            <select value={mes} onChange={(e) => definir({ mes: e.target.value })}>
              <option value="">Todos</option>
              {meses.map((m) => (
                <option key={m} value={m}>
                  {formatarCompetencia(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Seguradora</span>
            <select value={seguradora} onChange={(e) => definir({ seguradora: e.target.value })}>
              <option value="">Todas</option>
              {seguradoras.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Tipo de seguro</span>
            <select value={tipo} onChange={(e) => definir({ tipo: e.target.value })}>
              <option value="">Todos</option>
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Tipo de negócio</span>
            <select value={negocio} onChange={(e) => definir({ negocio: e.target.value })}>
              <option value="">Todos</option>
              <option value="renovacao">Renovação</option>
              {temNova && <option value="novo">Nova</option>}
              <option value={NAO_INFORMADO}>Não informado</option>
            </select>
          </label>
          {algumFiltro && (
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => setParametros(new URLSearchParams(), { replace: true })}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {(de || ate) && (
        <p className="producao__janela texto-discreto">
          Período {de ? `de ${formatarCompetencia(de)}` : ''} {ate ? `até ${formatarCompetencia(ate)}` : ''}
          <button
            type="button"
            className="botao botao--discreto botao--compacto"
            onClick={() => definir({ de: '', ate: '' })}
          >
            Remover
          </button>
        </p>
      )}

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {dados?.limitado && (
        <p className="alerta" role="status">
          O período tem {formatarNumero(dados.total)} apólices e a lista traz as{' '}
          {formatarNumero(dados.linhas.length)} mais recentes. Escolha um ano para ver todas; os totais abaixo
          contam só as linhas carregadas.
        </p>
      )}

      {!dados ? (
        <p className="texto-discreto">Carregando…</p>
      ) : (
        <section className="cartao cartao--largo">
          <div className="tabela-rolante">
            <table className="tabela tabela--densa">
              <thead>
                <tr>
                  <th scope="col" title="Início de vigência">
                    Emissão
                  </th>
                  <th scope="col">Segurado</th>
                  <th scope="col">Seguradora</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Apólice</th>
                  <th scope="col">Vigência até</th>
                  <th scope="col" className="tabela__num">
                    Prêmio
                  </th>
                  <th scope="col">Negócio</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && (
                  <tr>
                    <td className="tabela__vazio" colSpan={8}>
                      Nenhuma apólice emitida com estes filtros.
                    </td>
                  </tr>
                )}
                {pag.visiveis.map((l) => {
                  const cliente = l.clienteUuid;
                  return (
                    <tr
                      key={l.uuid}
                      className={cliente ? 'tabela__linha--clicavel' : undefined}
                      onClick={cliente ? () => abrirCliente(cliente) : undefined}
                      tabIndex={cliente ? 0 : undefined}
                      onKeyDown={
                        cliente
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                abrirCliente(cliente);
                              }
                            }
                          : undefined
                      }
                    >
                      <td>{formatarData(l.vigenciaInicio)}</td>
                      <td>
                        {l.segurado || <span className="texto-discreto">—</span>}
                        {l.corretor && (
                          <>
                            <br />
                            <small className="texto-discreto">{l.corretor}</small>
                          </>
                        )}
                      </td>
                      <td>{l.seguradora}</td>
                      <td>{l.tipoSeguro ?? <span className="texto-discreto">—</span>}</td>
                      <td className="tabela__mono">{l.numero}</td>
                      <td>{l.vigenciaFim ? formatarData(l.vigenciaFim) : '—'}</td>
                      <td className="tabela__num">
                        {l.premio === null ? (
                          <span className="texto-discreto" title="A origem não trouxe o prêmio: fica fora da soma">
                            sem prêmio
                          </span>
                        ) : (
                          formatarReais(l.premio)
                        )}
                      </td>
                      <td>
                        {l.tipoNegocio === 'renovacao' ? (
                          <span className="etiqueta etiqueta--ok">Renovação</span>
                        ) : (
                          <span className="texto-discreto">{rotuloNegocio(l.tipoNegocio)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filtradas.length > 0 && (
                <tfoot>
                  <tr className="tabela__total">
                    <th scope="row" colSpan={6}>
                      {formatarNumero(filtradas.length)} apólice(s)
                      {semPremio > 0 && ` · ${formatarNumero(semPremio)} sem prêmio, fora da soma`}
                    </th>
                    <td className="tabela__num">
                      <strong>{formatarReais(premioFiltrado)}</strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <Paginacao p={pag} />
        </section>
      )}
    </div>
  );
}
