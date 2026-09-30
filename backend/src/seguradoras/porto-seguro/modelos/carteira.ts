import type { LayoutCarteira } from '../../../services/modelosCarteira.js';

/**
 * `Apólices_AB123C.xlsx`: emitidas de UMA SUSEP, com CPF mas nome/e-mail/celular MASCARADOS (LGPD) e
 * sem prêmio. Cartão de crédito não tem ramo/sucursal/apólice: o número é o contrato.
 */
export const PORTO_AB123C: LayoutCarteira = {
  chave: 'porto-apolices-ab123c',
  nome: 'Porto — Apólices emitidas (AB123C)',
  origem: 'Porto Seguro',
  seguradoraChave: 'porto-seguro',
  montarNumero: { partes: ['ramo', 'sucursal', 'apolice'], senao: 'contrato', coluna: 'numero_montado' },
  descricao:
    'Apólices emitidas da SUSEP AB123C, com CPF/CNPJ, produto, vigência e status. Cadastra o cliente e a apólice que faltam.',
  observacoes: [
    'Importe em ordem CRONOLÓGICA: a mesma apólice volta no arquivo seguinte, e a situação mais nova vence.',
    'O nome, o e-mail e o celular vêm mascarados. Depois desta carga, importe a "Porto — Consulta de apólices" do mesmo mês: ela troca o nome mascarado pelo verdadeiro.',
    'Não traz prêmio: a Produção conta a Porto em apólices.',
    'O número fica no formato do portal (ramo-sucursal-apólice, ex. 531-7-12345678).',
  ],
  aliases: {
    numero_montado: 'numero_apolice',
    nomerazaosocial: 'nome_civil',
    cpfcnpj: 'cpf_cnpj',
    nomeproduto: 'produto',
    codigoproduto: 'produto_codigo',
    dataemissao: 'emitida_em',
    datainiciovigencia: 'vigencia_inicio',
    datafinalvigencia: 'vigencia_fim',
    status: 'situacao_cia',
    endosso: 'endosso',
    numeroproposta: 'numero_proposta',
    ramo: 'ignorar_ramo_codigo',
    sucursal: 'ignorar_sucursal',
    apolice: 'ignorar_apolice_parte',
    contrato: 'ignorar_contrato',
    // Mascarados não entram, para não gravar lixo que pareça contato.
    nomesocialpessoa: 'ignorar_nome_social_mascarado',
    email: 'ignorar_email_mascarado',
    celular: 'ignorar_celular_mascarado',
    codigopessoa: 'ignorar_codigo_pessoa',
    susep: 'ignorar_susep',
    origemproposta: 'ignorar_origem_proposta',
    ano: 'ignorar_ano',
  },
};

/** Consulta de apólices (`download.xls`, HTML): nome verdadeiro do AB123C mascarado; não cadastra (lido por `importacaoConsultaPorto`). */
export const PORTO_CONSULTA: LayoutCarteira = {
  chave: 'porto-consulta-apolices',
  nome: 'Porto — Consulta de apólices (nomes sem máscara)',
  origem: 'Porto Seguro',
  seguradoraChave: 'porto-seguro',
  aceita: '.xls,.html,.htm',
  descricao:
    'A lista de apólices do portal, com o nome sem máscara. Troca o nome mascarado pelo verdadeiro e completa e-mail e telefone. Não cria cliente nem apólice.',
  observacoes: [
    'Importe DEPOIS do "Porto — Apólices emitidas (AB123C)" do mesmo período: a apólice precisa estar na base.',
    'O nome só é trocado se preencher o molde da máscara (começo, fim e quantidade de letras). O que não preencher é listado, não gravado.',
    'E-mail e telefone entram só onde o cliente ainda não tem daquele tipo.',
  ],
  aliases: {},
};

/** Consulta do portal com TODOS os SUSEP (novos/canceladas/vencidas): cadastra; sem aliases porque `importacaoConsultaPortal` já monta a grade canônica. */
export const PORTO_CONSULTA_PORTAL: LayoutCarteira = {
  chave: 'porto-consulta-portal',
  nome: 'Porto — Consulta do portal (todos os SUSEP)',
  origem: 'Porto Seguro',
  seguradoraChave: 'porto-seguro',
  aceita: '.xls,.html,.htm',
  descricao:
    'Apólices de TODOS os códigos SUSEP da corretora (a AB123C só traz um). Cadastra cliente e apólice; o CPF vem da base ou do Apólices_AB123C já importado.',
  observacoes: [
    'Serve para os três downloads da consulta: novos, canceladas e vencidas.',
    'Sem CPF (nem na base, nem no Apólices_AB123C), a apólice entra SEM cliente e é listada no resultado.',
    'Para o mês novo, importe antes o Apólices_AB123C do mesmo mês.',
  ],
  aliases: {},
};
