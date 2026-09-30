import type { LayoutCarteira } from '../../../services/modelosCarteira.js';

/** Apólices emitidas no mês (portal Suhai); nome e CPF vêm limpos. Já exclui as canceladas. */
export const SUHAI_EMITIDAS: LayoutCarteira = {
  chave: 'suhai-apolices-emitidas',
  nome: 'Suhai — Apólices emitidas',
  origem: 'Suhai',
  seguradoraChave: 'suhai',
  descricao:
    'Apólices e endossos emitidos no mês, com CPF/CNPJ, prêmio e comissão. Cadastra o cliente que falta e a apólice que falta.',
  observacoes: [
    'Importe os meses em ordem CRONOLÓGICA: a mesma apólice volta no mês do endosso, e a última escrita vence.',
    'O CPF chega sem os zeros à esquerda (a planilha o guarda como número). A importação completa antes de validar.',
    'O prêmio total é a soma de tarifário, adicional e IOF — o relatório não traz a coluna pronta.',
    'Linha de endosso não altera prêmio nem data de emissão da apólice: o valor dela é o do endosso, não o do contrato.',
    '"Status Apólice" veio "Emitida" em todas as linhas. Não diz se a apólice segue ativa, e por isso não é lida como tal.',
  ],
  aliases: {
    ramo: 'ramo_descricao',
    apolice: 'numero_apolice',
    endosso: 'endosso',
    data_de_emissao: 'emitida_em',
    inicio_de_vigencia: 'vigencia_inicio',
    fim_de_vigencia: 'vigencia_fim',
    segurado: 'nome_civil',
    cpf_cnpj_do_segurado: 'cpf_cnpj',
    // Tarifário = prêmio líquido (base da comissão); o total soma adicional e IOF.
    vlr_tarifario: 'premio_liquido',
    vlr_adicional: 'premio_adicional',
    vlr_iof: 'premio_iof',
    vlr_comissao: 'comissao',
    // "Emitida" não está no vocabulário e vira null ("não informa").
    status_apolice: 'situacao_cia',

    qtd_parcelas: 'ignorar_parcelas',
    filial: 'ignorar_filial',
    nome_filial: 'ignorar_nome_filial',
    nome_corretor: 'ignorar_corretor',
  },
};

/** Canceladas por inadimplência (portal Suhai): único lugar onde essas apólices existem. */
export const SUHAI_CANCELADAS_INADIMPLENCIA: LayoutCarteira = {
  chave: 'suhai-canceladas-inadimplencia',
  nome: 'Suhai — Apólices canceladas por inadimplência',
  origem: 'Suhai',
  seguradoraChave: 'suhai',
  corretora: 'MINHA CORRETORA DE SEGUROS LTDA',
  motivoCancelamento: 'Inadimplência',
  descricao:
    'Apólices canceladas por falta de pagamento, com a data e a parcela em que o cliente parou de pagar.',
  observacoes: [
    'Cada apólice vem repetida uma vez por corretor. Entra só a linha da MinhaCorretora; a da outra corretora é recusada.',
    'O valor das colunas "Parc Canc" é da PARCELA cancelada, não da apólice — não vira prêmio nem comissão.',
    'Apólice que já está na base só ganha a data e o motivo do cancelamento; prêmio e emissão ficam como estão.',
  ],
  aliases: {
    ramo: 'ramo_descricao',
    apolice: 'numero_apolice',
    cnpj_cpf_do_segurao: 'cpf_cnpj', // "Segurao" é a grafia do portal
    segurado: 'nome_civil',
    inicio_de_vigencia: 'vigencia_inicio',
    fim_de_vigencia: 'vigencia_fim',
    data_cancelamento: 'cancelada_em',
    no_parcela_canc: 'parcela_cancelada', // "Nº" — o NFKD faz do º um "o"
    qtd_parcelas: 'qtd_parcelas',
    nome_corretor: 'corretora',

    // Mapear o endosso faria a regra de endosso anular a vigência.
    endosso: 'ignorar_endosso',
    endosso_cancelamento: 'ignorar_endosso_cancelamento',
    // Valores da PARCELA cancelada, não da apólice.
    tarif_parc_canc: 'ignorar_tarifa_parcela',
    adic_parc_canc: 'ignorar_adicional_parcela',
    iof_parc_canc: 'ignorar_iof_parcela',
    com_parc_cacnc: 'ignorar_comissao_parcela',
    data_de_corte: 'ignorar_data_de_corte',
    i_s_basica: 'ignorar_importancia_segurada',
    tipo_de_pessoa: 'ignorar_tipo_pessoa',
    numero_filial: 'ignorar_filial',
    cobertura_basica: 'ignorar_cobertura',
    marca: 'ignorar_marca',
    modelo: 'ignorar_modelo',
    ano_fabricacao: 'ignorar_ano_fabricacao',
    ano_modelo: 'ignorar_ano_modelo',
    placa: 'ignorar_placa',
    data_inicial: 'ignorar_data_inicial',
    data_final: 'ignorar_data_final',
  },
};

