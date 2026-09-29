import { api } from '@/lib/api';
import type { ContagemDaCarteira } from '@/lib/filaCadastro';

/** Cliente dos painéis de BI. */

export interface Fatia {
  rotulo: string;
  valor: number;
  quantidade?: number;
}

export interface Ponto {
  periodo: string;
  valor: number;
}

/** O que TEM origem de dados hoje — apurado no servidor, vira `true` sozinho quando o dado chega. */
export interface Disponibilidade {
  producao: boolean;
  premio: boolean;
  /** Há apólice e nenhuma tem prêmio: a unidade da tela vira APÓLICE (≠ base vazia). */
  medirEmApolices: boolean;
  serieProducao: boolean;
  /** Série mensal por CONTAGEM — existe mesmo sem prêmio. */
  serieApolices: boolean;
  /** Há base anterior à janela — a tela precisa explicar o corte. */
  serieRecortada: boolean;
  producaoPorSeguradora: boolean;
  /** Dá para agrupar por ramo, nem que seja contando apólices. */
  apolicesPorRamo: boolean;
  premioPorRamo: boolean;
  ramoPorCliente: boolean;
  carteira: boolean;
  clientesSemApoliceImportada: boolean;
  saidasDeClientes: boolean;
  /** Há entrada ou saída DATADA para pendurar o ponto da série. */
  movimentoDeClientes: boolean;
  renovacoes: boolean;
  historicoRenovacao: boolean;
  tipoNegocio: boolean;
  receita: boolean;
  serieReceita: boolean;
  receitaPorFilial: boolean;
  comissaoPorApolice: boolean;
  frequenciaDeContratacao: boolean;
  crossSell: boolean;
  producaoPorVendedor: boolean;
  producaoPorCanal: boolean;
  /** Sim/não por apólice: dá FREQUÊNCIA, nunca sinistralidade. */
  frequenciaDeSinistro: boolean;
  propostas: boolean;
  metas: boolean;
  producaoPorFilial: boolean;
  sinistros: boolean;
  veiculos: boolean;
  previsoes: boolean;
}

export interface DadosPaineis {
  producao: {
    apolices: number;
    comPremio: number;
    premioTotal: number;
    ticketMedio: number | null;
    movimentos: Fatia[];

    /** Meses da série (12): a origem só traz vigentes, uma série maior desenharia crescimento falso. */
    janelaMeses: number;
    porMes: {
      periodo: string;
      apolices: number;
      premio: number;
      novos: number;
      renovacoes: number;
      /** Mês ainda correndo: a barra é pontilhada e o rótulo diz "parcial". */
      parcial: boolean;
    }[];
    /** O que o corte deixou de fora, para a tela poder explicá-lo. */
    foraDaJanela: { apolices: number; meses: number; premio: number };

    porSeguradora: Fatia[];
    porProduto: Fatia[];
    porRamo: Fatia[];
    porVendedor: Fatia[];
    /** Por onde a venda entrou — "Grupo de Produção" na origem. */
    porCanal: Fatia[];
    porTipoNegocio: { rotulo: string; apolices: number; premio: number }[];
  };
  renovacoes: {
    total: number;
    em30: number;
    em60: number;
    em90: number;
    /** Prêmio de TODA apólice em vigor — a carteira, não o risco. */
    premioEmRisco: number;
    /** Prêmio do que vence em até 90 dias. Opcional: backend anterior não manda. */
    premioEm90?: number;
    jaRenovadas: number;
    canceladas: number;
    /** Renovações ÷ classificadas na janela; NULL quando a classificação não cobre a janela. */
    proporcaoRenovacao: number | null;
    /** Apólices da janela com novo/renovação informado, e o total dela. */
    classificacaoTipoNegocio?: { classificadas: number; naJanela: number };
    /** Vencimentos do mês atual aos próximos 11, por seguradora. */
    porMes?: { periodo: string; seguradora: string; apolices: number; premio: number }[];
    proximas: {
      numero: string;
      segurado: string;
      seguradora: string;
      produto: string | null;
      vigenciaFim: string | null;
      premio: number | null;
      diasParaVencer: number;
      clienteUuid: string | null;
      corretor: string | null;
      telefone: string | null;
      email: string | null;
    }[];
    /** Quantas da fila não têm telefone nem e-mail — sem isso não dá para ligar. */
    semContato: number;
  };
  /** Comissão por apólice (bruta, com cliente) — NÃO soma com `receita` (demonstrativo líquido). */
  comissaoCarteira: {
    apolices: number;
    total: number;
    /** Ponderado pelo prêmio, não média das porcentagens. */
    percentualMedio: number | null;
    porMes: Ponto[];
    porSeguradora: Fatia[];
    porVendedor: Fatia[];
    porRamo: Fatia[];
  };

