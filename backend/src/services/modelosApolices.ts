import { LAYOUTS_POR_SEGURADORA } from '../seguradoras/index.js';

/** Colunas que o importador de apólices entende. */
export const COLUNAS_APOLICE = [
  'numero_apolice',
  'produto',
  'nome_segurado',
  'cpf_cnpj',
  'emitida_em',
  'vigencia_inicio',
  'vigencia_fim',
  'sequencia',
  'tipo_emissao',
  'premio_total',
  'premio_liquido',
  'seguradora',
  'numero_renovacao',
  'cancelada_em',
  'motivo_cancelamento',
] as const;

/** Como cada seguradora nomeia um movimento → tipo do sistema. */
export type TipoMovimento = 'apolice' | 'endosso' | 'fatura' | 'cancelamento' | 'outro';

export interface LayoutApolices {
  chave: string;
  nome: string;
  /** Chave no cadastro de seguradoras — nunca o nome, que muda na tela. */
  seguradoraChave: string;
  /** Rótulo de apoio; a verdade é o cadastro. */
  seguradora: string;
  descricao: string;

  /** `movimentos`: cada linha é uma emissão. `carteira`: cada linha é o estado de uma apólice, sem gerar movimento. */
  tipoArquivo: 'movimentos' | 'carteira';
  /** Nome de origem (normalizado) → coluna canônica. */
  aliases: Record<string, string>;
  /** Texto do tipo de movimento (minúsculo, sem acento) → tipo do sistema. */
  tiposDeMovimento?: Record<string, TipoMovimento>;
  observacoes: string[];
}

/** Todos os layouts de apólices, pasta por pasta (`seguradoras/<chave>/index.ts`). */
export const LAYOUTS_APOLICES: LayoutApolices[] = LAYOUTS_POR_SEGURADORA.flatMap((s) => s.apolices ?? []);

export const LAYOUTS_APOLICES_POR_CHAVE = new Map(
  LAYOUTS_APOLICES.map((l) => [l.chave, l]),
);

/** Tipos de movimento de fundo; o mapa do layout tem precedência. */
export const TIPOS_MOVIMENTO_GLOBAIS: Record<string, TipoMovimento> = {
  apolice: 'apolice',
  apolice_nova: 'apolice',
  emissao: 'apolice',
  nova: 'apolice',
  endosso: 'endosso',
  aditivo: 'endosso',
  fatura: 'fatura',
  parcela: 'fatura',
  cobranca: 'fatura',
  cancelamento: 'cancelamento',
  cancelada: 'cancelamento',
};
