import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { TileKpi } from '@/components/graficos';
import { CabecalhoPainel } from '@/components/Painel';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { VoltarPara } from '@/components/VoltarPara';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import { financeiroApi, type LancamentoComissao, type ParcelaAReceber } from '@/lib/financeiro';
import { formatarCompetencia, formatarData, formatarNumero, formatarReais } from '@/lib/formato';

/**
 * Fila de comissões: recibos e parcelas linha a linha, em visões separadas (o recibo
 * não diz de qual cliente veio; a comissão da parcela é estimada). Taxa desconhecida
 * fica fora da soma, nunca como zero — as somas batem com a tela de Comissões.
 */

const MES_ATUAL = (() => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
})();

type Situacao = 'atraso' | 'aberto' | 'recebido';

const ehSituacao = (x: string | null): x is Situacao => x === 'atraso' || x === 'aberto' || x === 'recebido';
const redondo = (n: number): number => Math.round(n * 100) / 100;

export function FilaComissoesPage(): React.JSX.Element {
  const { abrir: abrirCliente } = useCliente();
  const [parametros] = useSearchParams();

  const [recebidos, setRecebidos] = useState<LancamentoComissao[] | null>(null);
  const [erroRecebidos, setErroRecebidos] = useState<string | null>(null);
  const [parcelas, setParcelas] = useState<ParcelaAReceber[] | null>(null);
  const [erroParcelas, setErroParcelas] = useState<string | null>(null);

  // Situação vazia = a que pede ação primeiro (em atraso, se houver).
  const veioPorLink = ['situacao', 'seguradora', 'mes', 'ano'].some((p) => parametros.has(p));
  const situacaoDaUrl = parametros.get('situacao');
  const [escolhida, setEscolhida] = useState<Situacao | ''>(ehSituacao(situacaoDaUrl) ? situacaoDaUrl : '');
  const [filtroSeguradora, setFiltroSeguradora] = useState(parametros.get('seguradora') ?? '');
  const [filtroMes, setFiltroMes] = useState(veioPorLink ? (parametros.get('mes') ?? '') : MES_ATUAL);
  const [filtroAno, setFiltroAno] = useState(
    veioPorLink ? (parametros.get('ano') ?? parametros.get('mes')?.slice(0, 4) ?? '') : MES_ATUAL.slice(0, 4),
  );

  useEffect(() => {
    document.title = 'Fila de comissões — MinhaCorretora';
  }, []);

  // Pedidos SEPARADOS: se o das parcelas falha, o recebido continua na tela.
  useEffect(() => {
    let cancelado = false;
    const ano = Number(MES_ATUAL.slice(0, 4));
    financeiroApi
      .comissoes({ de: `${ano - 4}-01`, ate: MES_ATUAL })
      .then((c) => !cancelado && setRecebidos(c.lancamentos))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setRecebidos([]);
        setErroRecebidos(
          falha instanceof ApiError ? falha.message : 'Não foi possível carregar os recebidos.',
        );
      });
    financeiroApi
      .parcelasAReceber(`${ano - 3}-01`, `${ano + 1}-12`)
      .then((p) => !cancelado && setParcelas(Array.isArray(p.parcelas) ? p.parcelas : []))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setParcelas([]);
        setErroParcelas(
          falha instanceof ApiError && falha.status === 404
            ? 'A lista de parcelas precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar as parcelas.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const noRecorte = (seguradora: string, mes: string): boolean =>
    (!filtroSeguradora || seguradora === filtroSeguradora) &&
    (!filtroAno || mes.startsWith(filtroAno)) &&
    (!filtroMes || mes === filtroMes);

  const recebidosDoRecorte = (recebidos ?? [])
    .filter((c) => noRecorte(c.seguradora, c.pagoEm?.slice(0, 7) ?? ''))
    .sort((a, b) => (b.pagoEm ?? '').localeCompare(a.pagoEm ?? ''));
  const parcelasDoRecorte = (parcelas ?? []).filter((p) => noRecorte(p.seguradora, p.mes));
  const atrasadas = parcelasDoRecorte.filter((p) => p.situacao === 'atraso');
  const aReceber = parcelasDoRecorte.filter((p) => p.situacao === 'aberto');

  const somaComissao = (lista: ParcelaAReceber[]): number =>
    redondo(lista.reduce((t, p) => t + (p.comissao ?? 0), 0));
  const semPercentual = (lista: ParcelaAReceber[]): number => lista.filter((p) => p.comissao === null).length;

  const situacao: Situacao =
    escolhida || (atrasadas.length > 0 ? 'atraso' : aReceber.length > 0 ? 'aberto' : 'recebido');
  const parcelasDaVisao = situacao === 'atraso' ? atrasadas : aReceber;

  // Hooks antes de qualquer retorno.
  const pagRecebidos = usePaginacao(recebidosDoRecorte, [filtroSeguradora, filtroAno, filtroMes, situacao]);
  const pagParcelas = usePaginacao(
    [...parcelasDaVisao].sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? '')),
    [filtroSeguradora, filtroAno, filtroMes, situacao],
  );

  const todasAsLinhas = [
    ...(recebidos ?? []).map((c) => c.pagoEm?.slice(0, 7) ?? ''),
    ...(parcelas ?? []).map((p) => p.mes),
  ];
  const seguradoras = [
    ...new Set([...(recebidos ?? []).map((c) => c.seguradora), ...(parcelas ?? []).map((p) => p.seguradora)]),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const anos = [
    ...new Set([MES_ATUAL.slice(0, 4), ...todasAsLinhas.map((m) => m.slice(0, 4)).filter(Boolean)]),
  ].sort((a, b) => b.localeCompare(a));
  const meses = [...new Set([MES_ATUAL, ...todasAsLinhas.filter(Boolean)])]
    .filter((m) => !filtroAno || m.startsWith(filtroAno))
    .sort((a, b) => b.localeCompare(a));

  const carregando = recebidos === null || parcelas === null;

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Fila de comissões"
        descricao="Cada recibo recebido e cada parcela que ainda vai gerar comissão."
      />

      <div className="fila__topo">
        <VoltarPara para="/dashboards/comissoes" rotulo="Voltar ao dashboard de Comissões" />
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

      {carregando ? (
        <p className="texto-discreto">Carregando…</p>
      ) : (
        <>
          {/* Os cartões SÃO a escolha da visão e somam o recorte dos filtros. */}
          <div className="tiles">
            <TileKpi
              rotulo="Em atraso"
              valor={formatarReais(somaComissao(atrasadas))}
              descricao={`${formatarNumero(atrasadas.length)} parcela(s) que o cliente não pagou`}
              menorEhMelhor
              ativo={situacao === 'atraso'}
              aoClicar={() => setEscolhida('atraso')}
            />
            <TileKpi
              rotulo="A receber"
              valor={formatarReais(somaComissao(aReceber))}
              descricao={
                semPercentual(aReceber) > 0
                  ? `${formatarNumero(aReceber.length)} parcela(s) · ${formatarNumero(semPercentual(aReceber))} sem % de comissão`
                  : `${formatarNumero(aReceber.length)} parcela(s) por vencer`
              }
              ativo={situacao === 'aberto'}
              aoClicar={() => setEscolhida('aberto')}
            />
            <TileKpi
              rotulo="Recebido"
              valor={formatarReais(redondo(recebidosDoRecorte.reduce((t, c) => t + c.totalLiquido, 0)))}
              descricao={`${formatarNumero(recebidosDoRecorte.length)} recibo(s), líquido`}
              ativo={situacao === 'recebido'}
              aoClicar={() => setEscolhida('recebido')}
            />
          </div>

          <section className="cartao cartao--largo fila-comissoes">
            {situacao === 'recebido' ? (
              <>
                {erroRecebidos && (
                  <p className="alerta alerta--erro" role="alert">
                    {erroRecebidos}
                  </p>
                )}
                <p className="texto-discreto">
                  Cada linha é um pagamento da seguradora à corretora. O demonstrativo não diz de qual cliente
                  veio o valor.
                </p>
                <div className="tabela-rolante">
                  <table className="tabela tabela--densa">
                    <thead>
                      <tr>
                        <th scope="col">Pago em</th>
                        <th scope="col">Seguradora</th>
                        <th scope="col">Recibo</th>
                        <th scope="col">Filial / tipo</th>
                        <th scope="col" className="tabela__num">
                          Bruto
                        </th>
                        <th scope="col" className="tabela__num">
                          Impostos
                        </th>
                        <th scope="col" className="tabela__num">
                          Líquido
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recebidosDoRecorte.length === 0 && (
                        <tr>
                          <td className="tabela__vazio" colSpan={7}>
                            Nenhum recibo com estes filtros.
                          </td>
                        </tr>
                      )}
                      {pagRecebidos.visiveis.map((c) => (
                        <tr key={`${c.competencia}-${c.filial ?? ''}-${c.numero}`}>
                          <td>
                            {c.pagoEm ? formatarData(c.pagoEm) : '—'}
                            {c.formaPagamento && (
                              <>
                                <br />
                                <small className="texto-discreto">{c.formaPagamento}</small>
                              </>
                            )}
                          </td>
                          <td>{c.seguradora}</td>
                          <td className="tabela__mono">{c.numero}</td>
                          <td className="texto-discreto">
                            {[c.tipoServico ?? c.filial, c.tipo].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td
                            className={
                              c.totalBruto < 0 ? 'tabela__num situacao--inadimplente' : 'tabela__num'
                            }
                          >
                            {formatarReais(c.totalBruto)}
                          </td>
                          <td className="tabela__num">{formatarReais(c.impostos)}</td>
                          <td className="tabela__num">{formatarReais(c.totalLiquido)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {recebidosDoRecorte.length > 0 && (
                      <tfoot>
                        <tr className="tabela__total">
                          <th scope="row" colSpan={4}>
                            Total recebido
                          </th>
                          <td className="tabela__num">
                            {formatarReais(redondo(recebidosDoRecorte.reduce((t, c) => t + c.totalBruto, 0)))}
                          </td>
                          <td className="tabela__num">
                            {formatarReais(redondo(recebidosDoRecorte.reduce((t, c) => t + c.impostos, 0)))}
                          </td>
                          <td className="tabela__num">
                            <strong>
                              {formatarReais(
                                redondo(recebidosDoRecorte.reduce((t, c) => t + c.totalLiquido, 0)),
                              )}
                            </strong>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <Paginacao p={pagRecebidos} />
              </>
            ) : (
              <>
                {erroParcelas && (
                  <p className="alerta alerta--erro" role="alert">
                    {erroParcelas}
                  </p>
                )}
                <p className="texto-discreto">
                  {situacao === 'atraso'
                    ? 'Parcelas vencidas e não pagas: a seguradora só paga a comissão depois que o cliente pagar. Clique para abrir o cliente e ligar.'
                    : 'Parcelas que ainda vão vencer. Comissão estimada: valor da parcela × % de comissão da apólice.'}
                </p>
                <div className="tabela-rolante">
                  <table className="tabela tabela--densa">
                    <thead>
                      <tr>
                        <th scope="col">Vence em</th>
                        <th scope="col">Cliente</th>
                        <th scope="col">Contato</th>
                        <th scope="col">Seguradora</th>
                        <th scope="col">Apólice</th>
                        <th scope="col" className="tabela__num">
                          Parcela
                        </th>
                        <th scope="col" className="tabela__num">
                          Comissão
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {parcelasDaVisao.length === 0 && (
                        <tr>
                          <td className="tabela__vazio" colSpan={7}>
                            {situacao === 'atraso'
                              ? 'Nenhuma parcela em atraso com estes filtros.'
                              : 'Nenhuma parcela a receber com estes filtros.'}
                          </td>
                        </tr>
                      )}
                      {pagParcelas.visiveis.map((p) => (
                        <tr
                          key={p.parcelaId}
                          className={p.clienteUuid ? 'tabela__linha--clicavel' : undefined}
                          onClick={p.clienteUuid ? () => abrirCliente(p.clienteUuid!) : undefined}
                          tabIndex={p.clienteUuid ? 0 : undefined}
                          onKeyDown={
                            p.clienteUuid
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    abrirCliente(p.clienteUuid!);
                                  }
                                }
                              : undefined
                          }
                        >
                          <td>
                            <span className={situacao === 'atraso' ? 'situacao--inadimplente' : undefined}>
                              {p.vencimento ? formatarData(p.vencimento) : '—'}
                            </span>
                          </td>
                          <td>
                            {p.cliente || <span className="texto-discreto">—</span>}
                            {p.corretor && (
                              <>
                                <br />
                                <small className="texto-discreto">{p.corretor}</small>
                              </>
                            )}
                          </td>
                          <td>
                            {p.telefone ?? p.email ?? (
                              <span className="situacao--inadimplente">sem contato</span>
                            )}
                          </td>
                          <td>{p.seguradora}</td>
                          <td className="tabela__mono">
                            {p.apolice}
                            <small className="texto-discreto"> · {p.numeroParcela}ª</small>
                          </td>
                          <td className="tabela__num">{formatarReais(p.valor)}</td>
                          <td className="tabela__num">
                            {p.comissao === null ? (
                              <span
                                className="texto-discreto"
                                title="A seguradora não informa o % de comissão: fica fora da soma"
                              >
                                sem %
                              </span>
                            ) : (
                              <span title={`${String(p.percentual ?? '').replace('.', ',')}% da parcela`}>
                                {formatarReais(p.comissao)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {parcelasDaVisao.length > 0 && (
                      <tfoot>
                        <tr className="tabela__total">
                          <th scope="row" colSpan={5}>
                            Total {situacao === 'atraso' ? 'em atraso' : 'a receber'} (comissão estimada)
                            {semPercentual(parcelasDaVisao) > 0 &&
                              ` · ${formatarNumero(semPercentual(parcelasDaVisao))} sem % fora da soma`}
                          </th>
                          <td className="tabela__num">
                            {formatarReais(redondo(parcelasDaVisao.reduce((t, p) => t + p.valor, 0)))}
                          </td>
                          <td className="tabela__num">
                            <strong>{formatarReais(somaComissao(parcelasDaVisao))}</strong>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <Paginacao p={pagParcelas} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