  receita: {
    competencias: string[];
    bruto: number;
    impostos: number;
    liquido: number;
    porFilial: Fatia[];
    porCompetencia: Ponto[];
    porSeguradora: Fatia[];
    /** Total por tipo de lançamento, como a companhia nomeia (separa acerto retroativo do recorrente). */
    porTipo: Fatia[];
    /** Soma por tipo dentro de cada competência. */
    porCompetenciaTipo: { periodo: string; rotulo: string; valor: number }[];
    /** Uma linha por competência, como o extrato: a contagem de ordens denuncia arquivo faltante. */
    fechamento: {
      competencia: string;
      ordens: number;
      primeiro: string | null;
      ultimo: string | null;
      bruto: number;
      impostos: number;
      liquido: number;
    }[];
  };
  /** Situação por grupo de cliente (chave → contagem). Opcional: backend anterior não manda. */
  carteiras?: Record<string, ContagemDaCarteira>;
  /** Os grupos de cliente (057). Ler com `gruposDoPayload`: backend anterior não manda. */
  grupos?: unknown;
  /** Só a CORRETORA (os grupos que somam). */
  carteira: {
    total: number;
    /** Na carteira, somando quem tem apólice em vigor e quem não teve apólice importada. */
    ativos: number;
    comApoliceVigente: number;
    /** É cliente, mas nenhuma apólice dele foi importada. */
    semApoliceConhecida: number;
    inativos: number;
    prospectos: number;
    inadimplentes: number;
    novosNoAno: number;
    perdidosNoAno: number;
  };
  movimento: { periodo: string; novos: number; perdidos: number }[];
  clientes: {
    porApolices: { apolices: number; clientes: number }[];
    /** `exclusivos` = clientes que só têm aquele ramo: é onde o cross-sell mora. */
    crossSell: { ramo: string; clientes: number; exclusivos: number }[];
  };
  /** `valor` = apólices com sinistro · `quantidade` = total do ramo. */
  /** `assistencias` = apólices que acionaram assistência, contadas à parte. */
  sinistroPorRamo: (Fatia & { assistencias?: number })[];
  ramosPorCliente: Fatia[];
  seguradorasPorCliente: Fatia[];
  disponivel: Disponibilidade;
  recorte: {
    carteiraPropria: boolean;
    semCarteira: boolean;
    comissoesTodas: boolean;
  };
  /** Apólices a renovar que a seguradora lista e a base ainda não tem (Bradesco). Opcional. */
  renovacoesSeguradora?: RenovacaoDaSeguradora[];
  /** Apólices encerradas que a seguradora lista (Bradesco). Opcional. */
  encerradasSeguradora?: EncerradaDaSeguradora[];
  /** Visão geral padrão do papel; `null` = vale o catálogo. Opcional. */
  visaoGeralPadrao?: string[] | null;
  /** Comissão do mês corrente (mesmos números da tela de Comissões); só com `comissoes.todas`. */
  comissaoMes?: { recebido: number; aReceber: number; emAtraso: number } | null;
  /** Resumo do atraso — só para quem tem `inadimplencia.ler`. */
  inadimplencia?: {
    valorEmAtraso: number;
    parcelasAtrasadas: number;
    clientesInadimplentes: number;
    parcelasAtrasoGrave: number;
    valorAtrasoGrave: number;
  } | null;
}

