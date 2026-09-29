import { api } from '@/lib/api';

/** Cliente da API de clientes: `ClienteResumo` (listagem, sem dado pessoal) e `ClienteCompleto` (ficha). */

export interface ClienteResumo {
  id: string;
  nome: string;
  tipoPessoa: 'Física' | 'Jurídica';
  cpfCnpj: string;
  email: string | null;
  celular: string | null;
  cidade: string | null;
  uf: string | null;
  seguradora: string | null;
  produtor: string | null;
  vip: boolean;
  situacao: string | null;
  situacaoChave: string | null;
  origem: string;
}

export interface TelefoneFicha {
  tipo: 'celular' | 'whatsapp' | 'residencial' | 'comercial' | 'recado' | 'opcional';
  rotulo: string;
  numero: string;
  /** Anotação do operador. Opcional: backend anterior à 040 não manda. */
  observacao?: string | null;
  principal: boolean;
}

export interface EmailFicha {
  tipo: 'pessoal' | 'comercial' | 'financeiro' | 'outro';
  rotulo: string;
  endereco: string;
  observacao?: string | null;
  principal: boolean;
}

export interface EnderecoFicha {
  tipo: 'principal' | 'comercial' | 'cobranca';
  rotulo: string;
  linha: string | null;
  /** Campos soltos para a edição. Opcionais: backend anterior não manda. */
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

export interface SeguradoFicha {
  ordem: number;
  nome: string | null;
  cpf: string | null;
  rg: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  celular: string | null;
  email: string | null;
}

export interface VinculoFicha {
  seguradora: string;
  ramo: string | null;
  modalidade: string | null;
}

export interface ApoliceFicha {
  id: string;
  numero: string;
  seguradora: string;
  produto: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  situacao: 'vigente' | 'a_vencer' | 'vencida' | 'indefinida';
  premioTotal: number | null;
  movimentos: number;
  /** `nome` = vínculo por semelhança de nome, merece conferência. */
  vinculoOrigem: string | null;
  /** O número da origem se perdeu; o exibido é um `PROV-` e não vale como referência. */
  numeroProvisorio: boolean;
  /** Tipo efetivo (o da apólice, senão o do produto) e o formulário dele. Opcionais. */
  tipoSeguro?: string | null;
  formulario?: string | null;
  veiculo?: VeiculoFicha | null;
}

/** O veículo segurado (formulário `veiculo`: Auto, Frota, Carta Verde). */
export interface VeiculoFicha {
  placa: string | null;
  chassi: string | null;
  fabricante: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  codigoFipe: string | null;
  combustivel: string | null;
  tipoVeiculo: string | null;
  uso: string | null;
  zeroKm: boolean | null;
  antifurto: string | null;
  kitGas: boolean | null;
  cepPernoite: string | null;
  pernoiteGaragem: boolean | null;
  condutorNome: string | null;
  condutorDocumento: string | null;
  condutorNascimento: string | null;
  observacoes: string | null;
  origem: 'importacao' | 'manual';
}

/** O veículo como a nova apólice envia. Vazio = não informado. */
export type VeiculoNovo = Partial<Omit<VeiculoFicha, 'origem'>>;

export interface NovaApolice {
  seguradoraId: number;
  tipoSeguroId: number;
  numero: string;
  produto?: string;
  emitidaEm?: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  tipoNegocio?: 'novo' | 'renovacao' | null;
  premioTotal?: number | null;
  premioLiquido?: number | null;
  veiculo?: VeiculoNovo;
}

/** Pessoa de contato de cliente empresa. Telefone já formatado. */
export interface ResponsavelContato {
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
}

/** Matriz ou filial do mesmo grupo empresarial. */
export interface ClienteDoGrupo {
  id: string;
  nome: string;
  cpfCnpj: string;
  situacao: string | null;
  apolices: number;
  apolicesEmVigor: number;
}

/** Um acionamento — sinistro ou assistência. Espelha `SinistroFicha` do backend. */
export interface SinistroFicha {
  numero: string;
  apolice: string;
  seguradora: string;
  tipo: 'sinistro' | 'assistencia';
  ramo: string | null;
  cobertura: string | null;
  causa: string | null;
  ocorridoEm: string | null;
  comunicadoEm: string | null;
  status: string | null;
  reserva: number | null;
  veiculo: string | null;
  /** `nome` = a apólice é do período anterior; ligado pelo nome do segurado. */
  vinculoOrigem: 'apolice' | 'nome' | null;
}

export interface ClienteCompleto extends ClienteResumo {
  /** Tipos de seguro de interesse (046). Opcional: backend anterior não manda. */
  tiposInteresse?: string[];
  /** Grupo de cliente (Corretora, Seguradora…). Opcional. Não confundir com `grupo` (matriz e filiais). */
  grupoCliente?: { chave: string; nome: string };
  nomeCivil: string;
  nomeSocial: string | null;
  profissao: string | null;
  sexo: 'M' | 'F' | null;
  estadoCivil: string | null;
  dataNascimento: string | null;
  autorizaContato: boolean;

