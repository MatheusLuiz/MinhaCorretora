import type { LayoutCarteira } from '../../../services/modelosCarteira.js';

/** PDF "Histórico da Apólice" (um por apólice); sem aliases: o leitor do PDF já monta a grade canônica. */
export const BRADESCO_HISTORICO: LayoutCarteira = {
  chave: 'bradesco-historico-apolice',
  nome: 'Bradesco — Histórico da apólice (PDF)',
  origem: 'Bradesco',
  seguradoraChave: 'bradesco',
  aceita: '.pdf,application/pdf',
  descricao:
    'Um PDF por apólice, como sai do portal. Traz cliente, apólice, prêmio e parcelas. Selecione vários de uma vez.',
  observacoes: [
    'Importe o PDF como veio do portal — não imprima nem converta: o arquivo tem texto, e é ele que é lido.',
    'A soma das parcelas é conferida contra o prêmio bruto do resumo financeiro. Se não bater, a apólice entra e a tela avisa.',
    'Nome de empresa vem cortado em 40 caracteres pelo próprio PDF do Bradesco.',
    'Sinistro listado no PDF ainda não é lido — a tela avisa quando houver.',
  ],
  aliases: {},
};

/** "Apólices RE" (residencial/equipamentos): lidos por `importacaoRe.service.ts`, sem aliases. */
export const BRADESCO_RE_ATIVAS: LayoutCarteira = {
  chave: 'bradesco-re-ativas',
  nome: 'Bradesco — Apólices RE (ativas)',
  origem: 'Bradesco',
  seguradoraChave: 'bradesco',
  aceita: '.xlsx,.xls',
  descricao: 'Apólices RE (residencial, equipamentos) emitidas no mês, com emissão e vigência. Cadastra o cliente e a apólice.',
  observacoes: [
    'Não traz CPF nem prêmio. O dono vem da base: pelo número da apólice ou pelo nome de um cliente já cadastrado (só com um CPF).',
    'Sem dono conhecido, a apólice entra SEM cliente e é listada no resultado.',
  ],
  aliases: {},
};

export const BRADESCO_RE_ENCERRADAS: LayoutCarteira = {
  chave: 'bradesco-re-encerradas',
  nome: 'Bradesco — Apólices RE (encerradas)',
  origem: 'Bradesco',
  seguradoraChave: 'bradesco',
  aceita: '.xlsx,.xls',
  descricao: 'Apólices RE encerradas no mês: canceladas por falta de pagamento e as que chegaram ao fim da vigência.',
  observacoes: [
    'Importe DEPOIS das ativas do mesmo mês.',
    '"Cancelamento devido a pendências de pagamento" entra como CANCELADA, com o motivo — mas sem a data, que o relatório não traz.',
    '"Encerramento devido ao fim da vigência" não é cancelamento: a apólice só venceu (as datas já dizem isso).',
    'Não traz CPF: o dono vem como nas ativas.',
  ],
  aliases: {},
};

export const BRADESCO_AUTO_ATIVAS: LayoutCarteira = {
  chave: 'bradesco-auto-ativas',
  nome: 'Bradesco — Apólices individuais auto (ativas)',
  origem: 'Bradesco',
  seguradoraChave: 'bradesco',
  aceita: '.xls,.xlsx',
  descricao: 'A lista de apólices de auto ativas do portal: segurado, apólice, placa, emissão e vigência. Cadastra o que os PDFs não trouxeram.',
  observacoes: [
    'Não traz CPF nem prêmio: o dono vem como nas Apólices RE (base, pelo número ou pelo nome). O PDF "Histórico da Apólice" continua sendo a fonte completa (prêmio, parcelas, veículo).',
    'Apólice que já entrou pelo PDF só é confirmada — nada do PDF é sobrescrito.',
    'As ENCERRADAS de auto entram pelo layout "Bradesco — Apólices encerradas".',
  ],
  aliases: {},
};
