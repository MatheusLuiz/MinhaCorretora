import { api } from '@/lib/api';

/** Previsão de entrada (`GET /financeiro/previsao`). Exige `comissoes.todas`. */

export interface PendenteSeguradora {
  seguradora: string;
  parcelas: number;
  /** Parcelas com taxa de comissão conhecida — as que entram em `comissao`. */
  comTaxaParcelas: number;
  /** Comissão ESTIMADA, só das parcelas com taxa. */
  comissao: number;
  semTaxaParcelas: number;
  /** VALOR das parcelas sem taxa (é prêmio, não comissão): fica fora da soma. */
  semTaxaValor: number;
}

export interface SemanaPrevista {
  /** Segunda-feira da semana ISO, AAAA-MM-DD. */
  inicio: string;
  fim: string;
  porSeguradora: PendenteSeguradora[];
}

export interface MesPrevisto {
  mes: string;
  porSeguradora: PendenteSeguradora[];
}

export interface JanelaPrevista {
  dias: number;
  comissao: number;
  comTaxaParcelas: number;
  semTaxaParcelas: number;
  semTaxaValor: number;
}

export type PadraoPagamento =
  | { tipo: 'mensal'; dia: number }
  | { tipo: 'semanal'; diasDaSemana: number[] }
  | { tipo: 'diario' }
  | null;

export interface RitmoSeguradora {
  seguradora: string;
  mediaMensal: number | null;
  mesesNaMedia: number;
  meses: { mes: string; liquido: number; coberto: boolean }[];
  mesAtual: number;
  diasDeRecibo: number | null;
  padrao: PadraoPagamento;
  primeiroRecibo: string;
  ultimoRecibo: { data: string; liquido: number; recibos: number };
}

export interface PrevisaoEntrada {
  hoje: string;
  semanas: SemanaPrevista[];
  meses: MesPrevisto[];
  janelas: JanelaPrevista[];
  travado: { total: Omit<PendenteSeguradora, 'seguradora'>; porSeguradora: PendenteSeguradora[] };
  ritmo: RitmoSeguradora[];
}

export const previsaoEntradaApi = {
  obter: () => api.get<PrevisaoEntrada>('/financeiro/previsao'),
};
