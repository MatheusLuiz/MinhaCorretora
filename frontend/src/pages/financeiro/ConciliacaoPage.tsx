import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { TileKpi } from '@/components/graficos';
import { CabecalhoPainel } from '@/components/Painel';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { ApiError } from '@/lib/api';
import {
  conciliacaoApi,
  type CelulaConciliacao,
  type Conciliacao,
  type LinhaOrdem,
  type Retencoes,
  type SituacaoCelula,
  type SituacaoOrdem,
} from '@/lib/conciliacao';
import { formatarCompetencia, formatarData, formatarNumero, formatarReais } from '@/lib/formato';

import '@/styles/conciliacao.css';

/** Conciliação: o líquido recebido por mês × seguradora, conferido contra o extrato. */

type Aba = 'conciliacao' | 'retencoes';

const MES_ATUAL = (() => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
})();

/** Cinco anos: o teto da API (60 meses). */
const PERIODO = { de: `${Number(MES_ATUAL.slice(0, 4)) - 4}-01`, ate: MES_ATUAL };

const SITUACOES: { chave: SituacaoCelula; rotulo: string; descricao: string }[] = [
  { chave: 'conferido', rotulo: 'Conferido', descricao: 'extrato e recibos batem ao centavo' },
  { chave: 'divergente', rotulo: 'Divergente', descricao: 'ordem faltando, sobrando ou com valor diferente' },
  { chave: 'sem_extrato', rotulo: 'Sem extrato', descricao: 'há recibo, falta o extrato para comparar' },
  { chave: 'sem_recebimento', rotulo: 'Mês sem recebimento', descricao: 'buraco entre meses que tiveram recibo' },
];

const ROTULO_SITUACAO: Record<SituacaoCelula, string> = {
  conferido: 'Conferido',
  divergente: 'Divergente',
  sem_extrato: 'Sem extrato',
  sem_recebimento: 'Sem recebimento',
};

const ROTULO_ORDEM: Record<SituacaoOrdem, string> = {
  conferida: 'Conferida',
  faltando: 'Falta o recibo',
  sobrando: 'Fora do extrato',
  divergente: 'Valor diferente',
  sem_extrato: 'Sem extrato',
};

const centavos = (n: number): number => Math.round(n * 100) / 100;

