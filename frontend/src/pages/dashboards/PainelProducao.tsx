import '@/styles/producao.css';

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { BarrasHorizontais, CORES, GraficoColunas, TileKpi } from '@/components/graficos';
import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';
import { CabecalhoPainel } from '@/components/Painel';
import { ApiError } from '@/lib/api';
import { filaEmissoesApi, type Negocio, type ResumoEmissoes } from '@/lib/filaEmissoes';
import { formatarCompetencia, formatarNumero, formatarPercentual, formatarReais } from '@/lib/formato';

/**
 * Dashboard de Produção. Emitida = início de vigência no mês (a mesma régua da fila
 * e da gaveta, para os totais baterem); a variação compara com o mês anterior ATÉ
 * O MESMO DIA, senão todo começo de mês pareceria queda.
 */

/** "Não informado" nunca soma em "novo". A cor segue a posição na paleta do `GraficoColunas`. */
const NEGOCIOS: { chave: Negocio; rotulo: string; cor: string }[] = [
  { chave: 'novo', rotulo: 'Negócio novo', cor: CORES[0]! },
  { chave: 'renovacao', rotulo: 'Renovação', cor: CORES[1]! },
  { chave: 'nao_informado', rotulo: 'Não informado', cor: CORES[2]! },
];

const NOMES_DOS_MESES = Array.from({ length: 12 }, (_, i) => {
  const nome = new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'long' });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
});

