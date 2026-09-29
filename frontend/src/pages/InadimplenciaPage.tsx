import { useEffect, useMemo, useState } from 'react';

import { TileKpi } from '@/components/graficos';
import { CabecalhoPainel } from '@/components/Painel';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import { financeiroApi, type ParcelaAtrasada, type ResumoFinanceiro } from '@/lib/financeiro';
import { formatarData, formatarNumero, formatarReais } from '@/lib/formato';
import { seguradorasApi } from '@/lib/seguradoras';

/**
 * Inadimplência. O total do cartão e o da tabela são o mesmo número; por isso o
 * filtro de seguradora vai ao servidor, onde os cartões são somados.
 */

type Visao = 'parcelas' | 'clientes' | 'graves';

/** Igual a `DIAS_DE_ATRASO_GRAVE` do backend. */
const DIAS_DE_ATRASO_GRAVE = 30;

interface ClienteDevedor {
  chave: string;
  clienteId: string | null;
  nome: string;
  produtor: string | null;
  situacao: string | null;
  seguradoras: string[];
  parcelas: number;
  valor: number;
  maiorAtraso: number;
  primeiroVencimento: string | null;
}

/** Sem cadastro, a apólice faz as vezes do cliente: agrupar pelo nome juntaria homônimos. */
function agruparPorCliente(parcelas: ParcelaAtrasada[]): ClienteDevedor[] {
  const grupos = new Map<string, ClienteDevedor>();

  for (const p of parcelas) {
    const chave = p.clienteId ?? `apolice:${p.apolice}`;
    const g = grupos.get(chave) ?? {
      chave,
      clienteId: p.clienteId,
      nome: p.nomeSegurado,
      produtor: p.produtor,
      situacao: p.situacaoCliente,
      seguradoras: [],
      parcelas: 0,
      valor: 0,
      maiorAtraso: 0,
      primeiroVencimento: null,
    };
    g.parcelas += 1;
    g.valor = Math.round((g.valor + p.valor) * 100) / 100;
    g.maiorAtraso = Math.max(g.maiorAtraso, p.diasEmAtraso);
    if (!g.seguradoras.includes(p.seguradora)) g.seguradoras.push(p.seguradora);
    if (p.vencimento && (!g.primeiroVencimento || p.vencimento < g.primeiroVencimento)) {
      g.primeiroVencimento = p.vencimento;
    }
    grupos.set(chave, g);
  }

  return [...grupos.values()].sort((a, b) => b.maiorAtraso - a.maiorAtraso || b.valor - a.valor);
}

