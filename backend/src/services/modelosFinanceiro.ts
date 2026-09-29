import { LAYOUTS_POR_SEGURADORA } from '../seguradoras/index.js';

/** Layouts dos relatórios financeiros (parcelas, comissões, sinistros…), separados dos de apólice. */

export const COLUNAS_PARCELA = [
  'numero_apolice',
  'sequencia_emissao',
  'nome_segurado',
  'produto',
  'numero_parcela',
  'vencimento',
  'vencimento_original',
  'valor',
  'iof',
  'forma_pagamento',
  'status',
  'motivo_rejeicao',
  'data_rejeicao',
  // Do CADASTRO: único relatório da Porto com nome e telefone sem máscara.
  'telefone',
  'responsavel_financeiro',
  // Sem coluna de status, decide: 0 = aberto (vence hoje), acima = atrasado (Suhai).
  'dias_atraso',
] as const;

export const COLUNAS_COMISSAO = [
  'corretora',
  'filial',
  'codigo_cliente',
  'codigo_estabelecimento',
  'numero',
  'tipo',
  'total_bruto',
  'desconto',
  'impostos',
  'total_liquido',
  'pago_em',
  'forma_pagamento',
  'competencia_origem',
  // Sem `impostos` somado, o total é a soma das três (Suhai).
  'irrf',
  'iss',
  'inss',
] as const;

/** Sinistros e assistências, ligados à apólice pelo número. */
export const COLUNAS_SINISTRO = [
  'numero_sinistro',
  'numero_apolice',
  'nome_segurado',
  'ramo',
  'cobertura',
  'causa',
  'ocorrido_em',
  'comunicado_em',
  'status_processo',
  'status_movimento',
  'reserva',
  'reserva_ro',
  'placa',
  'veiculo',
] as const;

export const COLUNAS_RENOVACAO = [
  'numero_apolice',
  'vigencia_fim',
  'nome_segurado',
  'sucursal',
  'agencia',
  'percentual_comissao',
  'veiculo',
  'placa',
  'sinistros',
  'classe_bonus',
  'premio_renovacao',
  'cotado_outro_corretor',
  'tem_residencial',
] as const;

export const COLUNAS_ENCERRADA = [
  'numero_apolice',
  'nome_segurado',
  'placa',
  'teve_endosso',
  'emitida_em',
  'vigencia_inicio',
  'vigencia_fim',
] as const;

export type StatusParcela ='atrasado' | 'pago' | 'aberto' | 'cancelado' | 'outro';

/** Como cada seguradora nomeia o status da parcela. */
export const STATUS_PARCELA: Record<string, StatusParcela> = {
  atrasado: 'atrasado',
  atrasada: 'atrasado',
  vencido: 'atrasado',
  vencida: 'atrasado',
  em_atraso: 'atrasado',
  pago: 'pago',
  paga: 'pago',
  quitado: 'pago',
  liquidado: 'pago',
  aberto: 'aberto',
  aberta: 'aberto',
  a_vencer: 'aberto',
  pendente: 'aberto',
  cancelado: 'cancelado',
  cancelada: 'cancelado',
  // Bradesco: "Agendado" é débito ainda não caído (aberto).
  compensado: 'pago',
  compensada: 'pago',
  agendado: 'aberto',
  agendada: 'aberto',
  parcela_cancelada: 'cancelado',
};

export interface LayoutFinanceiro {
  chave: string;
  nome: string;
  /** Chave da companhia no cadastro — o vínculo é por ela, não pelo nome (que muda na tela). */
  seguradoraChave: string;
  /** Rótulo de apoio. A fonte da verdade é o cadastro, resolvido pela chave. */
  seguradora: string;
  descricao: string;
  entidade: 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas';
  /** Nome de origem (normalizado) → coluna canônica. */
  aliases: Record<string, string>;
  /** Situação quando o arquivo não tem coluna de status (Porto "Parcelas Vencidas": tudo vencido). */
  statusPadrao?: StatusParcela;
  /** Comissões: competência = mês do PAGAMENTO (arquivo de vários meses, como os recibos da Suhai). */
  competenciaPeloPagamento?: boolean;
  /** Comissões: recibo `AAAA/N` que o portal entrega como DATA (`2026/6` → `01/06/2026`); ver `numeroDoRecibo`. */
  reciboAnoBarraNumero?: boolean;
  /** Usado por dentro de outra importação (parcelas do PDF do Bradesco), não oferecido na tela. */
  interno?: boolean;
  /** Valor DESLOCADO do cabeçalho por célula mesclada: liga `realinharColunasDeslocadas`. */
  colunasDeslocadas?: boolean;
  /** Extensões que a tela aceita, quando não são as de planilha comum. */
  aceita?: string;
  /** Sem número de lançamento (extrato do Bradesco): vira `AAAA-MM-DD EMPRESA`, para reimportar sem duplicar. */
  numeroPelaDataEFilial?: boolean;
  /** Sem coluna de impostos: retenção = bruto − líquido. */
  impostosPelaDiferenca?: boolean;
  /** Linha com bruto e líquido zerados é dia sem crédito — recusada com motivo. */
  recusarValorZero?: boolean;
  /** `codigo_estabelecimento` só dígitos: está na chave única, e NULL não conta como repetição. */
  estabelecimentoSoDigitos?: boolean;
  observacoes: string[];
}

/** Todos os layouts financeiros, pasta por pasta (`seguradoras/<chave>/index.ts`). */
export const LAYOUTS_FINANCEIRO: LayoutFinanceiro[] = LAYOUTS_POR_SEGURADORA.flatMap((s) => s.financeiro ?? []);

export const LAYOUTS_FINANCEIRO_POR_CHAVE = new Map(
  LAYOUTS_FINANCEIRO.map((l) => [l.chave, l]),
);
