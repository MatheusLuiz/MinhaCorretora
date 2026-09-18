/** Estatística das análises do BI: métodos simples e explicáveis, calculados de verdade sobre a série. */

export interface Ponto {
  /** Rótulo do período, ex.: "jan/25". */
  periodo: string;
  valor: number;
}

// ─────────────────────────── Tendência ───────────────────────────

export interface Tendencia {
  /** Variação média por período (coeficiente angular). */
  inclinacao: number;
  intercepto: number;
  /** 0 a 1 — quanto da variação a reta explica. */
  r2: number;
  /** Variação percentual por período, sobre a média da série. */
  variacaoPercentual: number;
  direcao: 'alta' | 'baixa' | 'estavel';
}

/** Regressão linear por mínimos quadrados; o `r2` acompanha para a tela dizer quando a reta não descreve nada (< ~0,3). */
export function calcularTendencia(valores: number[]): Tendencia {
  const n = valores.length;

  if (n < 2) {
    return { inclinacao: 0, intercepto: valores[0] ?? 0, r2: 0, variacaoPercentual: 0, direcao: 'estavel' };
  }

  const somaX = (n * (n - 1)) / 2;
  const somaY = valores.reduce((s, v) => s + v, 0);
  const mediaX = somaX / n;
  const mediaY = somaY / n;

  let numerador = 0;
  let denominador = 0;

  for (let i = 0; i < n; i += 1) {
    numerador += (i - mediaX) * (valores[i]! - mediaY);
    denominador += (i - mediaX) ** 2;
  }

  const inclinacao = denominador === 0 ? 0 : numerador / denominador;
  const intercepto = mediaY - inclinacao * mediaX;

  let ssTotal = 0;
  let ssResiduo = 0;

  for (let i = 0; i < n; i += 1) {
    const previsto = intercepto + inclinacao * i;
    ssTotal += (valores[i]! - mediaY) ** 2;
    ssResiduo += (valores[i]! - previsto) ** 2;
  }

  const r2 = ssTotal === 0 ? 0 : Math.max(0, 1 - ssResiduo / ssTotal);
  const variacaoPercentual = mediaY === 0 ? 0 : (inclinacao / mediaY) * 100;

  return {
    inclinacao,
    intercepto,
    r2,
    variacaoPercentual,
    // Menos de 0,5% por período é ruído, não tendência.
    direcao: Math.abs(variacaoPercentual) < 0.5 ? 'estavel' : variacaoPercentual > 0 ? 'alta' : 'baixa',
  };
}

// ─────────────────────────── Sazonalidade ───────────────────────────

export interface Sazonalidade {
  /** Índice por mês (0 = janeiro). 1,0 = na média; 1,2 = 20% acima. */
  indices: number[];
  mesMaisForte: number;
  mesMaisFraco: number;
  /** Amplitude entre o melhor e o pior mês, em pontos percentuais. */
  amplitude: number;
}

/** Índices sazonais por média móvel centrada (remove a tendência antes). Exige ao menos 24 meses. */
export function calcularSazonalidade(pontos: Ponto[], mesInicial = 0): Sazonalidade | null {
  if (pontos.length < 24) return null;

  const valores = pontos.map((p) => p.valor);
  const janela = 12;
  const razoes: number[][] = Array.from({ length: 12 }, () => []);

  for (let i = janela / 2; i < valores.length - janela / 2; i += 1) {
    // Média móvel centrada de 12: as pontas entram com meio peso para a janela ficar simétrica.
    let soma = 0;
    for (let k = -janela / 2; k <= janela / 2; k += 1) {
      const peso = Math.abs(k) === janela / 2 ? 0.5 : 1;
      soma += valores[i + k]! * peso;
    }
    const media = soma / janela;
    if (media === 0) continue;

    // O índice é o mês do CALENDÁRIO, não a posição na série (que pode começar em outubro).
    razoes[(mesInicial + i) % 12]!.push(valores[i]! / media);
  }

  const brutos = razoes.map((lista) =>
    lista.length === 0 ? 1 : lista.reduce((s, v) => s + v, 0) / lista.length,
  );

  // Normaliza para a média dos índices ser 1; senão o viés reaparece no forecast.
  const mediaBrutos = brutos.reduce((s, v) => s + v, 0) / 12;
  const indices = brutos.map((v) => (mediaBrutos === 0 ? 1 : v / mediaBrutos));

  let maisForte = 0;
  let maisFraco = 0;
  indices.forEach((v, i) => {
    if (v > indices[maisForte]!) maisForte = i;
    if (v < indices[maisFraco]!) maisFraco = i;
  });

  return {
    indices,
    mesMaisForte: maisForte,
    mesMaisFraco: maisFraco,
    amplitude: (indices[maisForte]! - indices[maisFraco]!) * 100,
  };
}

// ─────────────────────────── Projeção ───────────────────────────

export interface PontoProjetado extends Ponto {
  /** Limites do intervalo de confiança aproximado. */
  minimo: number;
  maximo: number;
}