export interface EncerradaDaSeguradora {
  seguradora: string;
  numeroApolice: string;
  nomeSegurado: string;
  placa: string | null;
  teveEndosso: boolean | null;
  vigenciaInicio: string | null;
  vigenciaFim: string;
  clienteId: string | null;
  vinculoOrigem: 'apolice' | 'renovacao' | 'nome' | null;
  produtor: string | null;
  /** `sem_renovacao` = prazo cheio sem apólice nova na base, o que NÃO é o mesmo que perdida. */
  desfecho: 'renovada' | 'antes_do_prazo' | 'sem_renovacao';
  renovadaPor: { numero: string; seguradora: string; vigenciaInicio: string | null } | null;
}

export interface RenovacaoDaSeguradora {
  seguradora: string;
  numeroApolice: string;
  vigenciaFim: string;
  nomeSegurado: string;
  clienteId: string | null;
  vinculoOrigem: 'apolice' | 'nome' | null;
  produtor: string | null;
  percentualComissao: number | null;
  veiculo: string | null;
  placa: string | null;
  sinistros: number | null;
  classeBonus: number | null;
  /** Calculado pela companhia; nulo quando o portal ainda não calculou. */
  premioRenovacao: number | null;
  cotadoOutroCorretor: boolean;
}

/** Um consultor (produtor) que o usuário pode escolher no filtro. */
export interface Consultor {
  id: number;
  nome: string;
  ativo: boolean;
  /** Clientes na carteira dele. */
  clientes: number;
}

export const paineisApi = {
  /** `produtor` estreita à carteira de um consultor; o servidor recusa o que não é de quem pede. */
  carregar: (produtor?: string) =>
    api.get<DadosPaineis>(`/paineis${produtor ? `?produtor=${encodeURIComponent(produtor)}` : ''}`),
  consultores: () => api.get<{ consultores: Consultor[]; baseInteira: boolean }>('/paineis/consultores'),
  comparativo: (mes: string, produtor?: string) => {
    const q = new URLSearchParams({ mes });
    if (produtor) q.set('produtor', produtor);
    return api.get<Comparativo>(`/paineis/comparativo?${q.toString()}`);
  },
  cancelamentos: (produtor?: string) =>
    api.get<Cancelamentos>(`/paineis/cancelamentos${produtor ? `?produtor=${encodeURIComponent(produtor)}` : ''}`),
};

/** Clientes com apólice cancelada num período — e, destes, os sem apólice em vigor hoje. */
export interface ContagemCancelados {
  clientes: number;
  perdidos: number;
  apolices: number;
}

/** Janelas de 1 a 4 meses FECHADOS e o mês em andamento. Campos novos no FIM, lidos com `Array.isArray`. */
export interface Cancelamentos {
  mesCorrente: string;
  ultimoFechado: string;
  janelas: (ContagemCancelados & { meses: number; de: string; ate: string })[];
  mesAtual: ContagemCancelados & { mes: string };
  porMes: { mes: string; clientes: number; perdidos: number }[];
  porSeguradora: { seguradora: string; clientes: number; apolices: number }[];
  semData: { apolices: number; clientes: number };
}

/** Um lado da comparação: o valor, ou `null` com o motivo (a base não cobre). */
export interface LadoComparativo<T> {
  valor: T | null;
  motivo: string | null;
}

export interface NumerosDoMes {
  renovadas: LadoComparativo<{ apolices: number; premio: number; comPremio: number }>;
  vencidas: LadoComparativo<{ venceram: number; renovaram: number }>;
  novosClientes: LadoComparativo<number>;
  carteiraAtiva: LadoComparativo<number>;
}

/** Cards "este ano × ano passado". */
export interface Comparativo {
  mes: string;
  anterior: string;
  emAndamento: boolean;
  /** Mês em andamento: os dois anos cortados neste dia. */
  ateDia: number | null;
  coberturaDesde: string | null;
  atual: NumerosDoMes;
  anoPassado: NumerosDoMes;
}
