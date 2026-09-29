import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { CabecalhoPainel } from '@/components/Painel';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import {
  estornosApi,
  type CancelamentoLinha,
  type EstornoLinha,
  type RespostaEstornos,
} from '@/lib/estornos';
import { formatarCompetencia, formatarData, formatarNumero, formatarReais } from '@/lib/formato';

import '@/styles/estornos.css';

/**
 * Estornos. Sem total geral: a mesma apólice pode estar estornada no recibo e
 * perdida no contrato, e somar contaria o mesmo dinheiro duas vezes. Comissão não
 * informada fica fora da soma, nunca como zero.
 */

type Bloco = 'estornos' | 'cancelamentos';

const MES_ATUAL = (() => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
})();

/** Soma em centavos inteiros: somar reais em ponto flutuante deixa dízima. */
const somar = (valores: number[]): number => valores.reduce((t, v) => t + Math.round(v * 100), 0) / 100;

function mesesDaSerie(ano: string): string[] {
  if (ano) return Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
  const a = Number(MES_ATUAL.slice(0, 4));
  const m = Number(MES_ATUAL.slice(5, 7));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(a, m - 12 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Decorativa: o número exato está no `title` e na lista. */
function SerieMensal({
  meses,
  valores,
  formatar,
  destaque,
  tom,
}: {
  meses: string[];
  valores: number[];
  formatar: (v: number) => string;
  destaque: string;
  tom: 'perda' | 'neutro';
}): React.JSX.Element {
  const maximo = Math.max(...valores.map(Math.abs), 0);
  return (
    <div className={`estornos__serie estornos__serie--${tom}`} aria-hidden="true">
      {meses.map((m, i) => {
        const v = valores[i] ?? 0;
        const altura = maximo > 0 ? Math.max(Math.abs(v) / maximo, v === 0 ? 0 : 0.06) : 0;
        return (
          <span
            key={m}
            className={`estornos__coluna${destaque === m ? ' estornos__coluna--destaque' : ''}`}
            title={`${formatarCompetencia(m)}: ${formatar(v)}`}
          >
            <span className="estornos__barra" style={{ height: `${Math.round(altura * 100)}%` }} />
            <span className="estornos__mes">{MES_CURTO[Number(m.slice(5)) - 1]}</span>
          </span>
        );
      })}
    </div>
  );
}

function propsDeLinha(
  uuid: string | null,
  abrir: (id: string) => void,
): React.HTMLAttributes<HTMLTableRowElement> {
  if (!uuid) return {};
  return {
    className: 'tabela__linha--clicavel',
    tabIndex: 0,
    onClick: () => abrir(uuid),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        abrir(uuid);
      }
    },
  };
}