export function ConciliacaoPage(): React.JSX.Element {
  const [aba, setAba] = useState<Aba>('conciliacao');
  const [dados, setDados] = useState<Conciliacao | null>(null);
  const [retencoes, setRetencoes] = useState<Retencoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semPermissao, setSemPermissao] = useState(false);

  const [filtroSeguradora, setFiltroSeguradora] = useState('');
  const [filtroAno, setFiltroAno] = useState(MES_ATUAL.slice(0, 4));
  /** Cartão de situação ativo; nulo = todas. */
  const [filtroSituacao, setFiltroSituacao] = useState<SituacaoCelula | null>(null);

  const [aberta, setAberta] = useState<CelulaConciliacao | null>(null);
  const [ordens, setOrdens] = useState<LinhaOrdem[] | null>(null);
  const [erroOrdens, setErroOrdens] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    document.title = 'Conciliação — MinhaCorretora';
    let ativo = true;
    Promise.all([
      conciliacaoApi.grade(PERIODO.de, PERIODO.ate),
      conciliacaoApi.retencoes(PERIODO.de, PERIODO.ate),
    ])
      .then(([g, r]) => {
        if (!ativo) return;
        setDados(g);
        setRetencoes(r);
      })
      .catch((e: unknown) => {
        if (!ativo) return;
        if (e instanceof ApiError && e.status === 403) setSemPermissao(true);
        else setErro(e instanceof Error ? e.message : 'Não foi possível carregar a conciliação.');
      });
    return () => {
      ativo = false;
    };
  }, []);

  // Fechar e abrir outra descarta a resposta velha.
  useEffect(() => {
    if (!aberta) return;
    let ativo = true;
    setOrdens(null);
    setErroOrdens(null);
    conciliacaoApi
      .ordens(aberta.seguradoraId, aberta.mes)
      .then((r) => ativo && setOrdens(r.linhas))
      .catch((e: unknown) => ativo && setErroOrdens(e instanceof Error ? e.message : 'Falhou ao buscar as ordens.'));
    return () => {
      ativo = false;
    };
  }, [aberta]);

  const celulas = useMemo(() => (Array.isArray(dados?.celulas) ? dados.celulas : []), [dados]);

  const anos = useMemo(
    () => [...new Set((dados?.meses ?? []).map((m) => m.slice(0, 4)))].sort().reverse(),
    [dados],
  );

  const colunas = useMemo(
    () => (dados?.seguradoras ?? []).filter((s) => !filtroSeguradora || s.nome === filtroSeguradora),
    [dados, filtroSeguradora],
  );

  // Os cartões contam no recorte, não no histórico todo: clicar num "3" tem de mostrar três células.
  const noRecorte = useMemo(
    () =>
      celulas.filter(
        (c) => (!filtroSeguradora || c.seguradora === filtroSeguradora) && (!filtroAno || c.mes.startsWith(filtroAno)),
      ),
    [celulas, filtroSeguradora, filtroAno],
  );

  const celulaDe = useMemo(() => {
    const mapa = new Map<string, CelulaConciliacao>();
    for (const c of noRecorte) mapa.set(`${c.mes}|${c.seguradoraId}`, c);
    return mapa;
  }, [noRecorte]);

  const meses = useMemo(
    () =>
      [...new Set(noRecorte.filter((c) => !filtroSituacao || c.situacao === filtroSituacao).map((c) => c.mes))]
        .sort()
        .reverse(),
    [noRecorte, filtroSituacao],
  );

  const pagina = usePaginacao(meses, [filtroSeguradora, filtroAno, filtroSituacao], 12);

  const retencoesDoRecorte = useMemo(
    () =>
      (retencoes?.linhas ?? []).filter(
        (l) => (!filtroSeguradora || l.seguradora === filtroSeguradora) && (!filtroAno || l.mes.startsWith(filtroAno)),
      ),
    [retencoes, filtroSeguradora, filtroAno],
  );
  const paginaRet = usePaginacao(retencoesDoRecorte, [filtroSeguradora, filtroAno], 12);

  if (semPermissao) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Conciliação" />
        <p className="texto-discreto">
          A conciliação mostra a comissão da corretora inteira, e o seu perfil não inclui a comissão de todas as
          carteiras (permissão <code>comissoes.todas</code>).
        </p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Conciliação" />
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      </div>
    );
  }

  if (!dados || !retencoes) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Conciliação" />
        <p className="texto-discreto">Carregando…</p>
      </div>
    );
  }

  const contagem = (s: SituacaoCelula): number => noRecorte.filter((c) => c.situacao === s).length;
  const somaRet = (campo: 'bruto' | 'desconto' | 'impostos' | 'liquido'): number =>
    centavos(retencoesDoRecorte.reduce((t, l) => t + l[campo], 0));
  const somaRetOpcional = (campo: 'inss' | 'irrf' | 'iss'): number | null =>
    retencoesDoRecorte.some((l) => l[campo] !== null)
      ? centavos(retencoesDoRecorte.reduce((t, l) => t + (l[campo] ?? 0), 0))
      : null;

  const exportar = async (): Promise<void> => {
    setBaixando(true);
    try {
      await conciliacaoApi.baixarRetencoes(
        filtroAno ? `${filtroAno}-01` : PERIODO.de,
        filtroAno ? (filtroAno === MES_ATUAL.slice(0, 4) ? MES_ATUAL : `${filtroAno}-12`) : PERIODO.ate,
      );
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível gerar a planilha.');
    } finally {
      setBaixando(false);
    }
  };

  const linkDaFila = (c: CelulaConciliacao): string =>
    `/filas/comissoes?situacao=recebido&seguradora=${encodeURIComponent(c.seguradora)}&mes=${c.mes}`;

  return (
    <div className="painel conciliacao">
      <CabecalhoPainel
        titulo="Conciliação"
        descricao="A seguradora pagou tudo o que devia? Recibos importados contra o extrato da companhia, mês a mês."
      />

      <div className="conciliacao__barra">
        <nav className="abas" aria-label="Seções da conciliação">
          {(
            [
              ['conciliacao', 'Conciliação'],
              ['retencoes', 'Retenções'],
            ] as [Aba, string][]
          ).map(([chave, rotulo]) => (
            <button
              key={chave}
              type="button"
              className={aba === chave ? 'abas__item abas__item--ativa' : 'abas__item'}
              onClick={() => setAba(chave)}
              aria-current={aba === chave ? 'true' : undefined}
            >
              {rotulo}
            </button>
          ))}
        </nav>

        <div className="filtros-compactos">
          <label>
            <span>Seguradora</span>
            <select value={filtroSeguradora} onChange={(e) => setFiltroSeguradora(e.target.value)}>
              <option value="">Todas</option>
              {dados.seguradoras.map((s) => (
                <option key={s.id} value={s.nome}>
                  {s.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Ano</span>
            <select value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)}>
              <option value="">Todos</option>
              {anos.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {aba === 'conciliacao' ? (
        <>
          <div className="tiles">
            {SITUACOES.map((s) => (
              <TileKpi
                key={s.chave}
                rotulo={s.rotulo}
                valor={formatarNumero(contagem(s.chave))}
                descricao={`mês(es) × seguradora — ${s.descricao}`}
                aoClicar={() => setFiltroSituacao((atual) => (atual === s.chave ? null : s.chave))}
                ativo={filtroSituacao === s.chave}
              />
            ))}
          </div>

          <p className="texto-discreto conciliacao__nota">
            Para comparar com a companhia, importe o extrato do portal em Importações (layout{' '}
            <code>porto-comissao-extrato</code>); hoje só a Porto tem esse layout. Sem extrato, a célula fica
            &ldquo;sem extrato&rdquo; — não conferida, e não errada. O mês é o do pagamento.
          </p>

          <section className="cartao cartao--largo">
            {colunas.length === 0 || meses.length === 0 ? (
              <p className="texto-discreto">
                {filtroSituacao
                  ? 'Nenhum mês nesta situação com os filtros escolhidos.'
                  : 'Nenhum recibo de comissão no período escolhido.'}
              </p>
            ) : (
              <>
                <div className="tabela-rolante">
                  <table className="tabela tabela--densa conciliacao__grade">
                    <thead>
                      <tr>
                        <th scope="col">Mês do pagamento</th>
                        {colunas.map((s) => (
                          <th key={s.id} scope="col" className="tabela__num">
                            {s.nome}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagina.visiveis.map((mes) => (
                        <tr key={mes}>
                          <th scope="row">{formatarCompetencia(mes)}</th>
                          {colunas.map((s) => {
                            const c = celulaDe.get(`${mes}|${s.id}`);
                            if (!c) {
                              return (
                                <td key={s.id} className="conciliacao__celula conciliacao__celula--vazia">
                                  <span className="texto-discreto" title="Fora da faixa de recebimentos desta seguradora">
                                    —
                                  </span>
                                </td>
                              );
                            }
                            const apagada = filtroSituacao !== null && c.situacao !== filtroSituacao;
                            return (
                              <td
                                key={s.id}
                                className={`conciliacao__celula${apagada ? ' conciliacao__celula--apagada' : ''}`}
                              >
                                <button
                                  type="button"
                                  className="conciliacao__botao"
                                  onClick={() => setAberta(c)}
                                  title={`${c.seguradora} · ${formatarCompetencia(c.mes)}: ${formatarNumero(c.recibos.qtde)} recibo(s). Clique para ver as ordens.`}
                                >
                                  <span className="conciliacao__valor">
                                    {c.recibos.qtde > 0 ? formatarReais(c.recibos.liquido) : 'nenhum recibo'}
                                  </span>
                                  <span className={`conciliacao__selo conciliacao__selo--${c.situacao}`}>
                                    {ROTULO_SITUACAO[c.situacao]}
                                  </span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginacao p={pagina} />
              </>
            )}
          </section>
        </>
      ) : (
        <section className="cartao cartao--largo">
          <header className="cartao__cabecalho conciliacao__cabecalho-ret">
            <h2>Retenções por mês e seguradora</h2>
            <button
              type="button"
              className="botao botao--principal botao--compacto"
              onClick={() => void exportar()}
              disabled={baixando || retencoesDoRecorte.length === 0}
            >
              {baixando ? 'Gerando…' : 'Exportar .xlsx'}
            </button>
          </header>
          <p className="texto-discreto conciliacao__nota">
            Impostos como o demonstrativo informa — nenhum dos importados hoje separa IR, ISS e INSS (no Bradesco, é o
            bruto menos o líquido).
            {retencoes.separacaoDisponivel &&
              ' INSS, IRRF e ISS aparecem onde o extrato do portal traz a separação; eles detalham os impostos, não se somam a eles.'}
            {retencoes.impostosCalculados > 0 &&
              ` ${formatarNumero(retencoes.impostosCalculados)} recibo(s) sem a coluna de impostos: o valor foi calculado como bruto − desconto − líquido.`}{' '}
            A planilha leva todas as seguradoras do ano escolhido.
          </p>

          {retencoesDoRecorte.length === 0 ? (
            <p className="texto-discreto">Nenhum recibo no período escolhido.</p>
          ) : (
            <>
              <div className="tabela-rolante">
                <table className="tabela tabela--densa">
                  <thead>
                    <tr>
                      <th scope="col">Mês</th>
                      <th scope="col">Seguradora</th>
                      <th scope="col" className="tabela__num">Recibos</th>
                      <th scope="col" className="tabela__num">Bruto</th>
                      <th scope="col" className="tabela__num">Desconto</th>
                      <th scope="col" className="tabela__num">Impostos</th>
                      {retencoes.separacaoDisponivel && (
                        <>
                          <th scope="col" className="tabela__num">INSS</th>
                          <th scope="col" className="tabela__num">IRRF</th>
                          <th scope="col" className="tabela__num">ISS</th>
                        </>
                      )}
                      <th scope="col" className="tabela__num">Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginaRet.visiveis.map((l) => (
                      <tr key={`${l.mes}|${l.seguradora}`}>
                        <td>{formatarCompetencia(l.mes)}</td>
                        <td>{l.seguradora}</td>
                        <td className="tabela__num">{formatarNumero(l.recibos)}</td>
                        <td className="tabela__num">{formatarReais(l.bruto)}</td>
                        <td className="tabela__num">{formatarReais(l.desconto)}</td>
                        <td className="tabela__num">{formatarReais(l.impostos)}</td>
                        {retencoes.separacaoDisponivel && (
                          <>
                            <td className="tabela__num">{l.inss === null ? '—' : formatarReais(l.inss)}</td>
                            <td className="tabela__num">{l.irrf === null ? '—' : formatarReais(l.irrf)}</td>
                            <td className="tabela__num">{l.iss === null ? '—' : formatarReais(l.iss)}</td>
                          </>
                        )}
                        <td className="tabela__num">{formatarReais(l.liquido)}</td>
                      </tr>
                    ))}
                    {/* Total do RECORTE inteiro, não só da página: é o número que se confere. */}
                    <tr className="tabela__total">
                      <td colSpan={2}>Total do recorte</td>
                      <td className="tabela__num">
                        {formatarNumero(retencoesDoRecorte.reduce((t, l) => t + l.recibos, 0))}
                      </td>
                      <td className="tabela__num">{formatarReais(somaRet('bruto'))}</td>
                      <td className="tabela__num">{formatarReais(somaRet('desconto'))}</td>
                      <td className="tabela__num">{formatarReais(somaRet('impostos'))}</td>
                      {retencoes.separacaoDisponivel &&
                        (['inss', 'irrf', 'iss'] as const).map((campo) => {
                          const v = somaRetOpcional(campo);
                          return (
                            <td key={campo} className="tabela__num">
                              {v === null ? '—' : formatarReais(v)}
                            </td>
                          );
                        })}
                      <td className="tabela__num">{formatarReais(somaRet('liquido'))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Paginacao p={paginaRet} />
            </>
          )}
        </section>
      )}

      {aberta && (
        <>
          <div className="detalhe__fundo" onClick={() => setAberta(null)} aria-hidden="true" />
          <aside
            className="detalhe"
            role="dialog"
            aria-modal="true"
            aria-label={`Ordens ${aberta.seguradora} ${formatarCompetencia(aberta.mes)}`}
          >
            <header className="detalhe__topo">
              <div>
                <h3>
                  {aberta.seguradora} · {formatarCompetencia(aberta.mes)} ·{' '}
                  <span className={`conciliacao__selo conciliacao__selo--${aberta.situacao}`}>
                    {ROTULO_SITUACAO[aberta.situacao]}
                  </span>
                </h3>
                <p className="texto-discreto">
                  {formatarNumero(aberta.recibos.qtde)} recibo(s) · bruto {formatarReais(aberta.recibos.bruto)} ·
                  líquido {formatarReais(aberta.recibos.liquido)}
                  {aberta.extrato &&
                    ` · extrato: ${formatarNumero(aberta.extrato.ordens)} ordem(ns), bruto ${formatarReais(aberta.extrato.bruto)}`}
                </p>
                {aberta.detalhe && (
                  <p className="texto-discreto">
                    Detalhe: {formatarNumero(aberta.detalhe.itens)} item(ns) somando{' '}
                    {formatarReais(aberta.detalhe.somaItens)}, em {formatarNumero(aberta.detalhe.creditosComDetalhe)} de{' '}
                    {formatarNumero(aberta.recibos.qtde)} crédito(s). Os itens detalham o crédito — não se somam a ele.
                  </p>
                )}
              </div>
              <div className="detalhe__acoes">
                {aberta.recibos.qtde > 0 && (
                  <Link className="botao botao--principal botao--compacto" to={linkDaFila(aberta)}>
                    Ver na fila de comissões
                  </Link>
                )}
                <button type="button" className="botao botao--discreto botao--compacto" onClick={() => setAberta(null)}>
                  Fechar
                </button>
              </div>
            </header>

            {aberta.situacao === 'sem_recebimento' ? (
              <p className="detalhe__estado">
                Nenhum recibo de {aberta.seguradora} pago em {formatarCompetencia(aberta.mes)}, entre meses que tiveram.
                Provavelmente o relatório de comissões deste mês não foi importado — confira no portal da companhia.
              </p>
            ) : erroOrdens ? (
              <p className="alerta alerta--erro" role="alert">
                {erroOrdens}
              </p>
            ) : ordens === null ? (
              <p className="detalhe__estado">Carregando…</p>
            ) : (
              <div className="tabela-rolante">
                <table className="tabela tabela--densa">
                  <thead>
                    <tr>
                      <th scope="col">Ordem / recibo</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Pago em</th>
                      <th scope="col" className="tabela__num">Bruto recibo</th>
                      <th scope="col" className="tabela__num">Bruto extrato</th>
                      <th scope="col" className="tabela__num">Diferença</th>
                      <th scope="col" className="tabela__num">Líquido</th>
                      {aberta.detalhe && <th scope="col" className="tabela__num">Itens</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {ordens.map((o) => (
                      <tr key={`${o.situacao}|${o.ordem}`}>
                        <td className="tabela__mono">{o.ordem}</td>
                        <td>
                          <span className={`conciliacao__selo conciliacao__selo--ordem-${o.situacao}`}>
                            {ROTULO_ORDEM[o.situacao]}
                          </span>
                          {o.recibo && o.recibo.mes !== aberta.mes && (
                            <span className="texto-discreto"> recibo de {formatarCompetencia(o.recibo.mes)}</span>
                          )}
                        </td>
                        <td>
                          {(o.recibo?.pagoEm ?? o.extrato?.pagoEm)
                            ? formatarData((o.recibo?.pagoEm ?? o.extrato?.pagoEm)!)
                            : '—'}
                        </td>
                        <td className="tabela__num">{o.recibo ? formatarReais(o.recibo.bruto) : '—'}</td>
                        <td className="tabela__num">{o.extrato ? formatarReais(o.extrato.bruto) : '—'}</td>
                        <td className={o.diferenca ? 'tabela__num situacao--inadimplente' : 'tabela__num'}>
                          {o.diferenca === null ? '—' : formatarReais(o.diferenca)}
                        </td>
                        <td className="tabela__num">
                          {o.recibo
                            ? formatarReais(o.recibo.liquido)
                            : o.extrato?.liquido != null
                              ? formatarReais(o.extrato.liquido)
                              : '—'}
                        </td>
                        {aberta.detalhe && (
                          <td className="tabela__num" title={o.recibo ? `Soma dos itens: ${formatarReais(o.recibo.somaItens)}` : undefined}>
                            {o.recibo ? formatarNumero(o.recibo.itens) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
