/**
 * Modelos de planilha de clientes: por FINALIDADE (planilha montada à mão) ou
 * layout de SEGURADORA (arquivo pronto da companhia).
 * Todo modelo carrega as colunas de contato: a importação ESPELHA, e coluna ausente apaga.
 */

export type Grupo = 'finalidade' | 'seguradora';

export interface Modelo {
  chave: string;
  nome: string;
  descricao: string;
  grupo: Grupo;

  /** Preenchido nos layouts de seguradora. */
  seguradora?: string;

  /** Situação atribuída a quem a planilha não classificar. */
  situacaoPadrao: string;

  /** Seguradora atribuída às linhas quando o arquivo não traz a coluna. */
  seguradoraPadrao?: string;

  /** Colunas canônicas que o modelo carrega (usado no CSV de exemplo). */
  colunas: string[];

  /** Nome de origem (já normalizado) → coluna canônica; só o que o mapa GLOBAL não resolve. */
  aliases?: Record<string, string>;

  exemplo: Record<string, string>;
  observacoes: string[];
}

const CONTATO = [
  'email', 'email_comercial',
  'ddd_celular', 'celular',
  'ddd_residencial', 'telefone_residencial',
  'ddd_comercial', 'telefone_comercial',
];

const ENDERECO = ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'];

const AVISO_ESPELHO =
  'A importação espelha a planilha: coluna em branco ou ausente APAGA o que existe. ' +
  'Para atualizar sem perder nada, exporte a base, edite a coluna que interessa e reimporte.';

