/**
 * Tradução de nomes de coluna para o vocabulário do importador.
 * Ordem: mapa do perfil → nome já canônico → mapa global; o resto é ignorado e reportado.
 */

/** Normaliza um nome de coluna: minúsculas, sem acento, pontuação vira `_`. */
export function normalizarNomeColuna(bruto: string): string {
  return bruto
    .trim()
    .replace(/^\u{FEFF}/u, '')
    .toLowerCase()
    // NFKD, e não NFD: só ele converte 'º' em 'o' e 'ª' em 'a'.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Variações comuns → coluna canônica (chaves já normalizadas).
 * Nome ambíguo ("telefone": celular ou fixo?) não entra aqui — vai no mapa do perfil.
 */
export const ALIASES_GLOBAIS: Record<string, string> = {
  cpf: 'cpf_cnpj',
  cnpj: 'cpf_cnpj',
  cpf_cnpj: 'cpf_cnpj',
  cpfcnpj: 'cpf_cnpj',
  cpf_ou_cnpj: 'cpf_cnpj',
  documento: 'cpf_cnpj',
  nr_documento: 'cpf_cnpj',
  n_documento: 'cpf_cnpj',
  numero_documento: 'cpf_cnpj',
  doc: 'cpf_cnpj',
  n_do_documento: 'cpf_cnpj',
  no_do_documento: 'cpf_cnpj',
  nr_do_documento: 'cpf_cnpj',
  numero_do_documento: 'cpf_cnpj',
  cpf_do_segurado: 'cpf_cnpj',
  documento_cliente: 'cpf_cnpj',
  identificacao: 'cpf_cnpj',

  // --- Nome ---
  nome: 'nome_civil',
  nome_civil: 'nome_civil',
  nome_cliente: 'nome_civil',
  nome_do_cliente: 'nome_civil',
  cliente: 'nome_civil',
  razao_social: 'nome_civil',
  nome_razao_social: 'nome_civil',
  segurado: 'nome_civil',
  nome_segurado: 'nome_civil',
  nome_social: 'nome_social',
  nome_fantasia: 'nome_social',

  // --- Pessoa ---
  profissao: 'profissao',
  ocupacao: 'profissao',
  sexo: 'sexo',
  genero: 'sexo',
  estado_civil: 'estado_civil',
  data_nascimento: 'data_nascimento',
  data_de_nascimento: 'data_nascimento',
  nascimento: 'data_nascimento',
  dt_nascimento: 'data_nascimento',

  // --- Contato ---
  email: 'email',
  e_mail: 'email',
  email_pessoal: 'email',
  correio_eletronico: 'email',
  email_comercial: 'email_comercial',
  email_empresa: 'email_comercial',

  celular: 'celular',
  telefone_celular: 'celular',
  tel_celular: 'celular',
  fone_celular: 'celular',
  ddd_celular: 'ddd_celular',
  celular_completo: 'celular_completo',
  telefone_residencial: 'telefone_residencial',
  tel_residencial: 'telefone_residencial',
  fone_residencial: 'telefone_residencial',
  telefone_fixo: 'telefone_residencial',
  ddd_residencial: 'ddd_residencial',
  telefone_comercial: 'telefone_comercial',
  tel_comercial: 'telefone_comercial',
  ddd_comercial: 'ddd_comercial',

  // --- Endereço ---
  logradouro: 'logradouro',
  endereco: 'logradouro',
  rua: 'logradouro',
  numero: 'numero',
  num: 'numero',
  nr: 'numero',
  complemento: 'complemento',
  bairro: 'bairro',
  cidade: 'cidade',
  municipio: 'cidade',
  uf: 'uf',
  estado: 'uf',
  cep: 'cep',

  // --- Produto ---
  ramo: 'ramo_descricao',
  ramo_descricao: 'ramo_descricao',
  descricao_ramo: 'ramo_descricao',
  modalidade: 'modalidade',
  produto: 'modalidade',
  seguradora: 'seguradora',
  cia: 'seguradora',
  companhia: 'seguradora',

  // --- Comercial ---
  produtor: 'produtor',
  vendedor: 'produtor',
  corretor: 'produtor',
  consultor: 'produtor',
  estrutura_vendas: 'estrutura_vendas',
  filial: 'estrutura_vendas',
  unidade: 'estrutura_vendas',
  sucursal: 'estrutura_vendas',
  origem_cliente: 'origem_cliente',
  origem: 'origem_cliente',

  // --- Situação e datas ---
  situacao: 'situacao',
  status: 'situacao',
  situacao_cliente: 'situacao',
  situacao_em: 'situacao_em',
  saida_em: 'saida_em',
  data_saida: 'saida_em',
  cliente_desde: 'cliente_desde',
  data_cadastro: 'cliente_desde',
  cadastrado_em: 'cliente_desde',

  // --- Perfil ---
  renda: 'renda',
  faixa_renda: 'renda',
  faturamento_anual: 'faturamento_anual',
  faturamento: 'faturamento_anual',
  cliente_vip: 'cliente_vip',
  vip: 'cliente_vip',
  autoriza_contato: 'autoriza_contato',
};

export interface ColunaMapeada {
  /** Como veio no arquivo. */
  origem: string;
  /** Nome canônico que o importador entende, ou null se não reconhecida. */
  canonica: string | null;
  /** De onde veio a tradução — útil para depurar um layout novo. */
  via: 'canonica' | 'perfil' | 'global' | null;
}

/** Traduz o cabeçalho inteiro: índice canônico → posição e o relatório para a prévia. */
export function mapearCabecalho(
  cabecalho: string[],
  conhecidas: Set<string>,
  aliasesDoPerfil: Record<string, string> = {},
): { indice: Map<string, number>; colunas: ColunaMapeada[] } {
  const indice = new Map<string, number>();
  const colunas: ColunaMapeada[] = [];

  cabecalho.forEach((bruto, posicao) => {
    const normalizado = normalizarNomeColuna(bruto);

    if (!normalizado) {
      colunas.push({ origem: bruto, canonica: null, via: null });
      return;
    }

    let canonica: string | null = null;
    let via: ColunaMapeada['via'] = null;

    if (aliasesDoPerfil[normalizado]) {
      canonica = aliasesDoPerfil[normalizado]!;
      via = 'perfil';
    } else if (conhecidas.has(normalizado)) {
      canonica = normalizado;
      via = 'canonica';
    } else if (ALIASES_GLOBAIS[normalizado]) {
      canonica = ALIASES_GLOBAIS[normalizado]!;
      via = 'global';
    }

    colunas.push({ origem: bruto.trim(), canonica, via });

    // A PRIMEIRA ocorrência vence: a coluna da direita costuma ser a redundante.
    if (canonica && !indice.has(canonica)) {
      indice.set(canonica, posicao);
    }
  });

  return { indice, colunas };
}

/**
 * Acha a linha de cabeçalho (a que reconhece mais colunas) numa planilha com
 * título e totalizadores antes da tabela — por conteúdo, não por posição.
 */
export function encontrarLinhaDeCabecalho(
  grade: string[][],
  aliases: Record<string, string>,
  conhecidas: Set<string>,
  minimoDeAcertos = 3,
): number {
  let melhor = -1;
  let melhorPontos = 0;

  // Só as primeiras linhas: mais abaixo, uma linha de dados poderia bater com nomes de coluna.
  const limite = Math.min(grade.length, 30);

  for (let i = 0; i < limite; i += 1) {
    const linha = grade[i] ?? [];
    let pontos = 0;

    for (const celula of linha) {
      const chave = normalizarNomeColuna(celula ?? '');
      if (!chave) continue;
      if (aliases[chave] || conhecidas.has(chave) || ALIASES_GLOBAIS[chave]) pontos += 1;
    }

    if (pontos > melhorPontos) {
      melhorPontos = pontos;
      melhor = i;
    }
  }

  return melhorPontos >= minimoDeAcertos ? melhor : -1;
}

/**
 * Realinha o dado ao cabeçalho quando células mescladas do `.xls` (Bradesco a
 * renovar) os deslocam: a k-ésima coluna ocupada do cabeçalho é a k-ésima do
 * dado. Contagens diferentes = recusa. Linha com menos da metade preenchida é rodapé.
 */
export function realinharColunasDeslocadas(grade: string[][], indiceCabecalho: number): string[][] {
  const ocupadas = (linha: string[]): number[] =>
    linha.flatMap((c, i) => ((c ?? '').trim() ? [i] : []));

  const cabecalho = grade[indiceCabecalho] ?? [];
  const colunasCabecalho = ocupadas(cabecalho);
  const minimo = Math.ceil(colunasCabecalho.length / 2);

  const linhasDeDado = grade
    .slice(indiceCabecalho + 1)
    .filter((l) => ocupadas(l).length >= minimo);

  const colunasDado = [...new Set(linhasDeDado.flatMap(ocupadas))].sort((a, b) => a - b);

  if (linhasDeDado.length > 0 && colunasDado.length !== colunasCabecalho.length) {
    throw new Error(
      `O cabeçalho tem ${colunasCabecalho.length} colunas e os dados ocupam ${colunasDado.length}. ` +
        'O arquivo não tem a forma esperada para este layout.',
    );
  }

  const novaLinha = (l: string[]): string[] => {
    const saida = new Array<string>(cabecalho.length).fill('');
    colunasDado.forEach((origem, k) => {
      saida[colunasCabecalho[k]!] = l[origem] ?? '';
    });
    return saida;
  };

  return [...grade.slice(0, indiceCabecalho + 1), ...linhasDeDado.map(novaLinha)];
}