export function EstornosPage(): React.JSX.Element {
  const { abrir: abrirCliente } = useCliente();

  const [dados, setDados] = useState<RespostaEstornos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [bloco, setBloco] = useState<Bloco>('estornos');
  const [filtroSeguradora, setFiltroSeguradora] = useState('');
  const [filtroAno, setFiltroAno] = useState(MES_ATUAL.slice(0, 4));
  const [filtroMes, setFiltroMes] = useState('');

  useEffect(() => {
    document.title = 'Estornos — MinhaCorretora';
  }, []);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  useEffect(() => {
    let cancelado = false;
    const ano = Number(MES_ATUAL.slice(0, 4));
    estornosApi
      .listar(`${ano - 4}-01`, MES_ATUAL)
      .then((r) => !cancelado && setDados(r))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'Esta tela precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar os estornos.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const estornos: EstornoLinha[] = Array.isArray(dados?.estornos?.linhas) ? dados.estornos.linhas : [];
  const canceladas: CancelamentoLinha[] = Array.isArray(dados?.cancelamentos?.linhas)
    ? dados.cancelamentos.linhas
    : [];

  const daSeguradora = (s: string): boolean => !filtroSeguradora || s === filtroSeguradora;
  const noRecorte = (s: string, mes: string): boolean =>
    daSeguradora(s) && (!filtroAno || mes.startsWith(filtroAno)) && (!filtroMes || mes === filtroMes);

  const estornosDoRecorte = estornos.filter((e) => noRecorte(e.seguradora, e.mes));
  const canceladasDoRecorte = canceladas.filter((a) => noRecorte(a.seguradora, a.mes));

  const totalEstornos = somar(estornosDoRecorte.map((e) => e.valor));
  const comComissao = canceladasDoRecorte.filter((a) => a.comissao !== null);
  const semComissao = canceladasDoRecorte.length - comComissao.length;
  const totalPerdido = somar(comComissao.map((a) => a.comissao ?? 0));

  // O mês não recorta a série (ela É a linha do tempo).
  const serie = mesesDaSerie(filtroAno);
  const serieEstornos = serie.map((m) =>
    somar(estornos.filter((e) => e.mes === m && daSeguradora(e.seguradora)).map((e) => e.valor)),
  );
  const canceladasDaSerie = canceladas.filter((a) => serie.includes(a.mes) && daSeguradora(a.seguradora));
  // Sem comissão informada, a série conta apólices em vez de barras zeradas com cifrão.
  const serieEmReais = canceladasDaSerie.some((a) => a.comissao !== null);
  const serieCancelamentos = serie.map((m) => {
    const doMes = canceladasDaSerie.filter((a) => a.mes === m);
    return serieEmReais ? somar(doMes.map((a) => a.comissao ?? 0)) : doMes.length;
  });

  const reinicio = [filtroSeguradora, filtroAno, filtroMes, bloco];
  const pagEstornos = usePaginacao(estornosDoRecorte, reinicio);
  const pagCanceladas = usePaginacao(canceladasDoRecorte, reinicio);

  const todosOsMeses = [...estornos.map((e) => e.mes), ...canceladas.map((a) => a.mes)];
  const seguradoras = [...new Set([...estornos, ...canceladas].map((l) => l.seguradora))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
  const anos = [...new Set([MES_ATUAL.slice(0, 4), ...todosOsMeses.map((m) => m.slice(0, 4))])].sort((a, b) =>
    b.localeCompare(a),
  );
  const meses = [...new Set(todosOsMeses)]
    .filter((m) => !filtroAno || m.startsWith(filtroAno))
    .sort((a, b) => b.localeCompare(a));

  const periodo = filtroMes
    ? formatarCompetencia(filtroMes)
    : filtroAno
      ? `em ${filtroAno}`
      : 'nos últimos 5 anos';

  return (
    <div className="painel painel--tela estornos">
      <CabecalhoPainel
        titulo="Estornos"
        descricao="Quanto a corretora perdeu com cancelamento: o que a seguradora descontou e o que a apólice deixou de gerar."
      />

      <div className="fila__topo">
        <p className="texto-discreto estornos__periodo">Período: {periodo}</p>
        <div className="filtros-compactos">
          <label>
            <span>Seguradora</span>
            <select value={filtroSeguradora} onChange={(e) => setFiltroSeguradora(e.target.value)}>
              <option value="">Todas</option>
              {seguradoras.map((nome) => (
                <option key={nome} value={nome}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Ano</span>
            <select
              value={filtroAno}
              onChange={(e) => {
                setFiltroAno(e.target.value);
                if (e.target.value && !filtroMes.startsWith(e.target.value)) setFiltroMes('');
              }}
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
            <select value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}>
              <option value="">Todos</option>
              {meses.map((m) => (
                <option key={m} value={m}>
                  {formatarCompetencia(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {!dados && !erro ? (
        <p className="texto-discreto">Carregando…</p>
      ) : (
        dados && (
          <>
            <div className="estornos__blocos">
              <button
                type="button"
                className={`estornos__bloco${bloco === 'estornos' ? ' estornos__bloco--ativo' : ''}`}
                aria-pressed={bloco === 'estornos'}
                onClick={() => setBloco('estornos')}
                title="Dinheiro que já saiu: a seguradora tirou do recibo."
              >
                <span className="estornos__bloco-texto">
                  <span className="estornos__rotulo">Estornos descontados</span>
                  <strong className="estornos__total estornos__total--perda">
                    {formatarReais(totalEstornos)}
                  </strong>
                  <span className="estornos__legenda">
                    {formatarNumero(estornosDoRecorte.length)} lançamento(s) negativo(s)
                  </span>
                </span>
                <SerieMensal
                  meses={serie}
                  valores={serieEstornos}
                  formatar={formatarReais}
                  destaque={filtroMes}
                  tom="perda"
                />
              </button>

              <p
                className="estornos__nao-soma"
                role="note"
                title="Os dois números medem coisas diferentes e podem falar da mesma apólice — estornada no recibo e perdida no contrato. Somá-los contaria o mesmo dinheiro duas vezes."
              >
                <span aria-hidden="true">≠</span>
                <small>não se somam</small>
              </p>

              <button
                type="button"
                className={`estornos__bloco${bloco === 'cancelamentos' ? ' estornos__bloco--ativo' : ''}`}
                aria-pressed={bloco === 'cancelamentos'}
                onClick={() => setBloco('cancelamentos')}
                title={
                  serieEmReais
                    ? 'O que a apólice deixaria de gerar — pelo contrato, não pelo extrato.'
                    : 'As barras contam apólices: a seguradora não informa a comissão das canceladas.'
                }
              >
                <span className="estornos__bloco-texto">
                  <span className="estornos__rotulo">Comissão perdida por cancelamento</span>
                  {comComissao.length === 0 && canceladasDoRecorte.length > 0 ? (
                    <strong className="estornos__total estornos__total--pendente">Não informada</strong>
                  ) : (
                    <strong className="estornos__total">{formatarReais(totalPerdido)}</strong>
                  )}
                  <span className="estornos__legenda">
                    {formatarNumero(canceladasDoRecorte.length)} apólice(s) cancelada(s)
                    {semComissao > 0 && ` · ${formatarNumero(semComissao)} sem comissão`}
                  </span>
                </span>
                <SerieMensal
                  meses={serie}
                  valores={serieCancelamentos}
                  formatar={serieEmReais ? formatarReais : (v) => `${formatarNumero(v)} apólice(s)`}
                  destaque={filtroMes}
                  tom="neutro"
                />
              </button>
            </div>

            <section className="cartao cartao--largo estornos__lista">
              {bloco === 'estornos' ? (
                <>
                  <h2 className="estornos__titulo-lista">Estornos descontados · {periodo}</h2>
                  <div className="tabela-rolante">
                    <table className="tabela tabela--densa">
                      <thead>
                        <tr>
                          <th scope="col">Pago em</th>
                          <th scope="col">Seguradora</th>
                          <th scope="col">Segurado / apólice</th>
                          <th scope="col">Lançamento</th>
                          <th scope="col" className="tabela__num">
                            Prêmio da parcela
                          </th>
                          <th scope="col" className="tabela__num">
                            Estorno
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {estornosDoRecorte.length === 0 && (
                          <tr>
                            <td className="tabela__vazio" colSpan={6}>
                              Nenhum estorno com estes filtros.
                            </td>
                          </tr>
                        )}
                        {pagEstornos.visiveis.map((e, i) => (
                          <tr
                            key={`${e.recibo}-${e.apolice ?? ''}-${e.parcela ?? ''}-${i}`}
                            {...propsDeLinha(e.clienteUuid, abrirCliente)}
                          >
                            <td>
                              {e.pagoEm ? formatarData(e.pagoEm) : '—'}
                              <br />
                              <small className="texto-discreto tabela__mono">{e.recibo}</small>
                            </td>
                            <td>{e.seguradora}</td>
                            <td>
                              {e.cliente ?? e.segurado ?? (
                                <span className="texto-discreto">recibo inteiro, sem detalhe</span>
                              )}
                              {e.apolice && (
                                <>
                                  <br />
                                  <small className="texto-discreto tabela__mono">
                                    {e.apolice}
                                    {e.parcela !== null && ` · ${e.parcela}ª parcela`}
                                  </small>
                                </>
                              )}
                            </td>
                            <td className="texto-discreto">{e.tipo ?? '—'}</td>
                            <td className="tabela__num">
                              {e.premio === null ? '—' : formatarReais(e.premio)}
                            </td>
                            <td className="tabela__num situacao--inadimplente">{formatarReais(e.valor)}</td>
                          </tr>
                        ))}
                        <tr className="tabela__respiro" aria-hidden="true">
                          <td colSpan={6} />
                        </tr>
                      </tbody>
                      {estornosDoRecorte.length > 0 && (
                        <tfoot>
                          <tr className="tabela__total">
                            <th scope="row" colSpan={5}>
                              Total descontado
                            </th>
                            <td className="tabela__num">
                              <strong>{formatarReais(totalEstornos)}</strong>
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <Paginacao p={pagEstornos} />
                </>
              ) : (
                <>
                  <h2 className="estornos__titulo-lista">Apólices canceladas · {periodo}</h2>
                  <div className="tabela-rolante">
                    <table className="tabela tabela--densa">
                      <thead>
                        <tr>
                          <th scope="col">Cancelada em</th>
                          <th scope="col">Cliente</th>
                          <th scope="col">Seguradora / apólice</th>
                          <th scope="col">Motivo</th>
                          <th scope="col" className="tabela__num">
                            Prêmio
                          </th>
                          <th scope="col" className="tabela__num">
                            Comissão
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {canceladasDoRecorte.length === 0 && (
                          <tr>
                            <td className="tabela__vazio" colSpan={6}>
                              Nenhuma apólice cancelada com estes filtros.
                            </td>
                          </tr>
                        )}
                        {pagCanceladas.visiveis.map((a) => (
                          <tr
                            key={`${a.seguradora}-${a.apolice}`}
                            {...propsDeLinha(a.clienteUuid, abrirCliente)}
                          >
                            <td>
                              {a.canceladaEm ? (
                                formatarData(a.canceladaEm)
                              ) : (
                                <span title="A companhia declara cancelada sem data: vale o fim da vigência">
                                  {formatarCompetencia(a.mes)}
                                </span>
                              )}
                            </td>
                            <td>
                              {a.cliente ?? a.segurado}
                              {a.corretor && (
                                <>
                                  <br />
                                  <small className="texto-discreto">{a.corretor}</small>
                                </>
                              )}
                            </td>
                            <td>
                              {a.seguradora}
                              <br />
                              <small className="texto-discreto tabela__mono">{a.apolice}</small>
                            </td>
                            <td>
                              <span className="estornos__motivo">{a.motivo ?? 'Motivo não informado'}</span>
                              {a.inadimplencia && (
                                <>
                                  <br />
                                  {/* stopPropagation: o link não pode abrir a ficha da linha junto. */}
                                  <Link
                                    to="/financeiro/inadimplencia"
                                    className="estornos__link"
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                  >
                                    Ver inadimplência ›
                                  </Link>
                                </>
                              )}
                            </td>
                            <td className="tabela__num">
                              {a.premio === null ? (
                                <span className="texto-discreto">não informado</span>
                              ) : (
                                formatarReais(a.premio)
                              )}
                            </td>
                            <td className="tabela__num">
                              {a.comissao === null ? (
                                <span
                                  className="texto-discreto"
                                  title="A seguradora não informa: fica fora da soma"
                                >
                                  não informada
                                </span>
                              ) : (
                                formatarReais(a.comissao)
                              )}
                            </td>
                          </tr>
                        ))}
                        <tr className="tabela__respiro" aria-hidden="true">
                          <td colSpan={6} />
                        </tr>
                      </tbody>
                      {canceladasDoRecorte.length > 0 && (
                        <tfoot>
                          <tr className="tabela__total">
                            <th scope="row" colSpan={5}>
                              Comissão perdida (informada)
                              {semComissao > 0 &&
                                ` · ${formatarNumero(semComissao)} sem comissão, fora da soma`}
                            </th>
                            <td className="tabela__num">
                              <strong>{formatarReais(totalPerdido)}</strong>
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <Paginacao p={pagCanceladas} />
                </>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