const POR_FINALIDADE: Modelo[] = [
  {
    chave: 'prospecto',
    nome: 'Novos prospectos',
    descricao: 'Quem ainda não é cliente — indicação, contato de campanha ou cotação.',
    grupo: 'finalidade',
    situacaoPadrao: 'prospecto',
    colunas: [
      'cpf_cnpj', 'nome_civil', 'data_nascimento',
      ...CONTATO, ...ENDERECO,
      'produtor', 'origem_cliente', 'situacao',
    ],
    exemplo: {
      cpf_cnpj: '123.456.789-00',
      nome_civil: 'Maria Souza',
      data_nascimento: '15/03/1985',
      email: 'maria.souza@exemplo.com.br',
      ddd_celular: '41',
      celular: '999998888',
      cidade: 'Curitiba',
      uf: 'PR',
      cep: '80000000',
      produtor: 'Ana Exemplo dos Santos',
      origem_cliente: 'Indicação Colaborador',
      situacao: 'prospecto',
    },
    observacoes: [
      'CPF/CNPJ e nome são obrigatórios; o resto pode ficar em branco.',
      'Quem já existir na base tem o cadastro sobrescrito por esta planilha.',
    ],
  },
  {
    chave: 'base-antiga',
    nome: 'Cadastros antigos',
    descricao:
      'Clientes que a corretora já tem e que nunca entraram no sistema. Entram como ativos.',
    grupo: 'finalidade',
    situacaoPadrao: 'ativo',
    colunas: [
      'cpf_cnpj', 'nome_civil', 'data_nascimento', 'sexo', 'estado_civil', 'profissao',
      ...CONTATO, ...ENDERECO,
      'seguradora', 'ramo_descricao', 'produtor', 'estrutura_vendas',
      'cliente_desde', 'renda', 'situacao',
    ],
    exemplo: {
      cpf_cnpj: '123.456.789-00',
      nome_civil: 'Maria Souza',
      data_nascimento: '15/03/1985',
      email: 'maria.souza@exemplo.com.br',
      ddd_celular: '41',
      celular: '999998888',
      logradouro: 'Rua das Flores',
      numero: '100',
      bairro: 'Centro',
      cidade: 'Curitiba',
      uf: 'PR',
      cep: '80000000',
      seguradora: 'Allianz',
      ramo_descricao: 'Automóvel',
      produtor: 'Ana Exemplo dos Santos',
      cliente_desde: '15/01/2020',
      situacao: 'ativo',
    },
    observacoes: [
      '`cliente_desde` é o que permite o painel contar entradas por ano. Sem ela, o cliente antigo aparece como novo.',
      AVISO_ESPELHO,
    ],
  },
  {
    chave: 'inadimplente',
    nome: 'Clientes em atraso',
    descricao: 'Marca quem está devendo. Segue contando como carteira.',
    grupo: 'finalidade',
    situacaoPadrao: 'inadimplente',
    colunas: ['cpf_cnpj', 'nome_civil', 'situacao', 'situacao_em', ...CONTATO, ...ENDERECO],
    exemplo: {
      cpf_cnpj: '123.456.789-00',
      nome_civil: 'Maria Souza',
      situacao: 'inadimplente',
      situacao_em: '01/09/2026',
      email: 'maria.souza@exemplo.com.br',
      ddd_celular: '41',
      celular: '999998888',
      cidade: 'Curitiba',
      uf: 'PR',
    },
    observacoes: [
      AVISO_ESPELHO,
      '`situacao_em` é desde quando está em atraso. Sem ela, não dá para diferenciar quem atrasou ontem de quem atrasou há oito meses.',
    ],
  },
  {
    chave: 'inativo',
    nome: 'Clientes perdidos',
    descricao: 'Quem deixou a carteira. Alimenta o indicador de perdidos no ano.',
    grupo: 'finalidade',
    situacaoPadrao: 'inativo',
    colunas: [
      'cpf_cnpj', 'nome_civil', 'situacao', 'situacao_em', 'saida_em',
      ...CONTATO, ...ENDERECO,
    ],
    exemplo: {
      cpf_cnpj: '123.456.789-00',
      nome_civil: 'Maria Souza',
      situacao: 'inativo',
      situacao_em: '01/09/2026',
      saida_em: '01/09/2026',
      email: 'maria.souza@exemplo.com.br',
      ddd_celular: '41',
      celular: '999998888',
      cidade: 'Curitiba',
      uf: 'PR',
    },
    observacoes: [
      '`saida_em` é o que torna "perdidos no ano" um número apurável. Sem ela, só se sabe quantos estão inativos hoje.',
      AVISO_ESPELHO,
    ],
  },
  {
    chave: 'completo',
    nome: 'Cadastro completo',
    descricao: 'Todas as colunas que o importador entende.',
    grupo: 'finalidade',
    situacaoPadrao: 'ativo',
    colunas: [
      'cpf_cnpj', 'nome_civil', 'nome_social', 'profissao', 'sexo', 'estado_civil',
      'data_nascimento', 'cliente_vip', 'autoriza_contato', 'situacao', 'situacao_em', 'saida_em',
      ...CONTATO, 'ddd_opcional', 'telefone_opcional', ...ENDERECO,
      'ramo_descricao', 'modalidade', 'seguradora',
      'estrutura_vendas', 'produtor', 'origem_cliente',
      'renda', 'faturamento_anual', 'cliente_desde',
      'resp1_nome', 'resp1_cpf', 'resp1_rg', 'resp1_telefone', 'resp1_celular', 'resp1_email',
    ],
    exemplo: {
      cpf_cnpj: '123.456.789-00',
      nome_civil: 'Maria Souza',
      sexo: 'F',
      estado_civil: 'Casado',
      data_nascimento: '15/03/1985',
      cliente_vip: '0',
      autoriza_contato: '1',
      situacao: 'ativo',
      email: 'maria.souza@exemplo.com.br',
      ddd_celular: '41',
      celular: '999998888',
      logradouro: 'Rua das Flores',
      numero: '100',
      bairro: 'Centro',
      cidade: 'Curitiba',
      uf: 'PR',
      cep: '80000000',
      ramo_descricao: 'Automóvel',
      modalidade: 'Automóvel Individual',
      seguradora: 'Allianz',
      produtor: 'Ana Exemplo dos Santos',
      origem_cliente: 'Indicação Colaborador',
      renda: 'Até R$ 7.000,00',
      cliente_desde: '15/01/2024',
    },
    observacoes: [
      'É o modelo mais seguro para atualizar quem já existe, porque traz todas as colunas.',
      AVISO_ESPELHO,
    ],
  },
];

// Layout novo: `db:importar:clientes -- --arquivo <x> --simular` lista as colunas não
// reconhecidas; acrescente-as em `aliases` (nome normalizado → canônica).
const POR_SEGURADORA: Modelo[] = [];

export const MODELOS: Modelo[] = [...POR_FINALIDADE, ...POR_SEGURADORA];

export const MODELOS_POR_CHAVE = new Map(MODELOS.map((m) => [m.chave, m]));

/** Gera o CSV do modelo; `;` e BOM porque o Excel em português exige os dois. */
export function gerarCsvModelo(modelo: Modelo): string {
  const escapar = (valor: string): string =>
    /[;"\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;

  const cabecalho = modelo.colunas.join(';');
  const exemplo = modelo.colunas.map((c) => escapar(modelo.exemplo[c] ?? '')).join(';');

  return `\u{FEFF}${cabecalho}\n${exemplo}\n`;
}
