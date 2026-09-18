import { useId, useMemo, useState } from 'react';

import type { Ponto } from '@/lib/analise';
import { MESES_CURTOS } from '@/lib/analise';
import { formatarReais, formatarReaisCompacto } from '@/lib/formato';

/**
 * Paleta categórica. No modo claro alguns tons ficam abaixo de 3:1 contra o
 * fundo, por isso toda forma daqui carrega rótulo direto ou legenda em texto.
 */
export const CORES = [
  'var(--serie-1)',
  'var(--serie-2)',
  'var(--serie-3)',
  'var(--serie-4)',
  'var(--serie-5)',
  'var(--serie-6)',
  'var(--serie-7)',
  'var(--serie-8)',
];

/** Cor da i-ésima série; passou da paleta, cinza — `undefined` o SVG pinta de PRETO. */
export const corDaSerie = (i: number): string => CORES[i] ?? 'var(--text-muted)';

/** As maiores categorias e o resto somado em "Outras (N)", para caber na paleta. */
export function maioresEOutras(
  itens: { rotulo: string; valor: number }[],
  maximo: number = CORES.length,
): { rotulo: string; valor: number; agrupadas?: string[] }[] {
  const ordenados = itens.filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
  if (ordenados.length <= maximo) return ordenados;
  const resto = ordenados.slice(maximo - 1);
  return [
    ...ordenados.slice(0, maximo - 1),
    { rotulo: `Outras (${resto.length})`, valor: resto.reduce((t, x) => t + x.valor, 0), agrupadas: resto.map((x) => x.rotulo) },
  ];
}

// ══════════════════════════ Série temporal ══════════════════════════

export interface SerieGrafico {
  nome: string;
  pontos: Ponto[];
  /** Tracejada: é referência (meta, limite, projeção), não medição. */
  referencia?: boolean;
  /** Faixa de incerteza, para projeções. */
  faixa?: { minimo: number; maximo: number }[];
}

interface PropsLinha {
  /** Clique no ponto sob o cursor, com o rótulo do período. */
  aoClicar?: (periodo: string) => void;
  series: SerieGrafico[];
  formatar: (v: number) => string;
  formatarEixo?: (v: number) => string;
  linhaReferencia?: { valor: number; rotulo: string };
  comecarNoZero?: boolean;
  altura?: number;
}

const L = 760;
/** Largura do viewBox dos gráficos de linha e colunas. */
export const LARGURA_DO_GRAFICO = L;
// `esq` cabe "R$ 1.250 mil" em 11px; o SVG tem `overflow: visible` e nada cortaria o excesso.
const M = { topo: 16, dir: 16, baixo: 34, esq: 80 };

/** Dinheiro no eixo vai SEMPRE compacto: o valor exato não cabe na margem. */
function formatadorDoEixo(
  formatar: (v: number) => string,
  formatarEixo?: (v: number) => string,
): (v: number) => string {
  if (formatarEixo) return formatarEixo;
  return formatar === formatarReais ? formatarReaisCompacto : formatar;
}

