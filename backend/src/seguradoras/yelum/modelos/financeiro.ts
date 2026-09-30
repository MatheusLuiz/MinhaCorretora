import type { LayoutFinanceiro } from '../../../services/modelosFinanceiro.js';

export const YELUM_PARCELAS_ATRASADAS: LayoutFinanceiro = {
  chave: 'yelum-parcelas-atrasadas',
  nome: 'Yelum — Gestão de parcelas atrasadas',
  seguradoraChave: 'yelum',
  seguradora: 'Yelum',
  entidade: 'parcelas',
  descricao:
    'Parcelas em atraso, com valor, vencimento e motivo da rejeição. É a origem da inadimplência.',
  aliases: {
    apolice: 'numero_apolice',
    emissao: 'sequencia_emissao',
    nome: 'nome_segurado',
    produto: 'produto',
    parcela: 'numero_parcela',
    vencimentoatual: 'vencimento',
    vencimentooriginal: 'vencimento_original',
    valor: 'valor',
    iof: 'iof',
    // "Tipo" aqui é a forma de pagamento, não o tipo do movimento.
    tipo: 'forma_pagamento',
    status: 'status',
    motivorejeicao: 'motivo_rejeicao',
    datarejeicao: 'data_rejeicao',
    nomecorretora: 'ignorar_corretora',
  },
  observacoes: [
    'Não traz CPF/CNPJ. A parcela é ligada ao cliente pela APÓLICE — se ela ainda não existe na base, é criada como cadastro mínimo.',
    'Valores vêm no formato brasileiro (172,42). O importador entende vírgula decimal.',
    'Rodar de novo atualiza as mesmas parcelas: a chave é (apólice, emissão, número da parcela).',
  ],
};

export const YELUM_COMISSAO_MENSAL: LayoutFinanceiro = {
  chave: 'yelum-comissao-mensal',
  nome: 'Yelum — Demonstrativo mensal de comissão',
  seguradoraChave: 'yelum',
  seguradora: 'Yelum',
  entidade: 'comissoes',
  descricao:
    'O que a seguradora pagou à corretora no mês, por filial e data de crédito.',
  aliases: {
    nome_corretor: 'corretora',
    filial: 'filial',
    cod_cliente: 'codigo_cliente',
    cod_estabelecimento: 'codigo_estabelecimento',
    nr: 'numero',
    tipo_do_demonstrativo: 'tipo',
    total_bruto_r: 'total_bruto',
    desconto_r: 'desconto',
    impostos_ir_iss_inss_r: 'impostos',
    valor_liquido_pago_r: 'total_liquido',
    total_liquido_r: 'total_liquido',
    data_do_pagamento: 'pago_em',
    data_do_credito: 'pago_em',
    data_credito: 'pago_em',
    mes_ano_de_pagamento: 'competencia_origem',
    forma_de_pagamento: 'forma_pagamento',
    forma_pagamento: 'forma_pagamento',
  },
  observacoes: [
    'O arquivo NÃO começa pela tabela: tem título, data de emissão e um totalizador antes. O importador procura a linha de cabeçalho pelo conteúdo.',
    'A comissão vem agregada por FILIAL e data de crédito, não por apólice — não há como atribuí-la a um cliente sem inventar rateio.',
    'Lançamentos negativos são estornos e entram como estão.',
  ],
};