export function InadimplenciaPage(): React.JSX.Element {
  const { abrir } = useCliente();

  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [parcelas, setParcelas] = useState<ParcelaAtrasada[]>([]);
  const [seguradoras, setSeguradoras] = useState<string[]>([]);
  const [seguradora, setSeguradora] = useState('');
  const [visao, setVisao] = useState<Visao>('parcelas');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);

  useEffect(() => {
    document.title = 'Inadimplência — MinhaCorretora';
  }, []);

  useEffect(() => {
    void seguradorasApi
      .listar()
      .then((r) => setSeguradoras(r.seguradoras.map((s) => s.nome)))
      .catch(() => setSeguradoras([]));
  }, []);

  useEffect(() => {
    let cancelado = false;
    // Trocar a seguradora mantém o que está na tela, esmaecido, até o novo chegar.
    setAtualizando(true);

    void Promise.all([
      financeiroApi.resumo(seguradora || undefined),
      financeiroApi.inadimplencia(seguradora || undefined),
    ])
      .then(([r, i]) => {
        if (cancelado) return;
        setResumo(r);
        setParcelas(i.parcelas);
        setErro(null);
      })
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar a inadimplência.');
      })
      .finally(() => {
        if (cancelado) return;
        setCarregando(false);
        setAtualizando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [seguradora]);

  const clientes = useMemo(() => agruparPorCliente(parcelas), [parcelas]);
  const graves = useMemo(
    () => parcelas.filter((p) => p.diasEmAtraso > DIAS_DE_ATRASO_GRAVE),
    [parcelas],
  );

  if (carregando) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Inadimplência" />
        <p className="texto-discreto">Carregando…</p>
      </div>
    );
  }

  if (erro || !resumo) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Inadimplência" />
        <p className="alerta alerta--erro" role="alert">
          {erro ?? 'Painel indisponível.'}
        </p>
      </div>
    );
  }

  const semCadastro = parcelas.filter((p) => !p.temCliente).length;
  const linhasParcela = visao === 'graves' ? graves : parcelas;

  const TITULO: Record<Visao, string> = {
    parcelas: 'Parcelas em atraso',
    clientes: 'Clientes inadimplentes',
    graves: `Parcelas com mais de ${DIAS_DE_ATRASO_GRAVE} dias de atraso`,
  };

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Inadimplência"
        descricao="Parcelas em atraso, a partir dos relatórios das seguradoras."
      />

      <div className="filtros-inadimplencia">
        <label className="campo-form">
          <span>Seguradora</span>
          <select value={seguradora} onChange={(e) => setSeguradora(e.target.value)}>
            <option value="">Todas</option>
            {seguradoras.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {atualizando && <span className="texto-discreto">Atualizando…</span>}
      </div>

      <div className="tiles" aria-busy={atualizando}>
        <TileKpi
          rotulo="Em atraso"
          valor={formatarReais(resumo.valorEmAtraso)}
          descricao={`${formatarNumero(resumo.parcelasAtrasadas)} parcela(s)`}
          menorEhMelhor
          aoClicar={() => setVisao('parcelas')}
          ativo={visao === 'parcelas'}
        />
        <TileKpi
          rotulo="Clientes inadimplentes"
          valor={formatarNumero(resumo.clientesInadimplentes)}
          descricao={
            resumo.atrasoSemCliente > 0
              ? `${resumo.atrasoSemCliente} apólice(s) sem cadastro`
              : 'uma linha por cliente'
          }
          menorEhMelhor
          aoClicar={() => setVisao('clientes')}
          ativo={visao === 'clientes'}
        />
        {resumo.parcelasAtrasoGrave !== undefined && (
          <TileKpi
            rotulo={`Mais de ${DIAS_DE_ATRASO_GRAVE} dias`}
            valor={formatarReais(resumo.valorAtrasoGrave ?? 0)}
            descricao={`${formatarNumero(resumo.parcelasAtrasoGrave)} parcela(s) — as mais urgentes`}
            menorEhMelhor
            aoClicar={() => setVisao('graves')}
            ativo={visao === 'graves'}
          />
        )}
      </div>

      {/* Número recortado sem aviso faz supor que é a corretora inteira. */}
      {resumo.recorte.semCarteira && (
        <p className="alerta alerta--aviso" role="note">
          <strong>Nenhum produtor vinculado ao seu usuário.</strong> Esta tela
          filtra pela sua carteira, e ela está vazia — então não há o que mostrar.
          Isso não quer dizer que não exista inadimplência: peça a um
          administrador para vincular seus códigos de produtor em Configurações →
          Usuários.
        </p>
      )}

      {resumo.recorte.carteiraPropria && !resumo.recorte.semCarteira && (
        <p className="alerta alerta--aviso" role="note">
          <strong>Só a sua carteira.</strong> Os números desta tela são dos
          clientes dos seus produtores, não da corretora.
          {!resumo.recorte.inadimplenciaCompleta && (
            <>
              {' '}
              E só aparece quem tem <strong>um único</strong> vencimento em
              atraso — do segundo em diante o caso passa para o setor de
              cobrança, e sai daqui inteiro.
            </>
          )}
        </p>
      )}

      {resumo.atrasoSemCliente > 0 && (
        <p className="alerta alerta--aviso" role="note">
          <strong>{resumo.atrasoSemCliente} apólice(s) em atraso sem cliente cadastrado.</strong>{' '}
          A dívida está registrada, mas não alcança ficha nenhuma — os relatórios
          de parcela identificam o devedor só pelo número da apólice.
        </p>
      )}

      <section className="cartao cartao--largo" aria-busy={atualizando}>
        <header className="cartao__cabecalho">
          <div>
            <h2>{TITULO[visao]}</h2>
            <p className="texto-discreto">
              {seguradora ? `Só ${seguradora}.` : 'Todas as seguradoras.'} Clique num cartão acima
              para trocar a visão; clique no nome para abrir a ficha.
            </p>
          </div>
        </header>

        <div className="cartao__corpo">
          {semCadastro > 0 && semCadastro >= parcelas.length / 2 && (
            <p className="alerta alerta--aviso" role="note">
              <strong>
                {semCadastro} de {parcelas.length} parcela(s) não alcançam um
                cadastro.
              </strong>{' '}
              O relatório de parcelas da seguradora identifica o devedor só
              pelo número da apólice — ele não traz CPF nem corretor. Enquanto
              essas apólices não forem ligadas a um cliente, as colunas de
              cliente e corretor ficam sem conteúdo: não há por onde chegar
              até eles.
              <br />
              O caminho é importar um relatório que traga CPF e número de
              apólice na mesma linha, em <strong>Importações → Importar
              arquivos</strong>.
            </p>
          )}

          {visao === 'clientes' ? (
            <TabelaClientes clientes={clientes} aoAbrir={abrir} />
          ) : linhasParcela.length === 0 ? (
            <p className="texto-discreto">
              {visao === 'graves'
                ? `Nenhuma parcela com mais de ${DIAS_DE_ATRASO_GRAVE} dias de atraso.`
                : 'Nenhuma parcela em atraso importada.'}
            </p>
          ) : (
            <div className="tabela-rolante">
              <table className="tabela tabela--densa">
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col">Apólice</th>
                    <th scope="col">Vencimento</th>
                    <th scope="col" className="tabela__num">Valor</th>
                    <th scope="col">Cobrança</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasParcela.map((p) => (
                    <tr key={`${p.apolice}-${p.parcela}`}>
                      <td>
                        {p.clienteId ? (
                          <button
                            type="button"
                            className="botao-cliente botao-cliente--inline"
                            onClick={() => abrir(p.clienteId!)}
                            title={`Abrir ficha de ${p.nomeSegurado}`}
                          >
                            {p.nomeSegurado}
                          </button>
                        ) : (
                          p.nomeSegurado
                        )}

                        {!p.temCliente && (
                          <span
                            className="etiqueta etiqueta--atencao"
                            title="O relatório de parcelas identifica o devedor só pelo número da apólice. Enquanto essa apólice não alcançar um cadastro, não há ficha para abrir nem corretor para exibir."
                          >
                            sem cadastro
                          </span>
                        )}

                        <br />
                        <small className="texto-discreto">
                          {p.produtor ?? 'corretor não identificado'}
                          {p.situacaoCliente && ` · ${p.situacaoCliente}`}
                        </small>
                      </td>

                      <td>
                        <span className="tabela__mono">{p.apolice}</span>
                        <br />
                        <small className="texto-discreto">
                          parcela {p.parcela} · {p.seguradora}
                          {p.produto && ` · ${p.produto}`}
                        </small>
                      </td>

                      <td>
                        {p.vencimento ? formatarData(p.vencimento) : '—'}
                        <br />
                        <small
                          className={
                            p.diasEmAtraso > DIAS_DE_ATRASO_GRAVE ? 'situacao--inadimplente' : 'texto-discreto'
                          }
                        >
                          {p.diasEmAtraso} dia(s) em atraso
                        </small>
                      </td>

                      <td className="tabela__num">{formatarReais(p.valor)}</td>

                      <td>
                        {p.formaPagamento ?? '—'}
                        {p.motivoRejeicao && (
                          <>
                            <br />
                            <small className="texto-discreto">{p.motivoRejeicao}</small>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Os cartões somam tudo; a lista para em 500. */}
          {parcelas.length >= 500 && (
            <p className="texto-discreto">
              A lista mostra as 500 parcelas mais atrasadas; os cartões somam todas.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function TabelaClientes({
  clientes,
  aoAbrir,
}: {
  clientes: ClienteDevedor[];
  aoAbrir: (uuid: string) => void;
}): React.JSX.Element {
  if (clientes.length === 0) {
    return <p className="texto-discreto">Nenhum cliente com parcela em atraso.</p>;
  }

  return (
    <div className="tabela-rolante">
      <table className="tabela tabela--densa">
        <thead>
          <tr>
            <th scope="col">Cliente</th>
            <th scope="col">Seguradora</th>
            <th scope="col" className="tabela__num">Parcelas</th>
            <th scope="col" className="tabela__num">Maior atraso</th>
            <th scope="col" className="tabela__num">Total devido</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.chave}>
              <td>
                {c.clienteId ? (
                  <button
                    type="button"
                    className="botao-cliente botao-cliente--inline"
                    onClick={() => aoAbrir(c.clienteId!)}
                    title={`Abrir ficha de ${c.nome}`}
                  >
                    {c.nome}
                  </button>
                ) : (
                  <>
                    {c.nome}{' '}
                    <span className="etiqueta etiqueta--atencao">sem cadastro</span>
                  </>
                )}
                <br />
                <small className="texto-discreto">
                  {c.produtor ?? 'corretor não identificado'}
                  {c.situacao && ` · ${c.situacao}`}
                </small>
              </td>
              <td>{c.seguradoras.join(', ')}</td>
              <td className="tabela__num">
                {c.parcelas}
                {c.parcelas > 1 && (
                  <>
                    <br />
                    <small className="situacao--inadimplente">cobrança</small>
                  </>
                )}
              </td>
              <td className="tabela__num">
                <span className={c.maiorAtraso > DIAS_DE_ATRASO_GRAVE ? 'situacao--inadimplente' : undefined}>
                  {c.maiorAtraso} dia(s)
                </span>
                {c.primeiroVencimento && (
                  <>
                    <br />
                    <small className="texto-discreto">desde {formatarData(c.primeiroVencimento)}</small>
                  </>
                )}
              </td>
              <td className="tabela__num">
                <strong>{formatarReais(c.valor)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
