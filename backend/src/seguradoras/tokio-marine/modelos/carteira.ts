import type { LayoutCarteira } from '../../../services/modelosCarteira.js';

/** Lidos por `importacaoTokio.service.ts`, que já monta a grade canônica (sem aliases). */

export const TOKIO_EMITIDAS: LayoutCarteira = {
  chave: 'tokio-apolices-emitidas',
  nome: 'Tokio Marine — Apólices emitidas',
  origem: 'Tokio Marine',
  seguradoraChave: 'tokio-marine',
  aceita: '.xls,.xlsx',
  descricao:
    'Apólices emitidas no mês, com CPF/CNPJ, ramo, início de vigência e prêmio total. Cadastra o cliente e a apólice que faltam.',
  observacoes: [
    'Importe os meses em ordem CRONOLÓGICA.',
    'O relatório não traz o FIM da vigência: ele é o início + 12 meses (a regra de todos os ramos).',
    'Apólice com mais de um local vem em várias linhas: entra UMA vez, com o prêmio somado.',
    '"Prêmio" é o prêmio TOTAL (com IOF).',
  ],
  aliases: {},
};

export const TOKIO_CANCELADAS: LayoutCarteira = {
  chave: 'tokio-apolices-canceladas',
  nome: 'Tokio Marine — Apólices canceladas',
  origem: 'Tokio Marine',
  seguradoraChave: 'tokio-marine',
  aceita: '.xls,.xlsx',
  descricao:
    'Apólices canceladas no mês, com a data e o motivo (falta de pagamento, pedido do segurado, sinistro).',
  observacoes: [
    'Importe DEPOIS das emitidas do mesmo mês.',
    'Não traz CPF: o dono vem da base (apólice já importada). Sem ele, a apólice entra SEM cliente e é listada.',
    'A coluna "Emissao" é a data do CANCELAMENTO (do endosso), não a da emissão da apólice.',
  ],
  aliases: {},
};