  /** Listas completas; `email`/`celular`/`cidade`/`uf` do resumo são só o item principal. */
  telefones: TelefoneFicha[];
  emails: EmailFicha[];
  enderecos: EnderecoFicha[];
  segurados: SeguradoFicha[];
  seguradoras: VinculoFicha[];
  apolices: ApoliceFicha[];
  /** Opcional: backend anterior à tabela de sinistros não manda o campo. */
  sinistros?: SinistroFicha[];
  /** `matriz` quando este cliente é filial; `filiais` quando é a matriz. Opcional. */
  grupo?: { matriz: ClienteDoGrupo | null; filiais: ClienteDoGrupo[] };
  /** Pessoas de contato da empresa. Opcional: backend anterior não manda. */
  responsaveis?: ResponsavelContato[];
  /** Aberto pela CONSULTA, fora da própria carteira: só leitura. Opcional. */
  somenteConsulta?: boolean;

  estruturaVendas: string | null;
  estruturaCodigo: string | null;
  origemCliente: string | null;
  renda: string | null;
  faturamentoAnual: number | null;

  clienteDesde: string | null;
  ultimaAlteracaoNaOrigem: string | null;
  importadoEm: string | null;
  origemArquivo: string | null;

  /** O que ainda não tem origem: distingue "sem apólice" de "apólices não importadas". */
  disponibilidade: {
    apolices: boolean;
    sinistros: boolean;
    historico: boolean;
  };
}

export interface ResultadoListagem {
  total: number;
  pagina: number;
  limite: number;
  paginas: number;
  clientes: ClienteResumo[];
}

export interface FiltrosDisponiveis {
  ufs: string[];
  /** Inclui as inativas (o filtro procura no que existe); para atribuir, `seguradorasApi.listar()`. */
  seguradoras: { nome: string; ativa: boolean }[];
  produtores: string[];
  situacoes: { chave: string; nome: string }[];
}

export interface ParametrosListagem {
  busca?: string;
  situacao?: string;
  uf?: string;
  seguradora?: string;
  produtor?: string;
  pagina?: number;
  limite?: number;
}

function montarQuery(parametros: ParametrosListagem): string {
  const query = new URLSearchParams();

  for (const [chave, valor] of Object.entries(parametros)) {
    // Campo vazio é ausência de filtro: sem a guarda, `busca=` procuraria pela string vazia.
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
      query.set(chave, String(valor));
    }
  }

  const texto = query.toString();
  return texto ? `?${texto}` : '';
}

