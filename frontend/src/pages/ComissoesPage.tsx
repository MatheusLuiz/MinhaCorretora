import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { GraficoColunas, GraficoRosca, maioresEOutras } from '@/components/graficos';
import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';
import { CabecalhoPainel } from '@/components/Painel';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import {
  financeiroApi,
  type ComissaoDoPeriodo,
  type LancamentoComissao,
  type ParcelaAReceber,
  type ResumoFinanceiro,
} from '@/lib/financeiro';
import { formatarCompetencia, formatarData, formatarNumero, formatarReais } from '@/lib/formato';

/** Séries separadas: atraso é culpa do cliente; a receber ainda não venceu. */
const SERIES_PENDENTES = [
  { situacao: 'aberto', nome: 'A receber (estimado)' },
  { situacao: 'atraso', nome: 'Em atraso (estimado)' },
] as const;

const MES_ATUAL = (() => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
})();

export function ComissoesPage(): React.JSX.Element {
  /** Um pagamento aberto por vez: o detalhe ocupa a linha inteira. */
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const [pendenteAberto, setPendenteAberto] = useState<{
    mes: string;
    seguradora: string;
    situacao: 'aberto' | 'atraso';
  } | null>(null);
  const [parcelasDoGrupo, setParcelasDoGrupo] = useState<ParcelaAReceber[] | null>(null);
  const { abrir: abrirCliente } = useCliente();
  // Os filtros da tabela SÃO a escolha de período; vazio = todos.
  const [filtroSeguradora, setFiltroSeguradora] = useState('');
  const [filtroMes, setFiltroMes] = useState(MES_ATUAL);
  const [filtroAno, setFiltroAno] = useState(MES_ATUAL.slice(0, 4));
  const [filtroSituacao, setFiltroSituacao] = useState<'' | 'recebido' | 'aberto' | 'atraso'>('');
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [comissoes, setComissoes] = useState<LancamentoComissao[]>([]);
  /** ESTIMATIVA (ver `repo.comissaoNoPeriodo`). Nulo enquanto carrega ou se falhar. */
  const [pendencias, setPendencias] = useState<ComissaoDoPeriodo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    document.title = 'Comissões — MinhaCorretora';
  }, []);

  // Classe no <body> em vez de `:has()` no CSS: o Firefox anterior ao 121 ignora `:has()`.
  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  useEffect(() => {
    if (!grupoAberto && !pendenteAberto) return;
    const aoTeclar = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setGrupoAberto(null);
      setPendenteAberto(null);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [grupoAberto, pendenteAberto]);

  // O mesmo conjunto que a linha agregada soma: o total da gaveta tem de bater.
  useEffect(() => {
    if (!pendenteAberto) return;
    let cancelado = false;
    setParcelasDoGrupo(null);
    void financeiroApi
      .parcelasAReceber(pendenteAberto.mes, pendenteAberto.mes)
      .then((r) => {
        if (cancelado) return;
        setParcelasDoGrupo(
          (Array.isArray(r.parcelas) ? r.parcelas : []).filter(
            (p) => p.seguradora === pendenteAberto.seguradora && p.situacao === pendenteAberto.situacao,
          ),
        );
      })
      .catch(() => {
        if (!cancelado) setParcelasDoGrupo([]);
      });
    return () => {
      cancelado = true;
    };
  }, [pendenteAberto]);

  useEffect(() => {
    let cancelado = false;

    void financeiroApi
      .resumo()
      .then((r) => {
        if (!cancelado) setResumo(r);
      })
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar as comissões.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, []);

  // 60 meses é o teto da API por pedido. Falha aqui não derruba a página.
  useEffect(() => {
    let cancelado = false;
    const ano = Number(MES_ATUAL.slice(0, 4));
    void financeiroApi
      .comissoes({ de: `${ano - 4}-01`, ate: MES_ATUAL })
      .then((c) => {
        if (!cancelado) setComissoes(c.lancamentos);
      })
      .catch(() => {
        if (!cancelado) setComissoes([]);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Falha aqui não derruba a página: a tabela mostra só o recebido.
  useEffect(() => {
    let cancelado = false;
    const ano = Number(MES_ATUAL.slice(0, 4));
    void financeiroApi
      .comissaoPeriodo(`${ano - 3}-01`, `${ano + 1}-12`)
      .then((d) => {
        if (!cancelado) setPendencias(d);
      })
      .catch(() => {
        if (!cancelado) setPendencias(null);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (carregando) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Comissões" />
        <p className="texto-discreto">Carregando…</p>
      </div>
    );
  }

  if (erro || !resumo) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Comissões" />
        <p className="alerta alerta--erro" role="alert">
          {erro ?? 'Painel indisponível.'}
        </p>
      </div>
    );
  }

  // Sem recorte por carteira: o pagamento da seguradora não diz de qual apólice veio,
  // e ratear seria inventar número.
  if (!resumo.recorte.comissoesTodas) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Comissões" />
        <p className="texto-discreto">
          A comissão da corretora não aparece para o seu perfil: o pagamento da seguradora não diz de qual
          apólice veio, então não há como separar a parte de cada corretor.
        </p>
      </div>
    );
  }

  const todasPendencias = Array.isArray(pendencias?.pendente) ? pendencias!.pendente : [];
  const mesesComMovimento = [
    ...comissoes.flatMap((c) => (c.pagoEm ? [c.pagoEm.slice(0, 7)] : [])),
    ...todasPendencias.map((p) => p.mes),
  ];
  const seguradorasDosPagamentos = [
    ...new Set([...comissoes.map((c) => c.seguradora), ...todasPendencias.map((p) => p.seguradora)]),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const anosDosPagamentos = [
    ...new Set([MES_ATUAL.slice(0, 4), ...mesesComMovimento.map((m) => m.slice(0, 4))]),
  ].sort((a, b) => b.localeCompare(a));
  const mesesDosPagamentos = [
    ...new Set([MES_ATUAL, ...mesesComMovimento].filter((m) => !filtroAno || m.startsWith(filtroAno))),
  ].sort((a, b) => b.localeCompare(a));
  const passaNosFiltros = (seguradora: string, mes: string | undefined): boolean =>
    (!filtroSeguradora || seguradora === filtroSeguradora) &&
    (!filtroAno || Boolean(mes?.startsWith(filtroAno))) &&
    (!filtroMes || mes === filtroMes);
  const pendenciaPassa = (situacao: 'aberto' | 'atraso'): boolean =>
    !filtroSituacao || filtroSituacao === situacao;
  const pendentes = todasPendencias.filter(
    (p) => p.comissao > 0 && pendenciaPassa(p.situacao) && passaNosFiltros(p.seguradora, p.mes),
  );
  const semPercentual = todasPendencias.filter(
    (p) => p.semTaxaParcelas > 0 && pendenciaPassa(p.situacao) && passaNosFiltros(p.seguradora, p.mes),
  );
  // Parcela sem percentual (Bradesco) fica FORA do a receber — nunca somada como zero.
  const avisoSemPercentual =
    semPercentual.length === 0
      ? ''
      : ` Fora do a receber: ${formatarReais(
          Math.round(semPercentual.reduce((t, p) => t + p.semTaxaPremio, 0) * 100) / 100,
        )} de prêmio em ${formatarNumero(semPercentual.reduce((t, p) => t + p.semTaxaParcelas, 0))} parcela(s) (${[
          ...new Set(semPercentual.map((p) => p.seguradora)),
        ].join(', ')}), porque a seguradora não informa o percentual de comissão.`;
  const somaPendente = (situacao: 'aberto' | 'atraso'): number =>
    Math.round(pendentes.filter((p) => p.situacao === situacao).reduce((t, p) => t + p.comissao, 0) * 100) /
    100;

  const recebidosDoPeriodo = comissoes.filter((c) => passaNosFiltros(c.seguradora, c.pagoEm?.slice(0, 7)));
  const pagamentos = !filtroSituacao || filtroSituacao === 'recebido' ? recebidosDoPeriodo : [];

  // A SITUAÇÃO não entra nos cartões: são do recebido, e "A receber" os zeraria.
  const semFiltro = !filtroSeguradora && !filtroAno && !filtroMes;
  const doRecorte = semFiltro ? comissoes.filter((c) => c.pagoEm?.startsWith(MES_ATUAL)) : recebidosDoPeriodo;
  const ehMesVigente = semFiltro || (!filtroSeguradora && filtroMes === MES_ATUAL);
  const rotuloDoRecorte = ehMesVigente
    ? ''
    : [filtroSeguradora, filtroMes ? formatarCompetencia(filtroMes) : filtroAno || 'todo o período']
        .filter(Boolean)
        .join(' · ');
  // A paleta tem 8 cores: o resto vira "Outras (N)".
  const porSeguradoraNoRecorte = maioresEOutras(
    [...new Set(doRecorte.map((c) => c.seguradora))].map((nome) => ({
      rotulo: nome,
      valor:
        Math.round(
          doRecorte.filter((c) => c.seguradora === nome).reduce((t, c) => t + c.totalLiquido, 0) * 100,
        ) / 100,
    })),
  );
  const porTipoNoRecorte = porTipoDeServico(
    doRecorte.map((c) => ({
      rotulo: c.tipoServico ?? c.filial ?? '',
      valor: c.totalLiquido,
    })),
  );
  const mesesDoGrafico = [
    ...new Set([
      ...pagamentos.flatMap((c) => (c.pagoEm ? [c.pagoEm.slice(0, 7)] : [])),
      ...pendentes.map((p) => p.mes),
    ]),
  ].sort();
  const seguradorasDoGrafico = [
    ...new Set([...pagamentos.map((c) => c.seguradora), ...pendentes.map((p) => p.seguradora)]),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const chaveDoGrupo = (c: LancamentoComissao): string => `${c.pagoEm?.slice(0, 7) ?? ''}|${c.seguradora}`;
  const gruposRecebidos = [...new Set(pagamentos.map(chaveDoGrupo))]
    .map((chave) => {
      const [mes = '', seguradora = ''] = chave.split('|');
      return {
        chave,
        mes,
        seguradora,
        itens: pagamentos.filter((c) => chaveDoGrupo(c) === chave),
      };
    })
    .sort((a, b) => b.mes.localeCompare(a.mes) || a.seguradora.localeCompare(b.seguradora, 'pt-BR'));
  const grupo = gruposRecebidos.find((g) => g.chave === grupoAberto) ?? null;
  const somaCampo = (
    lista: LancamentoComissao[],
    campo: 'totalBruto' | 'impostos' | 'desconto' | 'totalLiquido',
  ): number => Math.round(lista.reduce((t, c) => t + c[campo], 0) * 100) / 100;
  const somaDePendentes = (lista: { comissao: number }[]): number =>
    Math.round(lista.reduce((t, p) => t + p.comissao, 0) * 100) / 100;
  const somaDe = (lista: LancamentoComissao[]): number =>
    Math.round(lista.reduce((t, c) => t + c.totalLiquido, 0) * 100) / 100;
  const somaPagamentos = (campo: 'totalBruto' | 'impostos' | 'totalLiquido'): number =>
    Math.round(pagamentos.reduce((t, c) => t + c[campo], 0) * 100) / 100;

  return (
    <div className="painel comissoes">
      <CabecalhoPainel
        titulo="Comissões"
        descricao="Quanto a seguradora pagou, quanto está para entrar e de quais clientes vem."
      />

      <div className="comissoes__topo">
        <section className="cartao cartao--esticado cartao--compacto">
          <header className="cartao__cabecalho">
            <h2 title="O que as seguradoras pagaram, líquido — pelos filtros dos pagamentos, ou o mês atual">
              Comissão recebida{rotuloDoRecorte && ` · ${rotuloDoRecorte}`}
            </h2>
          </header>
          <div className="cartao__corpo comissao-recebida">
            <strong className="comissao-recebida__valor">{formatarReais(somaDe(doRecorte))}</strong>
            <span className="texto-discreto">{formatarNumero(doRecorte.length)} pagamento(s)</span>
          </div>
        </section>

        <section className="cartao cartao--esticado cartao--compacto">
          <header className="cartao__cabecalho">
            <h2 title="O recebido por seguradora — pelos filtros dos pagamentos, ou o mês atual">
              Comissão por seguradora{rotuloDoRecorte && ` · ${rotuloDoRecorte}`}
            </h2>
          </header>
          <div className="cartao__corpo">
            {porSeguradoraNoRecorte.length === 0 ? (
              <p className="texto-discreto comissao-recebida">Nenhum pagamento no período.</p>
            ) : (
              <GraficoRosca dados={porSeguradoraNoRecorte} tamanho={76} />
            )}
          </div>
        </section>

        <section className="cartao cartao--esticado cartao--compacto">
          <header className="cartao__cabecalho">
            <h2 title="O recebido pelo tipo de serviço que o demonstrativo informa — pelos filtros dos pagamentos, ou o mês atual">
              Comissão por tipo de serviço{rotuloDoRecorte && ` · ${rotuloDoRecorte}`}
            </h2>
          </header>
          <div className="cartao__corpo">
            {porTipoNoRecorte.length === 0 ? (
              <p className="texto-discreto comissao-recebida">Nenhum pagamento no período.</p>
            ) : (
              <GraficoRosca dados={porTipoNoRecorte} tamanho={76} />
            )}
          </div>
        </section>
      </div>

      <section className="cartao cartao--largo">
        <div className="pagamentos">
          <div className="pagamentos__grafico">
            <h2
              title={
                'Recebido: o que a seguradora pagou, pela data do pagamento. ' +
                'A receber: comissão estimada das parcelas que os clientes ainda não pagaram, pelo vencimento. ' +
                'O relatório não diz de qual apólice ou cliente veio cada pagamento.' +
                avisoSemPercentual
              }
            >
              Pagamentos recebidos e a receber
            </h2>
            <AreaDoGrafico>
              {(altura) =>
                (pagamentos.length > 0 || pendentes.length > 0) &&
                (mesesDoGrafico.length > 1 ? (
                  <GraficoColunas
                    series={[
                      ...seguradorasDoGrafico
                        .filter((nome) => pagamentos.some((c) => c.seguradora === nome))
                        .map((nome) => ({
                          nome: `Recebido · ${nome}`,
                          pontos: mesesDoGrafico.map((m) => ({
                            periodo: formatarCompetencia(m),
                            valor: somaDe(
                              pagamentos.filter((c) => c.seguradora === nome && c.pagoEm?.startsWith(m)),
                            ),
                          })),
                        })),
                      ...SERIES_PENDENTES.filter((s) => pendentes.some((p) => p.situacao === s.situacao)).map(
                        (s) => ({
                          nome: s.nome,
                          pontos: mesesDoGrafico.map((m) => ({
                            periodo: formatarCompetencia(m),
                            valor: somaDePendentes(
                              pendentes.filter((p) => p.situacao === s.situacao && p.mes === m),
                            ),
                          })),
                        }),
                      ),
                    ]}
                    formatar={formatarReais}
                    empilhado
                    altura={altura}
                  />
                ) : (
                  <GraficoColunas
                    series={[
                      ...(pagamentos.length > 0
                        ? [
                            {
                              nome: 'Recebido',
                              pontos: seguradorasDoGrafico.map((nome) => ({
                                periodo: nome,
                                valor: somaDe(pagamentos.filter((c) => c.seguradora === nome)),
                              })),
                            },
                          ]
                        : []),
                      ...SERIES_PENDENTES.filter((s) => pendentes.some((p) => p.situacao === s.situacao)).map(
                        (s) => ({
                          nome: s.nome,
                          pontos: seguradorasDoGrafico.map((nome) => ({
                            periodo: nome,
                            valor: somaDePendentes(
                              pendentes.filter((p) => p.situacao === s.situacao && p.seguradora === nome),
                            ),
                          })),
                        }),
                      ),
                    ]}
                    formatar={formatarReais}
                    altura={altura}
                  />
                ))
              }
            </AreaDoGrafico>
          </div>
          <div className="pagamentos__lista">
            <div className="filtros-pagamentos">
              <label>
                <span>Seguradora</span>
                <select value={filtroSeguradora} onChange={(e) => setFiltroSeguradora(e.target.value)}>
                  <option value="">Todas</option>
                  {seguradorasDosPagamentos.map((nome) => (
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
                  {anosDosPagamentos.map((a) => (
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
                  {mesesDosPagamentos.map((m) => (
                    <option key={m} value={m}>
                      {formatarCompetencia(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Situação</span>
                <select
                  value={filtroSituacao}
                  onChange={(e) => setFiltroSituacao(e.target.value as typeof filtroSituacao)}
                >
                  <option value="">Todas</option>
                  <option value="recebido">Recebido</option>
                  <option value="aberto">A receber</option>
                  <option value="atraso">Em atraso</option>
                </select>
              </label>
              {(filtroSeguradora || filtroAno || filtroMes || filtroSituacao) && (
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() => {
                    setFiltroSeguradora('');
                    setFiltroAno('');
                    setFiltroMes('');
                    setFiltroSituacao('');
                  }}
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="tabela-rolante pagamentos__tabela">
              <table className="tabela tabela--densa tabela--clicavel">
                <thead>
                  <tr>
                    <th scope="col">Mês</th>
                    <th scope="col">Seguradora</th>
                    <th scope="col">Situação</th>
                    <th
                      scope="col"
                      className="tabela__num"
                      title="Pagamentos recebidos ou parcelas pendentes"
                    >
                      Qtd.
                    </th>
                    <th
                      scope="col"
                      className="tabela__num"
                      title="Recebido: líquido pago. A receber e em atraso: comissão estimada (parcela × comissão da apólice)."
                    >
                      Líquido
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagamentos.length === 0 && pendentes.length === 0 && (
                    <tr>
                      <td className="tabela__vazio" colSpan={5}>
                        {comissoes.length === 0
                          ? 'Nenhum pagamento de comissão no período.'
                          : filtroSituacao === 'recebido'
                            ? 'Nada recebido com estes filtros.'
                            : filtroSituacao === 'aberto'
                              ? 'Nada a receber com estes filtros.'
                              : filtroSituacao === 'atraso'
                                ? 'Nenhuma comissão presa em atraso de cliente com estes filtros.'
                                : 'Nada recebido nem a receber com estes filtros.'}
                      </td>
                    </tr>
                  )}
                  {/* Sem corretor: o demonstrativo vem agregado, sem apólice nem cliente. */}
                  {gruposRecebidos.map((g) => {
                    const liquido = somaCampo(g.itens, 'totalLiquido');
                    return (
                      <tr
                        key={g.chave}
                        onClick={() => setGrupoAberto(g.chave)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setGrupoAberto(g.chave);
                          }
                        }}
                        title="Ver os pagamentos deste mês, com bruto e impostos"
                      >
                        <td>{g.mes ? formatarCompetencia(g.mes) : '—'}</td>
                        <td>{g.seguradora}</td>
                        <td>
                          <span className="etiqueta etiqueta--ok">Recebido</span>
                        </td>
                        <td className="tabela__num">{formatarNumero(g.itens.length)}</td>
                        <td className={liquido < 0 ? 'tabela__num situacao--inadimplente' : 'tabela__num'}>
                          {formatarReais(liquido)}
                        </td>
                      </tr>
                    );
                  })}
                  {[...pendentes]
                    .sort(
                      (a, b) =>
                        a.mes.localeCompare(b.mes) || a.seguradora.localeCompare(b.seguradora, 'pt-BR'),
                    )
                    .map((p) => (
                      <tr
                        key={`pendente-${p.mes}-${p.seguradora}-${p.situacao}`}
                        onClick={() =>
                          setPendenteAberto({ mes: p.mes, seguradora: p.seguradora, situacao: p.situacao })
                        }
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setPendenteAberto({ mes: p.mes, seguradora: p.seguradora, situacao: p.situacao });
                          }
                        }}
                        title="Ver as parcelas deste mês"
                      >
                        <td title="Mês de vencimento da parcela">{formatarCompetencia(p.mes)}</td>
                        <td>{p.seguradora}</td>
                        <td>
                          {p.situacao === 'atraso' ? (
                            <span
                              className="etiqueta etiqueta--critico"
                              title="O cliente não pagou a parcela; a seguradora só paga a comissão depois"
                            >
                              Em atraso
                            </span>
                          ) : (
                            <span className="etiqueta etiqueta--atencao" title="Parcela ainda vai vencer">
                              A receber
                            </span>
                          )}
                        </td>
                        <td className="tabela__num" title="Parcelas pendentes">
                          {formatarNumero(p.parcelas - p.semTaxaParcelas)}
                        </td>
                        <td className="tabela__num" title="Comissão estimada: parcela × comissão da apólice">
                          {formatarReais(p.comissao)}
                        </td>
                      </tr>
                    ))}
                  <tr className="tabela__respiro" aria-hidden="true">
                    <td colSpan={5} />
                  </tr>
                </tbody>
                {(pagamentos.length > 0 || pendentes.length > 0) && (
                  <tfoot>
                    {pagamentos.length > 0 && (
                      <tr className="tabela__total">
                        <th scope="row" colSpan={4}>
                          Recebido
                        </th>
                        <td className="tabela__num">
                          <strong>{formatarReais(somaPagamentos('totalLiquido'))}</strong>
                        </td>
                      </tr>
                    )}
                    {somaPendente('aberto') > 0 && (
                      <tr className="tabela__total">
                        <th scope="row" colSpan={4}>
                          A receber (estimado)
                        </th>
                        <td className="tabela__num">{formatarReais(somaPendente('aberto'))}</td>
                      </tr>
                    )}
                    {somaPendente('atraso') > 0 && (
                      <tr className="tabela__total">
                        <th scope="row" colSpan={4}>
                          Em atraso (estimado)
                        </th>
                        <td className="tabela__num">{formatarReais(somaPendente('atraso'))}</td>
                      </tr>
                    )}
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

      </section>
      {pendenteAberto && (
        <>
          <div className="detalhe__fundo" onClick={() => setPendenteAberto(null)} aria-hidden="true" />
          <aside
            className="detalhe"
            role="dialog"
            aria-modal="true"
            aria-label={`Parcelas ${pendenteAberto.seguradora} ${formatarCompetencia(pendenteAberto.mes)}`}
          >
            <header className="detalhe__topo">
              <div>
                <h3>
                  {pendenteAberto.seguradora} · {formatarCompetencia(pendenteAberto.mes)} ·{' '}
                  {pendenteAberto.situacao === 'atraso' ? 'Em atraso' : 'A receber'}
                </h3>
                <p className="texto-discreto">
                  {parcelasDoGrupo === null
                    ? 'Carregando…'
                    : `${formatarNumero(parcelasDoGrupo.length)} parcela(s) · ${formatarReais(
                        Math.round(
                          parcelasDoGrupo.reduce((t, p) => t + (p.comissao ?? 0), 0) * 100,
                        ) / 100,
                      )} de comissão estimada. Clique numa linha para abrir o cliente.`}
                </p>
              </div>
              <div className="detalhe__acoes">
                <Link
                  className="botao botao--principal botao--compacto"
                  to={linkDaFila(pendenteAberto.situacao, pendenteAberto.seguradora, pendenteAberto.mes)}
                >
                  Abrir na fila
                </Link>
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() => setPendenteAberto(null)}
                >
                  Fechar
                </button>
              </div>
            </header>

            {parcelasDoGrupo !== null && (
              <div className="tabela-rolante">
                <table className="tabela tabela--densa">
                  <thead>
                    <tr>
                      <th scope="col">Vence em</th>
                      <th scope="col">Cliente</th>
                      <th scope="col">Contato</th>
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
                    {parcelasDoGrupo.map((p) => (
                      <tr
                        key={p.parcelaId}
                        className={p.clienteUuid ? 'tabela__linha--clicavel' : undefined}
                        onClick={p.clienteUuid ? () => abrirCliente(p.clienteUuid!) : undefined}
                      >
                        <td>{p.vencimento ? formatarData(p.vencimento) : '—'}</td>
                        <td>{p.cliente || '—'}</td>
                        <td>
                          {p.telefone ?? p.email ?? <span className="situacao--inadimplente">sem contato</span>}
                        </td>
                        <td className="tabela__mono">
                          {p.apolice}
                          <small className="texto-discreto"> · {p.numeroParcela}ª</small>
                        </td>
                        <td className="tabela__num">{formatarReais(p.valor)}</td>
                        <td className="tabela__num">
                          {p.comissao === null ? (
                            <span className="texto-discreto" title="A seguradora não informa o % de comissão">
                              sem %
                            </span>
                          ) : (
                            formatarReais(p.comissao)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </aside>
        </>
      )}
      {grupo && (
        <>
          <div className="detalhe__fundo" onClick={() => setGrupoAberto(null)} aria-hidden="true" />
          <aside
            className="detalhe"
            role="dialog"
            aria-modal="true"
            aria-label={`Pagamentos ${grupo.seguradora} ${formatarCompetencia(grupo.mes)}`}
          >
            <header className="detalhe__topo">
              <div>
                <h3>
                  {grupo.seguradora} · {formatarCompetencia(grupo.mes)}
                </h3>
                <p className="texto-discreto">
                  {formatarNumero(grupo.itens.length)} pagamento(s) ·{' '}
                  {formatarReais(somaCampo(grupo.itens, 'totalLiquido'))} líquido. Cliente e apólice não
                  constam no relatório: o valor é identificado pelo recibo.
                </p>
              </div>
              <div className="detalhe__acoes">
                <Link
                  className="botao botao--principal botao--compacto"
                  to={linkDaFila('recebido', grupo.seguradora, grupo.mes)}
                >
                  Abrir na fila
                </Link>
                <button
                  type="button"
                  className="botao botao--discreto botao--compacto"
                  onClick={() => setGrupoAberto(null)}
                >
                  Fechar
                </button>
              </div>
            </header>

            <div className="tabela-rolante">
              <table className="tabela tabela--densa">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
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
                  {grupo.itens.map((c) => (
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
                      <td className="tabela__mono">{c.numero}</td>
                      <td className="texto-discreto">
                        {[c.filial, c.tipo].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className={c.totalBruto < 0 ? 'tabela__num situacao--inadimplente' : 'tabela__num'}>
                        {formatarReais(c.totalBruto)}
                        {c.desconto !== 0 && (
                          <>
                            <br />
                            <small className="texto-discreto">desconto {formatarReais(c.desconto)}</small>
                          </>
                        )}
                      </td>
                      <td className="tabela__num">{formatarReais(c.impostos)}</td>
                      <td className="tabela__num">{formatarReais(c.totalLiquido)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="tabela__total">
                    <th scope="row" colSpan={3}>
                      Total
                    </th>
                    <td className="tabela__num">{formatarReais(somaCampo(grupo.itens, 'totalBruto'))}</td>
                    <td className="tabela__num">{formatarReais(somaCampo(grupo.itens, 'impostos'))}</td>
                    <td className="tabela__num">
                      <strong>{formatarReais(somaCampo(grupo.itens, 'totalLiquido'))}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function linkDaFila(situacao: 'recebido' | 'aberto' | 'atraso', seguradora: string, mes: string): string {
  const busca = new URLSearchParams({ situacao, seguradora, mes });
  return `/filas/comissoes?${busca.toString()}`;
}

function nomeDoTipoDeServico(rotulo: string): string {
  const t = rotulo.trim();
  if (!t || t === '—') return 'Sem tipo informado';
  if (/auto\s*re|^auto$/i.test(t)) return 'Auto e RE';
  if (/vida|previd/i.test(t)) return 'Vida e Previdência';
  if (/sa[uú]de/i.test(t)) return 'Saúde';
  return t;
}

/** Fatias da rosca: rótulos que viram o mesmo nome somam numa fatia só — a chave é o rótulo. */
function porTipoDeServico(lista: { rotulo: string; valor: number }[]): { rotulo: string; valor: number }[] {
  const somas = new Map<string, number>();
  for (const f of lista) {
    const nome = nomeDoTipoDeServico(f.rotulo);
    somas.set(nome, Math.round(((somas.get(nome) ?? 0) + f.valor) * 100) / 100);
  }
  return [...somas].map(([rotulo, valor]) => ({ rotulo, valor })).sort((a, b) => b.valor - a.valor);
}