function mesAnterior(m: string): string {
  const [a, n] = m.split('-').map(Number) as [number, number];
  const dt = new Date(a, n - 2, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function PainelProducao(): React.JSX.Element {
  const navigate = useNavigate();
  // Ano e mês na URL: o "voltar" e um link colado reabrem o mesmo recorte.
  const [parametros, setParametros] = useSearchParams();
  const agora = new Date();
  const mesCorrente = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const ano = /^\d{4}$/.test(parametros.get('ano') ?? '') ? parametros.get('ano')! : mesCorrente.slice(0, 4);
  const mesDaUrl = /^\d{4}-(0[1-9]|1[0-2])$/.test(parametros.get('mes') ?? '') ? parametros.get('mes')! : '';
  const definirFiltro = (mudancas: Record<string, string>): void => {
    setParametros(
      (atual) => {
        const novo = new URLSearchParams(atual);
        for (const [k, v] of Object.entries(mudancas)) {
          if (v) novo.set(k, v);
          else novo.delete(k);
        }
        return novo;
      },
      { replace: true },
    );
  };
  const [resumo, setResumo] = useState<ResumoEmissoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    document.title = 'Produção — MinhaCorretora';
  }, []);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    filaEmissoesApi
      .resumo(ano)
      .then((r) => !cancelado && setResumo(r))
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError && falha.status === 404
            ? 'O dashboard de Produção precisa do servidor atualizado: reinicie o backend.'
            : falha instanceof ApiError
              ? falha.message
              : 'Não foi possível carregar a produção.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, [tentativa, ano]);

  if (!resumo) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Produção" />
        {erro ? (
          <p className="alerta alerta--erro" role="alert">
            {erro}{' '}
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={() => setTentativa((t) => t + 1)}
            >
              Tentar de novo
            </button>
          </p>
        ) : (
          <p className="texto-discreto">Carregando…</p>
        )}
      </div>
    );
  }

  // `Array.isArray`: backend anterior pode não mandar o campo.
  const linhas = Array.isArray(resumo.meses) ? resumo.meses : [];
  const negocios = Array.isArray(resumo.negocios) ? resumo.negocios : [];
  // Mês futuro fica de fora: renovação já emitida com início adiante não é produção
  // (é contada à parte, em `futuras`).
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`).filter(
    (m) => m <= mesCorrente,
  );
  const atual =
    mesDaUrl && meses.includes(mesDaUrl) && mesDaUrl <= mesCorrente
      ? mesDaUrl
      : meses.includes(mesCorrente)
        ? mesCorrente
        : meses[meses.length - 1]!;
  const anterior = mesAnterior(atual);
  const emAndamento = atual === mesCorrente;
  const hoje = new Date().getDate();

  const somaDoMes = (m: string): { apolices: number; comPremio: number; premio: number } => {
    const doMes = linhas.filter((x) => x.mes === m);
    return {
      apolices: doMes.reduce((t, x) => t + x.apolices, 0),
      comPremio: doMes.reduce((t, x) => t + x.comPremio, 0),
      premio: Math.round(doMes.reduce((t, x) => t + x.premio, 0) * 100) / 100,
    };
  };
  const { apolices: emitidas, comPremio, premio } = somaDoMes(atual);
  const ticket = comPremio > 0 ? Math.round((premio / comPremio) * 100) / 100 : null;

  // Mês em andamento compara com o anterior ATÉ O MESMO DIA; fechado, com o inteiro.
  const base = emAndamento ? resumo.anteriorAteHoje : meses.includes(anterior) ? somaDoMes(anterior) : null;
  const variacao = base && base.apolices > 0 ? ((emitidas - base.apolices) / base.apolices) * 100 : null;

  const seguradoras = [...new Set(linhas.map((x) => x.seguradora))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );

  const rotuloMes = (m: string): string =>
    formatarCompetencia(m) + (m === mesCorrente ? ' (parcial)' : '') + (m === atual ? ' ●' : '');
  const mesDoRotulo = new Map(meses.map((m) => [rotuloMes(m), m]));

  const doMesPorNegocio = (n: Negocio): number =>
    negocios.filter((x) => x.mes === atual && x.negocio === n).reduce((t, x) => t + x.apolices, 0);
  const negociosVisiveis = NEGOCIOS.filter(
    (n) => n.chave !== 'nao_informado' || negocios.some((x) => x.negocio === n.chave),
  );
  // Sem o dado (backend anterior), a série cai para por seguradora.
  const porNegocio = negocios.length > 0;

  const RANKING = 8;
  const doMesPorSeguradora = seguradoras
    .map((nome) => ({
      nome,
      valor: linhas.filter((x) => x.mes === atual && x.seguradora === nome).reduce((t, x) => t + x.apolices, 0),
    }))
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const restoDoMes = doMesPorSeguradora.length > RANKING + 1 ? doMesPorSeguradora.slice(RANKING) : [];
  const ROTULO_OUTRAS = `Outras (${restoDoMes.length})`;
  const ranking = [
    ...(restoDoMes.length ? doMesPorSeguradora.slice(0, RANKING) : doMesPorSeguradora).map((x) => ({ rotulo: x.nome, valor: x.valor })),
    ...(restoDoMes.length ? [{ rotulo: ROTULO_OUTRAS, valor: restoDoMes.reduce((t, x) => t + x.valor, 0) }] : []),
  ];

  const anos = [
    ...new Set([Number(mesCorrente.slice(0, 4)), ...(Array.isArray(resumo.anos) ? resumo.anos : [])]),
  ].sort((a, b) => b - a);

  const irParaFila = (filtro: Record<string, string>): void => {
    void navigate(`/filas/emissoes?${new URLSearchParams(filtro).toString()}`);
  };

  return (
    <div className="painel painel--tela">
      <CabecalhoPainel
        titulo="Produção"
        descricao="Apólices emitidas por mês (início de vigência). Escolha o ano e o mês, ou clique numa coluna; os números abrem as apólices."
        acoes={
          <div className="filtros-compactos producao__filtros">
            <label>
              <span>Ano</span>
              <select
                value={ano}
                onChange={(e) => {
                  const mes = `${e.target.value}-${atual.slice(5)}`;
                  definirFiltro({ ano: e.target.value, mes: mes > mesCorrente ? mesCorrente : mes });
                }}
              >
                {anos.map((a) => (
                  <option key={a} value={String(a)}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Mês</span>
              <select
                value={atual.slice(5)}
                onChange={(e) => definirFiltro({ ano, mes: `${ano}-${e.target.value}` })}
              >
                {NOMES_DOS_MESES.map((nome, i) => {
                  const mm = String(i + 1).padStart(2, '0');
                  const futuro = `${ano}-${mm}` > mesCorrente;
                  return (
                    <option key={mm} value={mm} disabled={futuro}>
                      {nome}
                      {`${ano}-${mm}` === mesCorrente ? ' (atual)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        }
      />

      <div className="producao__corpo">
        <div className="producao__numeros">
          <TileKpi
            rotulo={`Emitidas em ${formatarCompetencia(atual)}`}
            valor={formatarNumero(emitidas)}
            descricao={emAndamento ? `até hoje, dia ${hoje}` : 'mês fechado'}
            aoClicar={() => irParaFila({ mes: atual })}
          />
          <TileKpi
            rotulo="Prêmio do mês"
            valor={formatarReais(premio)}
            descricao={[
              ticket === null ? null : `ticket médio ${formatarReais(ticket)}`,
              emitidas > comPremio ? `${formatarNumero(emitidas - comPremio)} sem prêmio na origem` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            aoClicar={() => irParaFila({ mes: atual })}
          />
          <TileKpi
            rotulo={`Contra ${formatarCompetencia(anterior)}`}
            // A seta vai no texto, não só na cor.
            valor={
              variacao === null
                ? '—'
                : `${variacao > 0 ? '↑ +' : variacao < 0 ? '↓ ' : '→ '}${formatarPercentual(variacao)}`
            }
            descricao={
              !base
                ? `${formatarCompetencia(anterior)} fora da série escolhida`
                : emAndamento
                  ? `${formatarNumero(base.apolices)} apólice(s) de 1 a ${hoje}/${anterior.slice(5)}`
                  : `${formatarNumero(base.apolices)} apólice(s) no mês inteiro`
            }
            aoClicar={() => irParaFila({ mes: anterior })}
          />
          {negocios.length > 0 && (
            <>
              <TileKpi
                rotulo={`Negócios novos em ${formatarCompetencia(atual)}`}
                valor={formatarNumero(doMesPorNegocio('novo'))}
                descricao="cliente ou apólice nova — prospecção"
                aoClicar={() => irParaFila({ mes: atual, negocio: 'novo' })}
              />
              <TileKpi
                rotulo={`Renovações em ${formatarCompetencia(atual)}`}
                valor={formatarNumero(doMesPorNegocio('renovacao'))}
                descricao={
                  doMesPorNegocio('nao_informado') > 0
                    ? `+ ${formatarNumero(doMesPorNegocio('nao_informado'))} sem tipo informado`
                    : 'apólice que renovou uma anterior'
                }
                aoClicar={() => irParaFila({ mes: atual, negocio: 'renovacao' })}
              />
            </>
          )}
        </div>

        <section className="cartao producao__serie">
          <header className="cartao__cabecalho">
            <h2
              title={
                porNegocio
                  ? 'Apólices de cada mês, novo × renovação (quando a origem informa, como o PDF do Bradesco), pelo início de vigência. Clique numa coluna para escolher o mês.'
                  : 'Apólices de cada mês, por seguradora, pelo início de vigência. Clique numa coluna para escolher o mês.'
              }
            >
              {porNegocio ? 'Novo × renovação por mês' : 'Emissões por mês'}
            </h2>
            <div className="producao__acoes">
              <Link className="botao botao--principal botao--compacto" to="/filas/emissoes">
                Abrir fila de emissões
              </Link>
            </div>
          </header>

          {linhas.length === 0 ? (
            <p className="texto-discreto">Nenhuma apólice com início de vigência nos últimos 12 meses.</p>
          ) : (
            <>
              <AreaDoGrafico>
                {(altura) => (
                  <GraficoColunas
                    series={
                      porNegocio
                        ? negociosVisiveis.map((n) => ({
                            nome: n.rotulo,
                            pontos: meses.map((m) => {
                              const x = negocios.find((l) => l.mes === m && l.negocio === n.chave);
                              return { periodo: rotuloMes(m), valor: x ? x.apolices : 0 };
                            }),
                          }))
                        : seguradoras.map((nome) => ({
                            nome,
                            pontos: meses.map((m) => {
                              const x = linhas.find((l) => l.mes === m && l.seguradora === nome);
                              return { periodo: rotuloMes(m), valor: x ? x.apolices : 0 };
                            }),
                          }))
                    }
                    formatar={formatarNumero}
                    empilhado
                    altura={altura}
                    aoClicar={(rotulo) => {
                      const m = mesDoRotulo.get(rotulo);
                      if (m) definirFiltro({ mes: m });
                    }}
                  />
                )}
              </AreaDoGrafico>

            </>
          )}

          {(resumo.futuras > 0 || resumo.semInicio > 0) && (
            <p className="producao__nota texto-discreto">
              {[
                resumo.futuras > 0 &&
                  `${formatarNumero(resumo.futuras)} com início de vigência depois deste mês`,
                resumo.semInicio > 0 && `${formatarNumero(resumo.semInicio)} sem início de vigência`,
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              — fora da série.
            </p>
          )}
        </section>

        <section className="cartao producao__ranking">
          <header className="cartao__cabecalho">
            <h2>Por seguradora em {formatarCompetencia(atual)}</h2>
          </header>
          {ranking.length === 0 ? (
            <p className="texto-discreto">Nenhuma apólice com início de vigência neste mês.</p>
          ) : (
            <>
              <div className="producao__ranking-lista">
                <BarrasHorizontais
                  dados={ranking}
                  formatar={formatarNumero}
                  aoClicar={(rotulo) =>
                    irParaFila(rotulo === ROTULO_OUTRAS ? { mes: atual } : { mes: atual, seguradora: rotulo })
                  }
                />
              </div>
              {restoDoMes.length > 0 && (
                <p className="producao__nota texto-discreto" title={restoDoMes.map((x) => `${x.nome} ${formatarNumero(x.valor)}`).join(' · ')}>
                  Outras: {restoDoMes.map((x) => x.nome).join(', ')}.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
