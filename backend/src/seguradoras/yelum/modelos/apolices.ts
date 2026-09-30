import type { LayoutApolices } from '../../../services/modelosApolices.js';

export const YELUM_BUSCA_APOLICES: LayoutApolices = {
  chave: 'yelum-busca-apolices',
  nome: 'Yelum — Busca de apólices',
  seguradoraChave: 'yelum',
  seguradora: 'Yelum',
  tipoArquivo: 'movimentos',
  descricao:
    'Relatório de movimentos por período de início de vigência. Traz apólices, endossos e faturas na mesma lista.',
  aliases: {
    numero_da_apolice: 'numero_apolice',
    nome_do_produto: 'produto',
    nome_do_segurado: 'nome_segurado',
    data_de_emissao: 'emitida_em',
    data_de_validade_inicial: 'vigencia_inicio',
    data_de_validade_final: 'vigencia_fim',
    // "Emissão" é o número do movimento (51, 52…), não uma data.
    emissao: 'sequencia',
    tipo_de_emissao: 'tipo_emissao',
    premio_total: 'premio_total',
    premio_liquido: 'premio_liquido',
    codigo_unidade_parceiro: 'ignorar_unidade_parceiro',
    codigo_parceiro: 'ignorar_parceiro',
  },
  tiposDeMovimento: {
    apolice: 'apolice',
    endosso: 'endosso',
    fatura: 'fatura',
    cancelamento: 'cancelamento',
  },
  observacoes: [
    'Este relatório NÃO traz CPF/CNPJ. As apólices entram sem cliente vinculado e ficam na fila de conciliação.',
    'A vigência das linhas do tipo Fatura é o mês cobrado, não a vigência da apólice — ela não é copiada para o cabeçalho.',
    'Uma apólice pode aparecer só como endosso ou só como fatura, quando a emissão original é anterior ao período filtrado.',
  ],
};

export const YELUM_RENOVACOES: LayoutApolices = {
  chave: 'yelum-renovacoes',
  nome: 'Yelum — Relatório de renovações',
  seguradoraChave: 'yelum',
  seguradora: 'Yelum',
  tipoArquivo: 'carteira',
  descricao:
    'Apólices a vencer no período, com o número da que as renovou. É o ÚNICO relatório da Yelum que traz CPF/CNPJ.',
  aliases: {
    no_apolice: 'numero_apolice',
    no_apolice_renovada: 'numero_renovacao',
    produto: 'produto',
    nome_do_segurado: 'nome_segurado',
    cpf_cnpj: 'cpf_cnpj',
    data_fim_de_vigencia: 'vigencia_fim',
    nome_da_corretora: 'ignorar_corretora',
    codigo_parceiro: 'ignorar_parceiro',
    codigo_unidade_parceiro: 'ignorar_unidade_parceiro',
  },
  observacoes: [
    'Traz CPF/CNPJ — use este relatório para ligar as apólices órfãs aos clientes por documento, que é vínculo confiável.',
    'Não traz prêmio nem início de vigência: esses campos ficam como estão, preenchidos pelo relatório de movimentos.',
    '"Nº apólice renovada" é a apólice que SUBSTITUIU a da linha. Linha sem ela = ainda não renovada.',
  ],
};

export const YELUM_CANCELADAS: LayoutApolices = {
  chave: 'yelum-canceladas',
  nome: 'Yelum — Apólices canceladas',
  seguradoraChave: 'yelum',
  seguradora: 'Yelum',
  tipoArquivo: 'carteira',
  descricao: 'Apólices canceladas no período, com data e motivo.',
  aliases: {
    apolice: 'numero_apolice',
    nome_do_cliente: 'nome_segurado',
    nome_do_produto: 'produto',
    data_de_validade_inicial: 'vigencia_inicio',
    data_de_validade_final: 'vigencia_fim',
    data_cancelamento: 'cancelada_em',
    motivo_cancelamento: 'motivo_cancelamento',
    nome_da_corretora: 'ignorar_corretora',
    codigo_parceiro: 'ignorar_parceiro',
    codigo_unidade_parceiro: 'ignorar_unidade_parceiro',
  },
  observacoes: [
    'Marca a apólice como cancelada. Ela sai da carteira a renovar, mas continua no histórico do cliente.',
    'Não traz CPF/CNPJ: o vínculo com o cliente depende de a apólice já ter sido importada por outro relatório.',
  ],
};