/** A renovar (portal Suhai): a apólice que VENCE no mês, com CPF e contato; a renovada vem pelas emitidas. */
export const SUHAI_A_RENOVAR: LayoutCarteira = {
  chave: 'suhai-apolices-a-renovar',
  nome: 'Suhai — Apólices a renovar',
  origem: 'Suhai',
  seguradoraChave: 'suhai',
  descricao:
    'Apólices que vencem no mês, com CPF, prêmio, comissão, endereço, celular e e-mail. Cadastra o cliente e a apólice que está vencendo.',
  observacoes: [
    'Traz a apólice que está VENCENDO (emitida um ano antes), não a renovada — essa vem pelas emitidas do mês.',
    'O CPF chega sem os zeros à esquerda (a planilha o guarda como número). A importação completa antes de validar.',
    'Celular e e-mail só entram se o cliente ainda não tiver daquele tipo.',
    'Os dados do veículo (marca, modelo, placa, chassi) ainda não são gravados.',
  ],
  aliases: {
    ramo: 'ramo_descricao',
    apolice: 'numero_apolice',
    endosso: 'endosso',
    data_de_emissao: 'emitida_em',
    inicio_de_vigencia: 'vigencia_inicio',
    fim_de_vigencia: 'vigencia_fim',
    segurado: 'nome_civil',
    cnpj_cpf_segurado: 'cpf_cnpj',
    valor_tarifario: 'premio_liquido',
    valor_adicional: 'premio_adicional',
    valor_do_iof: 'premio_iof',
    total_comissao: 'comissao',
    status_apolice: 'situacao_cia',
    data_de_cancelamento: 'cancelada_em',
    data_de_nascimento: 'data_nascimento',
    sexo: 'sexo',
    cep: 'cep',
    logradouro: 'logradouro',
    no_logradouro: 'numero_endereco', // "Nº" — o NFKD faz do º um "o"
    bairro: 'bairro',
    complemento: 'complemento',
    cidade: 'cidade',
    uf: 'uf',
    fone_celular: 'celular',
    email: 'email',

    qtde_de_parcelas: 'ignorar_parcelas',
    valor_da_i_s: 'ignorar_importancia_segurada',
    tipo_de_pessoa: 'ignorar_tipo_pessoa',
    filial: 'ignorar_filial',
    numero_item: 'ignorar_item',
    nm_cobertura_basica: 'ignorar_cobertura',
    marca: 'ignorar_marca',
    modelo: 'ignorar_modelo',
    ano_auto: 'ignorar_ano_fabricacao',
    ano_modelo: 'ignorar_ano_modelo',
    e_zero_km: 'ignorar_zero_km',
    modalidade_contratacao: 'ignorar_modalidade',
    fator_de_ajuste: 'ignorar_fator_ajuste',
    referencia_fipe: 'ignorar_fipe',
    placa: 'ignorar_placa',
    chassis: 'ignorar_chassi',
    estado_civil: 'ignorar_estado_civil',
    regi_ao: 'ignorar_regiao', // "Regi]ao" é a grafia do portal
    fone_residencial: 'ignorar_fone_residencial',
    vlr_primeira_parcela: 'ignorar_primeira_parcela',
    qtd_parcelas_pagas: 'ignorar_parcelas_pagas',
    classe_de_bonus: 'ignorar_bonus',
    tipo_de_rastreador: 'ignorar_rastreador',
    data_inicial: 'ignorar_data_inicial',
    data_final: 'ignorar_data_final',
    nome_corretor: 'ignorar_corretor',
  },
};
