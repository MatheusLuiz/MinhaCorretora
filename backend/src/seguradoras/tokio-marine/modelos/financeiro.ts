import type { LayoutFinanceiro } from '../../../services/modelosFinanceiro.js';

/** Lido por `importacao/importacaoTokio.service.ts` (extrato com rodapé de totais). */
export const TOKIO_COMISSOES_EXTRATO: LayoutFinanceiro = {
  chave: 'tokio-comissoes-extrato',
  nome: 'Tokio Marine — Extrato de comissão',
  seguradoraChave: 'tokio-marine',
  seguradora: 'Tokio Marine',
  entidade: 'comissoes',
  aceita: '.xlsx,.xls',
  descricao: 'Um extrato por dia de processamento: bruto, INSS, IRRF, ISS e líquido. Sem apólice nem segurado.',
  aliases: {},
  observacoes: [
    'A soma dos extratos é conferida contra o rodapé (bruto e líquido) — diferença de um centavo recusa o arquivo.',
    'A competência é o mês do processamento. Reimportar atualiza o mesmo extrato, sem duplicar.',
    'É o total de cada extrato: não diz de qual apólice veio cada comissão.',
  ],
};