/** O que a tela pode corrigir. Tudo opcional — o corpo é um delta. */
export interface EdicaoDeCliente {
  nome?: string;
  nomeSocial?: string;
  situacao?: string;
  /** Chave do grupo de cliente (057). */
  grupoCliente?: string;
  dataNascimento?: string;
  sexo?: 'M' | 'F';
  estadoCivil?: string;
  profissao?: string;
  /** Listas INTEIRAS: quem não vier é removido. Ausente não mexe. */
  telefones?: { tipo: TelefoneFicha['tipo']; numero: string; observacao?: string }[];
  emails?: { tipo: EmailFicha['tipo']; endereco: string; observacao?: string }[];
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  produtor?: string;
  origemCliente?: string;
  autorizaContato?: boolean;
  vip?: boolean;
  /** Empresa: a lista INTEIRA de responsáveis. Quem não vier é removido. */
  responsaveis?: { nome: string; cargo?: string; telefone?: string; email?: string }[];
}

/** O que a consulta de CEP devolve. Sem complemento: o do CEP é a faixa da rua. */
export interface EnderecoDoCep {
  cep: string;
  logradouro: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  ibge: string | null;
}

/** Sócio no quadro da Receita. O CPF vem mascarado lá, por isso não vem aqui. */
export interface SocioDoCnpj {
  nome: string;
  qualificacao: string | null;
  pessoaJuridica: boolean;
}

/** Empresa nos dados abertos da Receita (BrasilAPI / CNPJ.ws). */
export interface EmpresaDoCnpj {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string | null;
  dataAbertura: string | null;
  matriz: boolean | null;
  atividade: string | null;
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
  };
  telefones: string[];
  email: string | null;
  socios: SocioDoCnpj[];
}

export const clientesApi = {
  listar: (parametros: ParametrosListagem = {}) =>
    api.get<ResultadoListagem>(`/clientes${montarQuery(parametros)}`),

  filtros: () => api.get<FiltrosDisponiveis>('/clientes/filtros'),

  /** Corretor de um cadastro novo; sem `podeEscolher`, é sempre quem está logado. */
  corretores: () =>
    api.get<{ atual: Corretor; podeEscolher: boolean; corretores: Corretor[] }>('/clientes/corretores'),

  detalhar: (id: string) =>
    api.get<{ cliente: ClienteCompleto }>(`/clientes/${encodeURIComponent(id)}`),

  /** Apólice digitada na ficha. Devolve a ficha inteira, já com ela. */
  criarApolice: (id: string, dados: NovaApolice) =>
    api.post<{ cliente: ClienteCompleto; mensagem: string }>(
      `/clientes/${encodeURIComponent(id)}/apolices`,
      dados,
    ),

  /** Corpo em delta: ausente = não mexa, string vazia = apague. */
  editar: (id: string, campos: EdicaoDeCliente) =>
    api.patch<{ cliente: ClienteCompleto; mensagem: string }>(
      `/clientes/${encodeURIComponent(id)}`,
      campos,
    ),

  /** Endereço do CEP (8 dígitos). 404 quando o CEP não existe. */
  consultarCep: (cep: string) =>
    api.get<{ endereco: EnderecoDoCep }>(`/clientes/cep/${encodeURIComponent(cep)}`),

  /** O CPF/CNPJ já tem cadastro? `id` nulo = cadastro de outra carteira (a ficha não abre). */
  verificarDocumento: (documento: string) =>
    api.get<{ existe: false } | { existe: true; nome: string; id: string | null }>(
      `/clientes/documento/${encodeURIComponent(documento)}`,
    ),

  /** Empresa na Receita (CNPJ com 14 dígitos). 404 quando não existe. */
  consultarCnpj: (cnpj: string) =>
    api.get<{ empresa: EmpresaDoCnpj }>(`/clientes/cnpj/${encodeURIComponent(cnpj)}`),

  criar: (dados: Record<string, unknown>) =>
    api.post<{ cliente: { id: string; nome: string; cpfCnpj: string; situacao: string | null }; mensagem: string }>(
      '/clientes',
      dados,
    ),
};

/** Corretor de um cadastro: o USUÁRIO (uuid) que responde pelo cliente. */
export interface Corretor {
  id: string;
  nome: string;
}
