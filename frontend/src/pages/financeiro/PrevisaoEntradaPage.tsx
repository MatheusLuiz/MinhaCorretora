import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { GraficoColunas, TileKpi } from '@/components/graficos';
import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';
import { CabecalhoPainel } from '@/components/Painel';
import { ApiError } from '@/lib/api';
import { formatarCompetencia, formatarData, formatarNumero, formatarReais } from '@/lib/formato';
import {
  previsaoEntradaApi,
  type JanelaPrevista,
  type PadraoPagamento,
  type PendenteSeguradora,
  type PrevisaoEntrada,
  type RitmoSeguradora,
} from '@/lib/previsaoEntrada';

import '@/styles/previsao.css';

/**
 * Previsão de entrada. Três números que a tela não soma: ESTIMADO (parcela × % da
 * apólice), TRAVADO (vencido, fora do calendário) e RITMO (média do que já entrou —
 * referência, não previsão). Parcela sem % aparece pelo valor, nunca como zero.
 */

const DIAS_DA_SEMANA = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];

function juntarComE(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

function textoDoPadrao(p: PadraoPagamento): string | null {
  if (!p) return null;
  if (p.tipo === 'mensal') return `costuma pagar em torno do dia ${p.dia}`;
  if (p.tipo === 'diario') return 'paga quase todo dia útil';
  return `paga toda semana, às ${juntarComE(p.diasDaSemana.map((d) => DIAS_DA_SEMANA[d] ?? ''))}`;
}

const somar = (
  xs: PendenteSeguradora[],
  campo: 'comissao' | 'semTaxaValor' | 'semTaxaParcelas' | 'comTaxaParcelas',
): number => Math.round(xs.reduce((t, x) => t + x[campo], 0) * 100) / 100;

const diaMes = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function PrevisaoEntradaPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [dados, setDados] = useState<PrevisaoEntrada | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    previsaoEntradaApi
      .obter()
      .then(setDados)
      .catch((falha: unknown) =>
        setErro(
          falha instanceof ApiError ? falha.message : 'Não foi possível carregar a previsão de entrada.',
        ),
      )
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    document.title = 'Previsão de entrada — MinhaCorretora';
    carregar();
  }, [carregar]);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  const descricao =
    'Comissão estimada das parcelas em aberto, o que está travado em atraso e o ritmo dos recibos.';

  if (carregando || erro || !dados) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Previsão de entrada" descricao={descricao} />
        {carregando ? (
          <p className="texto-discreto">Carregando…</p>
        ) : (
          <p className="alerta alerta--erro" role="alert">
            {erro ?? 'Previsão indisponível.'}{' '}
            <button type="button" className="botao botao--discreto botao--compacto" onClick={carregar}>
              Tentar de novo
            </button>
          </p>
        )}
      </div>
    );
  }

  // `Array.isArray`: backend numa versão anterior pode não mandar o campo.
  const semanas = Array.isArray(dados.semanas) ? dados.semanas : [];
  const meses = Array.isArray(dados.meses) ? dados.meses : [];
  const ritmo = Array.isArray(dados.ritmo) ? dados.ritmo : [];
  const travadoPor = Array.isArray(dados.travado?.porSeguradora) ? dados.travado.porSeguradora : [];
  const travado = dados.travado?.total;

  const nasSemanas = semanas.flatMap((s) => s.porSeguradora);
  const temEstimativa = somar(nasSemanas, 'comTaxaParcelas') > 0;
  const semTaxaParcelas = somar(nasSemanas, 'semTaxaParcelas');
  const semTaxaValor = somar(nasSemanas, 'semTaxaValor');
  const seguradorasSemTaxa = [
    ...new Set(nasSemanas.filter((x) => x.semTaxaParcelas > 0).map((x) => x.seguradora)),
  ];

  // A primeira semana conta de HOJE até domingo.
  const rotuloSemana = (inicio: string, i: number): string =>
    i === 0 ? `hoje ${diaMes(dados.hoje)}` : diaMes(inicio);
  const mesDaSemana = new Map(
    semanas.map((s, i) => [rotuloSemana(s.inicio, i), (i === 0 ? dados.hoje : s.inicio).slice(0, 7)]),
  );

  const seguradorasNoGrafico = [
    ...new Set(
      nasSemanas
        .filter((x) => (temEstimativa ? x.comTaxaParcelas > 0 : x.semTaxaParcelas > 0))
        .map((x) => x.seguradora),
    ),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const abrirFila = (params: Record<string, string>): void => {
    navigate(`/filas/comissoes?${new URLSearchParams(params).toString()}`);
  };

  // Seguradora só com parcela (sem recibo importado) também ganha cartão.
  const nomes = [
    ...new Set([
      ...ritmo.map((r) => r.seguradora),
      ...travadoPor.map((t) => t.seguradora),
      ...nasSemanas.map((x) => x.seguradora),
    ]),
  ].sort((a, b) => (ritmoDe(ritmo, b)?.mediaMensal ?? -1) - (ritmoDe(ritmo, a)?.mediaMensal ?? -1));

  return (
    <div className="painel painel--tela previsao">
      <CabecalhoPainel titulo="Previsão de entrada" descricao={descricao} />

      <div className="tiles previsao__faixa">
        {dados.janelas.map((j) => (
          <TileJanela key={j.dias} janela={j} aoClicar={() => abrirFila({ situacao: 'aberto' })} />
        ))}
        {travado && (
          <TileKpi
            rotulo="Travado em atraso"
            valor={
              travado.comTaxaParcelas === 0 && travado.semTaxaParcelas > 0
                ? 'Sem estimativa'
                : formatarReais(travado.comissao)
            }
            descricao={
              travado.parcelas === 0
                ? 'nenhuma parcela vencida'
                : `${formatarNumero(travado.parcelas)} parcela(s) · entra quando o cliente pagar`
            }
            menorEhMelhor
            aoClicar={() => abrirFila({ situacao: 'atraso' })}
          />
        )}
      </div>

      <div className="previsao__corpo">
        <section className="cartao previsao__linha-tempo">
          <header className="cartao__cabecalho">
            <h2
              title={
                temEstimativa
                  ? 'Comissão estimada das parcelas em aberto, pela semana de vencimento. Clique numa semana para abrir a fila.'
                  : 'Nenhuma parcela destas semanas tem % de comissão conhecido: o gráfico mostra o VALOR das parcelas.'
              }
            >
              {temEstimativa
                ? 'Comissão estimada · próximas 12 semanas'
                : 'Parcelas sem % · próximas 12 semanas'}
            </h2>
            <Link className="botao botao--principal botao--compacto" to="/filas/comissoes?situacao=aberto">
              Abrir fila de comissões
            </Link>
          </header>
          {semTaxaParcelas > 0 && (
            <p
              className="previsao__legenda-aviso"
              title={`${formatarNumero(semTaxaParcelas)} parcela(s) de ${juntarComE(seguradorasSemTaxa)} somando ${formatarReais(semTaxaValor)}: a seguradora não informa o % de comissão, então ficam FORA da estimativa. O ritmo dos recibos, ao lado, é a referência do que costuma entrar.`}
            >
              {temEstimativa
                ? `⚠ ${formatarNumero(semTaxaParcelas)} parcela(s) sem % (${formatarReais(semTaxaValor)}) ficam fora da estimativa`
                : `⚠ Valor das parcelas (prêmio), não comissão: ${juntarComE(seguradorasSemTaxa)} não informa o %`}
            </p>
          )}
          {nasSemanas.length === 0 ? (
            <p className="texto-discreto previsao__vazio">
              Nenhuma parcela em aberto vence nas próximas 12 semanas. Sem relatório de parcelas não há
              calendário a desenhar — o ritmo dos recibos segue ao lado.
            </p>
          ) : (
            <AreaDoGrafico>
              {(altura) => (
                <GraficoColunas
                  series={seguradorasNoGrafico.map((nome) => ({
                    nome,
                    pontos: semanas.map((s, i) => {
                      const l = s.porSeguradora.find((x) => x.seguradora === nome);
                      return {
                        periodo: rotuloSemana(s.inicio, i),
                        valor: l ? (temEstimativa ? l.comissao : l.semTaxaValor) : 0,
                      };
                    }),
                  }))}
                  formatar={formatarReais}
                  empilhado
                  altura={altura}
                  aoClicar={(rotulo) => {
                    const mes = mesDaSemana.get(rotulo);
                    if (mes) abrirFila({ situacao: 'aberto', mes });
                  }}
                />
              )}
            </AreaDoGrafico>
          )}

          <ul className="previsao__meses" aria-label="Por mês">
            {meses.map((m, i) => {
              const comissao = somar(m.porSeguradora, 'comissao');
              const comTaxa = somar(m.porSeguradora, 'comTaxaParcelas');
              const semValor = somar(m.porSeguradora, 'semTaxaValor');
              return (
                <li key={m.mes}>
                  <button
                    type="button"
                    className="previsao__mes"
                    onClick={() => abrirFila({ situacao: 'aberto', mes: m.mes })}
                    title="Abrir a fila de comissões deste mês"
                  >
                    <span className="previsao__mes-rotulo">
                      {formatarCompetencia(m.mes)}
                      {i === 0 ? ' (resto)' : ''}
                    </span>
                    <strong>{comTaxa > 0 ? formatarReais(comissao) : '—'}</strong>
                    {semValor > 0 && (
                      <span className="previsao__mes-sem">sem %: {formatarReais(semValor)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="previsao__lado" aria-label="Por seguradora">
          <p
            className="previsao__lado-titulo"
            title="Média do que já entrou pelos recibos — não é promessa de entrada"
          >
            Ritmo dos recibos · <em>referência, não previsão</em>
          </p>
          {nomes.map((nome) => (
            <CartaoSeguradora
              key={nome}
              nome={nome}
              ritmo={ritmoDe(ritmo, nome)}
              travado={travadoPor.find((t) => t.seguradora === nome)}
              aoAbrirAtraso={() => abrirFila({ situacao: 'atraso', seguradora: nome })}
            />
          ))}
          {nomes.length === 0 && <p className="texto-discreto">Nenhum recibo nem parcela importados.</p>}
        </aside>
      </div>
    </div>
  );
}

function ritmoDe(ritmo: RitmoSeguradora[], nome: string): RitmoSeguradora | undefined {
  return ritmo.find((r) => r.seguradora === nome);
}

function TileJanela({
  janela,
  aoClicar,
}: {
  janela: JanelaPrevista;
  aoClicar: () => void;
}): React.JSX.Element {
  // Sem parcela com %, "R$ 0,00" diria que nada vai entrar: o número some e a descrição diz o porquê.
  const soSemTaxa = janela.comTaxaParcelas === 0 && janela.semTaxaParcelas > 0;
  const sem = janela.semTaxaParcelas > 0 ? `${formatarReais(janela.semTaxaValor)} em parcelas sem %` : null;
  return (
    <TileKpi
      rotulo={`Próximos ${janela.dias} dias · estimado`}
      valor={soSemTaxa ? 'Sem estimativa' : formatarReais(janela.comissao)}
      descricao={
        soSemTaxa
          ? sem!
          : janela.comTaxaParcelas === 0
            ? 'nenhuma parcela em aberto vence'
            : `${formatarNumero(janela.comTaxaParcelas)} parcela(s) com %${sem ? ` · + ${sem}` : ''}`
      }
      aoClicar={aoClicar}
    />
  );
}

function CartaoSeguradora({
  nome,
  ritmo,
  travado,
  aoAbrirAtraso,
}: {
  nome: string;
  ritmo: RitmoSeguradora | undefined;
  travado: PendenteSeguradora | undefined;
  aoAbrirAtraso: () => void;
}): React.JSX.Element {
  const meses = ritmo?.meses ?? [];
  const maior = Math.max(...meses.map((m) => m.liquido), 1);
  const padrao = ritmo ? textoDoPadrao(ritmo.padrao) : null;
  const cobertos = meses.filter((m) => m.coberto);

  return (
    <section className="cartao cartao--compacto previsao__seguradora">
      <header className="previsao__seg-topo">
        <h3>{nome}</h3>
        {ritmo && meses.length > 0 && (
          // Mês antes do primeiro recibo fica tracejado: não é zero, é ausência de dado.
          <span className="previsao__mini" aria-hidden="true">
            {meses.map((m) => (
              <i
                key={m.mes}
                className={m.coberto ? '' : 'previsao__mini--sem'}
                style={{ height: m.coberto ? `${Math.max(6, (m.liquido / maior) * 100)}%` : '100%' }}
                title={`${formatarCompetencia(m.mes)}: ${m.coberto ? formatarReais(m.liquido) : 'sem recibo importado'}`}
              />
            ))}
          </span>
        )}
      </header>

      {!ritmo ? (
        <p className="texto-discreto previsao__seg-linha">Nenhum recibo de comissão importado.</p>
      ) : (
        <>
          <p
            className="previsao__seg-media"
            title={
              ritmo.mediaMensal === null
                ? undefined
                : `Média de ${ritmo.mesesNaMedia} ${ritmo.mesesNaMedia === 1 ? 'mês fechado' : 'meses fechados'}` +
                  (cobertos.length > 0
                    ? ` (${formatarCompetencia(cobertos[0]!.mes)}–${formatarCompetencia(cobertos[cobertos.length - 1]!.mes)})`
                    : '') +
                  (ritmo.mesesNaMedia < meses.length
                    ? ` · recibos desde ${formatarData(ritmo.primeiroRecibo)}`
                    : '')
            }
          >
            {ritmo.mediaMensal === null ? (
              <span className="texto-discreto">Sem mês fechado para a média</span>
            ) : (
              <>
                costuma entrar <strong>~{formatarReais(ritmo.mediaMensal)}</strong>/mês
              </>
            )}
          </p>
          {padrao && <p className="previsao__seg-linha">{padrao}</p>}
          <dl className="previsao__seg-dados">
            <div>
              <dt>Este mês até agora</dt>
              <dd>{formatarReais(ritmo.mesAtual)}</dd>
            </div>
            <div>
              <dt>Último recibo</dt>
              <dd>
                {formatarData(ritmo.ultimoRecibo.data)} · {formatarReais(ritmo.ultimoRecibo.liquido)}
              </dd>
            </div>
          </dl>
        </>
      )}

      {travado && travado.parcelas > 0 && (
        <button type="button" className="previsao__seg-atraso" onClick={aoAbrirAtraso}>
          <span>Travado em atraso · {formatarNumero(travado.parcelas)} parcela(s)</span>
          <strong
            title={
              travado.semTaxaParcelas > 0
                ? `Mais ${formatarReais(travado.semTaxaValor)} em parcelas sem % de comissão. Só entra quando o cliente pagar.`
                : 'Só entra quando o cliente pagar.'
            }
          >
            {travado.comTaxaParcelas > 0 ? formatarReais(travado.comissao) : 'sem %'}
          </strong>
        </button>
      )}
    </section>
  );
}