/** Série temporal em linha. Um único eixo Y, sempre: escalas diferentes viram dois gráficos. */
export function GraficoLinha({
  series,
  formatar,
  formatarEixo,
  linhaReferencia,
  comecarNoZero = false,
  altura = 280,
  aoClicar,
}: PropsLinha): React.JSX.Element {
  const idClip = useId();
  const [ativo, setAtivo] = useState<number | null>(null);

  const A = altura;
  const areaL = L - M.esq - M.dir;
  const areaA = A - M.topo - M.baixo;

  const periodos = series[0]?.pontos.map((p) => p.periodo) ?? [];

  const { min, max, marcas } = useMemo(() => {
    const valores = series.flatMap((s) => [
      ...s.pontos.map((p) => p.valor),
      ...(s.faixa?.flatMap((f) => [f.minimo, f.maximo]) ?? []),
    ]);
    if (linhaReferencia) valores.push(linhaReferencia.valor);
    if (valores.length === 0) return { min: 0, max: 1, marcas: [0, 1] };

    const bruto = { min: Math.min(...valores), max: Math.max(...valores) };
    const folga = (bruto.max - bruto.min) * 0.08 || bruto.max * 0.1 || 1;

    const minimo = comecarNoZero ? 0 : Math.max(0, bruto.min - folga);
    const maximo = bruto.max + folga;
    const passo = (maximo - minimo) / 4;

    return { min: minimo, max: maximo, marcas: Array.from({ length: 5 }, (_, i) => minimo + passo * i) };
  }, [series, linhaReferencia, comecarNoZero]);

  const x = (i: number): number =>
    periodos.length <= 1 ? M.esq : M.esq + (i / (periodos.length - 1)) * areaL;
  const y = (v: number): number => M.topo + areaA - ((v - min) / (max - min || 1)) * areaA;

  const rotuloEixo = formatadorDoEixo(formatar, formatarEixo);

  // Com 24 pontos, um rótulo por mês vira uma faixa ilegível de texto colado.
  const passoRotulo = periodos.length > 14 ? Math.ceil(periodos.length / 8) : 1;

  function aoMover(e: React.MouseEvent<SVGSVGElement>): void {
    const caixa = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - caixa.left) / caixa.width) * L;
    const i = Math.round(((px - M.esq) / areaL) * (periodos.length - 1));
    setAtivo(i >= 0 && i < periodos.length ? i : null);
  }

  return (
    <div className="gr">
      {series.length > 1 && <Legenda itens={series.map((s, i) => ({ nome: s.nome, cor: corDaSerie(i) }))} />}

      <svg
        viewBox={`0 0 ${L} ${A}`}
        className="gr__svg"
        role="img"
        aria-label={`Série temporal: ${series.map((s) => s.nome).join(', ')}`}
        onMouseMove={aoMover}
        onMouseLeave={() => setAtivo(null)}
        onClick={
          aoClicar && ativo !== null && periodos[ativo]
            ? () => aoClicar(periodos[ativo]!)
            : undefined
        }
        style={aoClicar ? { cursor: 'pointer' } : undefined}
      >
        <defs>
          <clipPath id={idClip}>
            <rect x={M.esq} y={M.topo} width={areaL} height={areaA} />
          </clipPath>
        </defs>

        {marcas.map((m) => (
          <g key={m}>
            <line x1={M.esq} x2={L - M.dir} y1={y(m)} y2={y(m)} className="gr__grade" />
            <text x={M.esq - 10} y={y(m) + 4} textAnchor="end" className="gr__eixo">
              {rotuloEixo(m)}
            </text>
          </g>
        ))}

        {linhaReferencia && (
          <>
            <line
              x1={M.esq}
              x2={L - M.dir}
              y1={y(linhaReferencia.valor)}
              y2={y(linhaReferencia.valor)}
              className="gr__referencia"
            />
            <text x={L - M.dir} y={y(linhaReferencia.valor) - 6} textAnchor="end" className="gr__eixo-ref">
              {linhaReferencia.rotulo}
            </text>
          </>
        )}

        {periodos.map((p, i) =>
          i % passoRotulo === 0 ? (
            <text key={p} x={x(i)} y={A - 12} textAnchor="middle" className="gr__eixo">
              {p}
            </text>
          ) : null,
        )}

        {ativo !== null && (
          <line x1={x(ativo)} x2={x(ativo)} y1={M.topo} y2={M.topo + areaA} className="gr__regua" />
        )}

        <g clipPath={`url(#${idClip})`}>
          {/* A faixa vai antes das linhas para ficar atrás delas. */}
          {series.map((s, iS) =>
            s.faixa ? (
              <path
                key={`faixa-${s.nome}`}
                d={
                  s.pontos.map((_, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(s.faixa![i]!.maximo)}`).join(" ") +
                  ' ' +
                  s.pontos
                    .map((_, i) => `L ${x(s.pontos.length - 1 - i)} ${y(s.faixa![s.pontos.length - 1 - i]!.minimo)}`)
                    .join(' ') +
                  ' Z'
                }
                fill={corDaSerie(iS)}
                opacity={0.14}
              />
            ) : null,
          )}

          {series.map((s, iS) => (
            <path
              key={s.nome}
              d={s.pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.valor)}`).join(' ')}
              fill="none"
              stroke={corDaSerie(iS)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.referencia ? '5 4' : undefined}
              opacity={s.referencia ? 0.85 : 1}
            />
          ))}
        </g>

        {ativo !== null &&
          series.map((s, iS) => {
            const p = s.pontos[ativo];
            return p ? (
              <circle key={s.nome} cx={x(ativo)} cy={y(p.valor)} r={5} fill={corDaSerie(iS)} className="gr__marcador" />
            ) : null;
          })}
      </svg>

      {ativo !== null && (
        <div className="gr__tooltip" style={{ left: `${(x(ativo) / L) * 100}%` }} role="status">
          <strong>{periodos[ativo]}</strong>
          {series.map((s, i) => (
            <span key={s.nome}>
              <i className="gr__marca" style={{ background: corDaSerie(i) }} aria-hidden="true" />
              {s.nome}: {formatar(s.pontos[ativo]?.valor ?? 0)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════ Barras verticais ══════════════════════════

interface PropsColunas {
  series: SerieGrafico[];
  formatar: (v: number) => string;
  formatarEixo?: (v: number) => string;
  empilhado?: boolean;
  altura?: number;
  /** Clique numa coluna, com o rótulo do período. Sem isto, gráfico de leitura. */
  aoClicar?: (periodo: string) => void;
}

/** Colunas por período, agrupadas ou empilhadas. */
export function GraficoColunas({
  series,
  formatar,
  formatarEixo,
  empilhado = false,
  altura = 280,
  aoClicar,
}: PropsColunas): React.JSX.Element {
  const [ativo, setAtivo] = useState<number | null>(null);

  const A = altura;
  const areaL = L - M.esq - M.dir;
  const areaA = A - M.topo - M.baixo;

  const periodos = series[0]?.pontos.map((p) => p.periodo) ?? [];
  const n = periodos.length;

  // Marcas redondas: passo 1, 2, 2,5 ou 5 × 10ⁿ, de 3 a 5 divisões, topo mais perto do máximo.
  const { max, marcas } = useMemo(() => {
    const bruto = empilhado
      ? Math.max(...periodos.map((_, i) => series.reduce((s, sr) => s + (sr.pontos[i]?.valor ?? 0), 0)), 1)
      : Math.max(...series.flatMap((s) => s.pontos.map((p) => p.valor)), 1);
    const inteiros = series.every((s) => s.pontos.every((p) => Number.isInteger(p.valor)));
    const alvo = bruto * 1.04;
    const base = 10 ** Math.floor(Math.log10(alvo));
    const candidatos = [base / 100, base / 10, base, base * 10]
      .flatMap((p10) => [1, 2, 2.5, 5].map((f) => f * p10))
      // Contagem não tem marca "0,25": com dados inteiros, o passo mínimo é 1.
      .filter((p) => !inteiros || (p >= 1 && Number.isInteger(p)))
      .map((p) => ({ passo: p, divisoes: Math.ceil(alvo / p) }))
      .filter((c) => c.divisoes >= 3 && c.divisoes <= 5)
      .sort((a, b) => a.passo * a.divisoes - b.passo * b.divisoes || a.divisoes - b.divisoes);
    const passo = candidatos[0]?.passo ?? Math.max(1, alvo / 4);
    const topo = passo * Math.ceil(alvo / passo);
    return { max: topo, marcas: Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => passo * i) };
  }, [series, periodos, empilhado]);
  const y = (v: number): number => M.topo + areaA - (v / max) * areaA;

  const larguraGrupo = areaL / n;
  const larguraBarra = empilhado
    ? Math.min(larguraGrupo * 0.6, 40)
    : Math.min((larguraGrupo * 0.72) / series.length, 26);

  const passoRotulo = n > 14 ? Math.ceil(n / 8) : 1;

  return (
    <div className="gr">
      {series.length > 1 && <Legenda itens={series.map((s, i) => ({ nome: s.nome, cor: corDaSerie(i) }))} />}

      <svg viewBox={`0 0 ${L} ${A}`} className="gr__svg" role="img" aria-label="Gráfico de colunas">
        {marcas.map((m) => (
          <g key={m}>
            <line x1={M.esq} x2={L - M.dir} y1={y(m)} y2={y(m)} className="gr__grade" />
            <text x={M.esq - 10} y={y(m) + 4} textAnchor="end" className="gr__eixo">
              {formatadorDoEixo(formatar, formatarEixo)(m)}
            </text>
          </g>
        ))}

        {periodos.map((p, i) => {
          const centro = M.esq + larguraGrupo * (i + 0.5);
          let acumulado = 0;

          return (
            <g
              key={p}
              onMouseEnter={() => setAtivo(i)}
              onMouseLeave={() => setAtivo(null)}
              onClick={aoClicar ? () => aoClicar(p) : undefined}
              onKeyDown={
                aoClicar
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        aoClicar(p);
                      }
                    }
                  : undefined
              }
              tabIndex={aoClicar ? 0 : undefined}
              role={aoClicar ? 'button' : undefined}
              aria-label={aoClicar ? `${p} — abrir detalhe` : undefined}
              className={`${ativo === i ? 'gr__grupo gr__grupo--ativo' : 'gr__grupo'}${
                aoClicar ? ' gr__grupo--clicavel' : ''
              }`}
            >
              {/* Alvo do clique na faixa inteira: barra baixa seria impossível de acertar. */}
              <rect x={centro - larguraGrupo / 2} y={M.topo} width={larguraGrupo} height={areaA} fill="transparent" />

              {series.map((s, iS) => {
                const v = s.pontos[i]?.valor ?? 0;
                const alturaBarra = Math.max(0, (v / max) * areaA);

                const xBarra = empilhado
                  ? centro - larguraBarra / 2
                  : centro - (larguraBarra * series.length) / 2 + larguraBarra * iS;

                const yBarra = empilhado ? y(acumulado + v) : y(v);
                acumulado += v;

                return (
                  <rect
                    key={s.nome}
                    x={xBarra}
                    y={yBarra}
                    // 2px de respiro: sem ele, dois tons próximos viram um bloco.
                    width={Math.max(1, larguraBarra - 2)}
                    height={Math.max(0, alturaBarra - (empilhado ? 2 : 0))}
                    rx={3}
                    fill={corDaSerie(iS)}
                  />
                );
              })}

              {i % passoRotulo === 0 && (
                <text x={centro} y={A - 12} textAnchor="middle" className="gr__eixo">
                  {p}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {ativo !== null && (
        <div
          className="gr__tooltip"
          style={{ left: `${((M.esq + larguraGrupo * (ativo + 0.5)) / L) * 100}%` }}
          role="status"
        >
          <strong>{periodos[ativo]}</strong>
          {series.map((s, i) => (
            <span key={s.nome}>
              <i className="gr__marca" style={{ background: corDaSerie(i) }} aria-hidden="true" />
              {s.nome}: {formatar(s.pontos[ativo]?.valor ?? 0)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════ Barras horizontais ══════════════════════════

export interface ItemBarra {
  rotulo: string;
  valor: number;
  anterior?: number;
}

interface PropsBarras {
  dados: ItemBarra[];
  formatar: (v: number) => string;
  /** Mostra a coluna de participação no total. */
  mostrarParticipacao?: boolean;
  /** Mostra a variação contra `anterior`. */
  mostrarVariacao?: boolean;
  /** Colore cada barra com um slot diferente — só quando a categoria É a identidade. */
  colorido?: boolean;
  limite?: number;
  /** Clique numa barra; sem isto, gráfico de leitura (sem cursor de mão). */
  aoClicar?: (rotulo: string) => void;
}

/** Comparação de magnitude entre categorias. Tom único por padrão. */
export function BarrasHorizontais({
  dados,
  formatar,
  mostrarParticipacao = true,
  mostrarVariacao = false,
  colorido = false,
  limite,
  aoClicar,
}: PropsBarras): React.JSX.Element {
  const [ativo, setAtivo] = useState<number | null>(null);

  const lista = limite ? dados.slice(0, limite) : dados;
  const maximo = Math.max(...lista.map((d) => d.valor), 0);
  const total = dados.reduce((s, d) => s + d.valor, 0);

  return (
    <div className="barras">
      {lista.map((item, i) => {
        const proporcao = maximo > 0 ? item.valor / maximo : 0;
        const parte = total > 0 ? (item.valor / total) * 100 : 0;
        const variacao =
          item.anterior !== undefined && item.anterior !== 0
            ? ((item.valor - item.anterior) / Math.abs(item.anterior)) * 100
            : null;

        return (
          <div
            key={item.rotulo}
            className={`barras__linha${ativo === i ? ' barras__linha--ativa' : ''}${
              aoClicar ? ' barras__linha--clicavel' : ''
            }`}
            onMouseEnter={() => setAtivo(i)}
            onMouseLeave={() => setAtivo(null)}
            onFocus={() => setAtivo(i)}
            onBlur={() => setAtivo(null)}
            onClick={aoClicar ? () => aoClicar(item.rotulo) : undefined}
            onKeyDown={
              aoClicar
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      aoClicar(item.rotulo);
                    }
                  }
                : undefined
            }
            tabIndex={0}
            role={aoClicar ? 'button' : 'group'}
            aria-label={`${item.rotulo}: ${formatar(item.valor)}, ${parte.toFixed(1)}% do total${
              aoClicar ? ' — abrir detalhe' : ''
            }`}
          >
            <span className="barras__categoria">{item.rotulo}</span>

            <span className="barras__trilho">
              <span
                className="barras__preenchimento"
                style={{
                  inlineSize: `${proporcao * 100}%`,
                  background: colorido ? CORES[i % CORES.length] : undefined,
                }}
              />
            </span>

            <span className="barras__valor">{formatar(item.valor)}</span>

            {mostrarVariacao && (
              <span
                className={`barras__variacao${
                  variacao === null ? '' : variacao >= 0 ? ' barras__variacao--alta' : ' barras__variacao--baixa'
                }`}
              >
                {variacao === null ? '—' : `${variacao >= 0 ? '↑' : '↓'} ${Math.abs(variacao).toFixed(1)}%`}
              </span>
            )}

            {mostrarParticipacao && (
              <span className="barras__participacao">{parte.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════ Sazonalidade ══════════════════════════

/** Índices sazonais como desvio da média (barras a partir de 100%, para cima e para baixo). */
export function GraficoSazonalidade({ indices }: { indices: number[] }): React.JSX.Element {
  const desvios = indices.map((v) => (v - 1) * 100);
  const maxAbs = Math.max(...desvios.map(Math.abs), 5);

  return (
    <div className="sazonal">
      {desvios.map((d, i) => {
        const acima = d >= 0;
        const proporcao = Math.abs(d) / maxAbs;

        return (
          <div key={MESES_CURTOS[i]} className="sazonal__coluna" title={`${MESES_CURTOS[i]}: ${d >= 0 ? '+' : ''}${d.toFixed(0)}% da média`}>
            <div className="sazonal__area sazonal__area--cima">
              {acima && <div className="sazonal__barra sazonal__barra--cima" style={{ height: `${proporcao * 100}%` }} />}
            </div>

            <div className="sazonal__base" />

            <div className="sazonal__area sazonal__area--baixo">
              {!acima && <div className="sazonal__barra sazonal__barra--baixo" style={{ height: `${proporcao * 100}%` }} />}
            </div>

            <span className="sazonal__mes">{MESES_CURTOS[i]}</span>
            <span className={`sazonal__valor${acima ? '' : ' sazonal__valor--baixo'}`}>
              {d >= 0 ? '+' : ''}
              {d.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════ Medidor de meta ══════════════════════════

interface PropsMedidor {
  meta: number;
  realizado: number;
  formatar: (v: number) => string;
  /** Ritmo esperado a esta altura do período, em % — desenha a marca de ritmo. */
  esperado?: number;
}

/** Atingimento de meta, com marca de ritmo esperado. */
export function MedidorMeta({ meta, realizado, formatar, esperado }: PropsMedidor): React.JSX.Element {
  const atingimento = meta === 0 ? 0 : (realizado / meta) * 100;
  const gap = realizado - meta;

  const estado = atingimento >= 100 ? 'bom' : esperado !== undefined && atingimento < esperado - 5 ? 'ruim' : 'atencao';

  return (
    <div className="medidor">
      <div className="medidor__topo">
        <strong className={`medidor__percentual medidor__percentual--${estado}`}>
          {atingimento.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
        </strong>
        <span className="texto-discreto">
          {formatar(realizado)} de {formatar(meta)}
        </span>
      </div>

      <div className="medidor__trilho">
        <div
          className={`medidor__preenchimento medidor__preenchimento--${estado}`}
          style={{ inlineSize: `${Math.min(100, atingimento)}%` }}
        />
        {esperado !== undefined && esperado < 100 && (
          <div className="medidor__ritmo" style={{ insetInlineStart: `${esperado}%` }} title={`Ritmo esperado: ${esperado.toFixed(0)}%`} />
        )}
      </div>

      <div className="medidor__rodape">
        <span className={gap >= 0 ? 'medidor__gap medidor__gap--bom' : 'medidor__gap medidor__gap--ruim'}>
          {gap >= 0 ? 'Acima da meta em ' : 'Faltam '}
          {formatar(Math.abs(gap))}
        </span>
        {esperado !== undefined && <span className="texto-discreto">ritmo esperado: {esperado.toFixed(0)}%</span>}
      </div>
    </div>
  );
}

// ══════════════════════════ Auxiliares ══════════════════════════

function Legenda({ itens }: { itens: { nome: string; cor: string }[] }): React.JSX.Element {
  return (
    <ul className="gr__legenda">
      {itens.map((i) => (
        <li key={i.nome}>
          <i className="gr__marca" style={{ background: i.cor }} aria-hidden="true" />
          {i.nome}
        </li>
      ))}
    </ul>
  );
}

export { TileKpi } from '@/components/graficos/TileKpi';

// ══════════════════════════ Rosca (parte do todo) ══════════════════════════

interface PropsRosca {
  dados: ItemBarra[];
  formatar?: (v: number) => string;
  /** Lado da rosca, em px. Pequena de propósito: mora em cartão baixo. */
  tamanho?: number;
}

/**
 * Parte de um todo, para POUCAS fatias (até ~6). A legenda em texto é
 * obrigatória: alguns tons ficam abaixo de 3:1 no modo claro.
 */
export function GraficoRosca({ dados, formatar = formatarReais, tamanho = 104 }: PropsRosca): React.JSX.Element {
  const fatias = dados.filter((d) => d.valor > 0);
  const total = fatias.reduce((t, d) => t + d.valor, 0);

  if (total <= 0) return <p className="texto-discreto">Sem valores para mostrar.</p>;

  // Circunferência 100 (r = 15,9155): o traço é o próprio percentual; offset 25 = 12 horas.
  let acumulado = 0;
  const arcos = fatias.map((d, i) => {
    const pct = (d.valor / total) * 100;
    const arco = { ...d, pct, cor: CORES[i % CORES.length]!, offset: 25 - acumulado };
    acumulado += pct;
    return arco;
  });

  const percentual = (p: number): string =>
    `${p.toLocaleString('pt-BR', { maximumFractionDigits: p < 10 ? 1 : 0 })}%`;

  return (
    <div className="rosca">
      <svg
        className="rosca__grafico"
        width={tamanho}
        height={tamanho}
        viewBox="0 0 42 42"
        role="img"
        aria-label={arcos.map((a) => `${a.rotulo}: ${formatar(a.valor)}`).join('; ')}
      >
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--border)" strokeWidth="5" />
        {arcos.map((a) => (
          <circle
            key={a.rotulo}
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            stroke={a.cor}
            strokeWidth="5"
            strokeDasharray={`${a.pct} ${100 - a.pct}`}
            strokeDashoffset={a.offset}
          >
            <title>{`${a.rotulo}: ${formatar(a.valor)} (${percentual(a.pct)})`}</title>
          </circle>
        ))}
        {/* Dinheiro vai compacto; contagem usa o formatador dado. */}
        <text x="21" y="22.6" textAnchor="middle" className="rosca__total">
          {formatar === formatarReais ? formatarReaisCompacto(total) : formatar(total)}
        </text>
      </svg>

      <ul className="rosca__legenda">
        {arcos.map((a) => (
          <li key={a.rotulo}>
            <span className="rosca__cor" style={{ background: a.cor }} aria-hidden="true" />
            <span className="rosca__nome">{a.rotulo}</span>
            <span className="rosca__pct">{percentual(a.pct)}</span>
            <span className="rosca__valor">{formatar(a.valor)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