export interface Projecao {
  pontos: PontoProjetado[];
  /** 'alta' quando a série é bem descrita pela tendência. */
  confianca: 'alta' | 'media' | 'baixa';
  metodo: string;
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Projeta tendência + sazonalidade; a faixa (RMSE) alarga a cada período e a `confianca` vem do r². */
export function projetar(pontos: Ponto[], periodos: number, mesInicial = 0): Projecao {
  const valores = pontos.map((p) => p.valor);
  const tendencia = calcularTendencia(valores);
  const sazonalidade = calcularSazonalidade(pontos, mesInicial);

  // Erro típico da reta sobre o próprio histórico.
  let somaErro2 = 0;
  for (let i = 0; i < valores.length; i += 1) {
    const previsto = tendencia.intercepto + tendencia.inclinacao * i;
    somaErro2 += (valores[i]! - previsto) ** 2;
  }
  const rmse = Math.sqrt(somaErro2 / valores.length);

  const projetados: PontoProjetado[] = [];

  for (let k = 1; k <= periodos; k += 1) {
    const indice = valores.length - 1 + k;
    const base = tendencia.intercepto + tendencia.inclinacao * indice;

    const mes = (mesInicial + indice) % 12;
    const fator = sazonalidade ? sazonalidade.indices[mes]! : 1;
    const valor = Math.max(0, base * fator);

    // A incerteza cresce com a raiz do horizonte.
    const margem = rmse * Math.sqrt(k) * 1.96;

    projetados.push({
      periodo: MESES_CURTOS[mes]!,
      valor,
      minimo: Math.max(0, valor - margem),
      maximo: valor + margem,
    });
  }

  return {
    pontos: projetados,
    confianca: tendencia.r2 >= 0.6 ? 'alta' : tendencia.r2 >= 0.3 ? 'media' : 'baixa',
    metodo: sazonalidade
      ? 'Tendência linear com ajuste sazonal de 24 meses'
      : 'Tendência linear (histórico insuficiente para sazonalidade)',
  };
}

// ─────────────────────────── Média móvel ───────────────────────────

/** Suaviza a série para revelar o movimento por trás da oscilação mensal. */
export function mediaMovel(pontos: Ponto[], janela = 3): Ponto[] {
  return pontos.map((p, i) => {
    const inicio = Math.max(0, i - janela + 1);
    const fatia = pontos.slice(inicio, i + 1);
    return {
      periodo: p.periodo,
      valor: fatia.reduce((s, x) => s + x.valor, 0) / fatia.length,
    };
  });
}

// ─────────────────────────── Renovação ───────────────────────────

export interface FatoresRenovacao {
  /** Quantas vezes o cliente já renovou. */
  renovacoesAnteriores: number;
  /** Anos de relacionamento. */
  anosDeCasa: number;
  /** Teve sinistro na vigência? */
  teveSinistro: boolean;
  /** Variação do prêmio na renovação, em %. */
  variacaoPremio: number;
  /** Tem mais de um produto conosco? */
  produtosAtivos: number;
}

export interface ProbabilidadeRenovacao {
  probabilidade: number;
  faixa: 'alta' | 'media' | 'baixa';
  fatores: { rotulo: string; efeito: number }[];
}

/** Probabilidade de renovação: modelo aditivo com pesos do setor, cada fator exposto com seu efeito. */
export function probabilidadeRenovacao(f: FatoresRenovacao): ProbabilidadeRenovacao {
  const fatores: { rotulo: string; efeito: number }[] = [];
  let p = 0.55; // base: renovação sem nenhuma informação a favor ou contra

  const fidelidade = Math.min(f.renovacoesAnteriores * 0.08, 0.24);
  if (fidelidade > 0) {
    p += fidelidade;
    fatores.push({ rotulo: `${f.renovacoesAnteriores} renovação(ões) anterior(es)`, efeito: fidelidade });
  }

  const tempo = Math.min(f.anosDeCasa * 0.02, 0.1);
  if (tempo > 0) {
    p += tempo;
    fatores.push({ rotulo: `${f.anosDeCasa} ano(s) de relacionamento`, efeito: tempo });
  }

  if (f.produtosAtivos > 1) {
    const multi = Math.min((f.produtosAtivos - 1) * 0.06, 0.12);
    p += multi;
    fatores.push({ rotulo: `${f.produtosAtivos} produtos ativos`, efeito: multi });
  }

  if (f.teveSinistro) {
    // Sinistro atendido costuma FIDELIZAR: o efeito é positivo.
    p += 0.05;
    fatores.push({ rotulo: 'Teve sinistro atendido na vigência', efeito: 0.05 });
  }

  if (f.variacaoPremio > 5) {
    const impacto = -Math.min((f.variacaoPremio - 5) * 0.012, 0.3);
    p += impacto;
    fatores.push({ rotulo: `Prêmio subiu ${f.variacaoPremio.toFixed(0)}%`, efeito: impacto });
  } else if (f.variacaoPremio < -5) {
    p += 0.06;
    fatores.push({ rotulo: `Prêmio caiu ${Math.abs(f.variacaoPremio).toFixed(0)}%`, efeito: 0.06 });
  }

  const probabilidade = Math.max(0.02, Math.min(0.98, p));

  return {
    probabilidade,
    faixa: probabilidade >= 0.7 ? 'alta' : probabilidade >= 0.45 ? 'media' : 'baixa',
    fatores: fatores.sort((a, b) => Math.abs(b.efeito) - Math.abs(a.efeito)),
  };
}

// ─────────────────────────── Auxiliares ───────────────────────────

export function somar(valores: number[]): number {
  return valores.reduce((s, v) => s + v, 0);
}

export function variacaoPercentual(atual: number, anterior: number): number {
  if (anterior === 0) return atual === 0 ? 0 : 100;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

/** Participação de cada item no total, em porcentagem. */
export function participacao<T>(itens: T[], valor: (item: T) => number): number[] {
  const total = somar(itens.map(valor));
  return itens.map((i) => (total === 0 ? 0 : (valor(i) / total) * 100));
}

export { MESES_CURTOS };
