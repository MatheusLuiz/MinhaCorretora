import { api, apiRequest, obterAccessToken } from '@/lib/api';

/** Cliente da API financeira, de importação de arquivos e de auditoria. */

export interface LayoutArquivo {
  chave: string;
  nome: string;
  seguradora: string;
  descricao: string;
  observacoes: string[];
  tipoArquivo?: 'movimentos' | 'carteira';
  entidade?: 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas';
  /** Carteira: o arquivo cobre várias companhias, não é do portal de uma só. */
  sistema?: boolean;
  /** Extensões aceitas, quando não são as de planilha (PDF do Bradesco). */
  aceita?: string;
}

export interface ResultadoArquivo {
  lote: string;
  arquivo: string;
  layout: string;
  simulacao: boolean;
  linhas: number;
  recusadas: number;
  motivosDeRecusa: Record<string, number>;
  mapeamento: { origem: string; canonica: string | null; via: string | null }[];
  colunasIgnoradas: string[];
  /** Lote de uma importação anterior com conteúdo idêntico. */
  duplicataDe?: string | null;

  // Apólices
  apolices?: number;
  movimentos?: number;
  porTipo?: Record<string, number>;
  produtos?: string[];
  semCabecalhoCompleto?: number;
  vinculadas?: number;
  vinculadasPorDocumento?: number;
  vinculosCorrigidos?: number;
  semCliente?: number;

  // Conferência de extrato, não carga: sem `linhas` nem `lote`; a tela reconhece por `ordensNoExtrato`.
  ordensNoExtrato?: number;
  conferidas?: number;
  faltando?: { ordem: string; pagoEm: string | null; bruto: number; liquido: number }[];
  divergentes?: { ordem: string; extrato: number; sistema: number; diferenca: number }[];
  sobrando?: { ordem: string; competencia: string; bruto: number }[];
  totalExtrato?: { bruto: number; liquido: number };
  totalSistema?: { bruto: number; liquido: number };
  diferencaBruta?: number;

  /** Parcelas: cadastros consertados com o dado limpo da cobrança. */
  nomesDesmascarados?: number;
  telefonesGanhos?: number;

  // Financeiro
  entidade?: 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas';
  gravadas?: number;
  apolicesCriadas?: number;
  clientesInadimplentes?: number;
  inadimplentesMarcados?: number;
  /** Parcelas: avisos de primeiro atraso criados para os corretores. */
  corretoresAvisados?: number;
  /** Parcelas: clientes no primeiro atraso sem corretor com usuário para avisar. */
  primeiroAtrasoSemCorretor?: number;
  competencia?: string;
  totalLiquido?: number;
  linhaDoCabecalho?: number;

  /** Sinistros: assistência conta à parte — guincho não é sinistro. */
  sinistros?: number;
  assistencias?: number;
  sinistrosSemCliente?: number;

  /** Renovações: lista de apólices a renovar. */
  renovacoes?: number;
  renovacoesComPremio?: number;
  renovacoesSemCliente?: number;
  renovacoesComissaoNaApolice?: number;

  /** Encerradas: lista de apólices que a seguradora encerrou. */
  encerradas?: number;
  encerradasRenovadas?: number;
  encerradasAntesDoPrazo?: number;
  encerradasSemCliente?: number;
}

/** Como a resposta foi recortada: distingue carteira em dia de usuário sem produtor vinculado. */
export interface RecorteFinanceiro {
  /** A resposta está limitada à carteira do usuário. */
  carteiraPropria: boolean;
  /** Recortado, mas sem nenhum produtor vinculado: não é carteira em dia. */
  semCarteira: boolean;
  /** Falso = só o cliente com um único atraso aparece. */
  inadimplenciaCompleta: boolean;
  comissoesTodas: boolean;
}

/** Uma linha que o importador não resolve sozinho. */
export interface Pendencia {
  /** Linha no arquivo, com o cabeçalho contando como 1 — como no Excel. */
  linha: number;
  tipo:
    | 'sem_documento'
    | 'documento_invalido'
    | 'sem_apolice'
    | 'apolice_ilegivel'
    | 'sem_corretor';
  descricao: string;
  /** Qual campo dá para digitar, ou null quando não há conserto aqui. */
  corrigivel: 'documento' | 'produtor' | null;
  nome: string;
  documento: string;
  apolice: string;
  seguradora: string;
  produtor: string;
}

/** O que a conferência devolve preenchido. */
export interface Correcao {
  linha: number;
  documento?: string;
  produtor?: string;
  /** Tira a linha da carga. */
  ignorar?: boolean;
}

/** Resultado de importação de CARTEIRA (cliente e apólice na mesma linha). */
export interface ResultadoCarteira {
  lote: string;
  arquivo: string;
  layout: string;
  simulacao: boolean;
  /** A codificação detectada. `windows-1252` é a pista de que passou pelo Excel. */
  codificacao: string;

  linhas: number;
  recusadas: number;
  motivosDeRecusa: Record<string, number>;

  clientes: {
    novos: number;
    existentes: number;
    gravados: number;
    /** Contatos gravados. Mascarados pelo portal são descartados e não contam. */
    emails: number;
    telefones: number;
    /** Mudaram de situação no recálculo que roda ao fim da carga. */
    ativados: number;
    inativados: number;
  };
  apolices: {
    novas: number;
    existentes: number;
    gravadas: number;
    semNumero: number;
    /** Número destruído pelo Excel (3,1002E+14) — irrecuperável. */
    numeroIlegivel: number;
    vinculadas: number;
  };

  seguradorasNovas: string[];
  mapeamento: { origem: string; canonica: string | null; via: string | null }[];
  colunasIgnoradas: string[];
  amostraIlegivel: string[];

  pendencias: Pendencia[];
  pendenciasOcultas: number;
  pendenciasPorTipo: Record<string, number>;
  documentosJaCadastrados: { linha: number; documento: string; cliente: string }[];

  duplicataDe?: string | null;

  /** Só no PDF do Bradesco: a apólice lida e as parcelas que vieram com ela. */
  pdf?: {
    apolice: string;
    parcelas: number;
    parcelasGravadas: number;
    somaConfere: boolean;
    avisos: string[];
  };
}

export interface ResumoFinanceiro {
  parcelas: number;
  parcelasAtrasadas: number;
  valorEmAtraso: number;
  clientesInadimplentes: number;
  apolicesComAtraso: number;
  atrasoSemCliente: number;
  /** Mais de 30 dias de atraso. Opcionais: backend anterior não manda. */
  parcelasAtrasoGrave?: number;
  valorAtrasoGrave?: number;
  comissoes: number;
  comissaoLiquida: number;
  competencias: string[];
  comissaoPorFilial: { rotulo: string; valor: number; lancamentos: number }[];
  comissaoPorCompetencia: { rotulo: string; valor: number }[];
  recorte: RecorteFinanceiro;
}

export interface ParcelaAtrasada {
  apolice: string;
  nomeSegurado: string;
  temCliente: boolean;
  /** Id público do cliente, para abrir a ficha a partir da linha. */
  clienteId: string | null;
  /** Corretor do cadastro do cliente; `null` quando a apólice ainda não está ligada a um cliente. */
  produtor: string | null;
  situacaoCliente: string | null;
  seguradora: string;
  produto: string | null;
  parcela: number;
  vencimento: string | null;
  valor: number;
  formaPagamento: string | null;
  motivoRejeicao: string | null;
  diasEmAtraso: number;
}

export interface LancamentoComissao {
  competencia: string;
  seguradora: string;
  filial: string | null;
  /** A filial, ou o tipo único da seguradora quando o recibo não traz (Suhai = Auto). Opcional: backend anterior não manda. */
  tipoServico?: string | null;
  numero: string;
  tipo: string | null;
  totalBruto: number;
  desconto: number;
  impostos: number;
  totalLiquido: number;
  pagoEm: string | null;
  formaPagamento: string | null;
}

export interface ArquivoAuditoria {
  lote: string;
  seguradora: string | null;
  caminho: string;
  nome_original: string;
  extensao: string;
  tamanho_bytes: number;
  sha256: string;
  entidade: string;
  layout: string | null;
  origem_sistema: string;
  importado_em: string;
  importado_por: string | null;
  desfeito_em: string | null;
  motivo_desfazimento: string | null;
  resultado: unknown;
}

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

/** Envia como binário cru: .xlsx é zip, convertê-lo para string corromperia os bytes. */
async function enviarArquivo(
  caminho: string,
  arquivo: File,
): Promise<ResultadoArquivo> {
  const conteudo = await arquivo.arrayBuffer();

  return apiRequest<ResultadoArquivo>(caminho, {
    method: 'POST',
    body: conteudo,
    headers: {
      'Content-Type': 'application/octet-stream',
      // Header não carrega acento com segurança, e nome de planilha costuma ter.
      'X-Nome-Arquivo': encodeURIComponent(arquivo.name),
    },
  });
}

/** Download autenticado: o token vive em memória e não viaja numa navegação. */
async function baixar(caminho: string, nomeSugerido: string): Promise<void> {
  const token = obterAccessToken();

  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!resposta.ok) throw new Error('Não foi possível baixar o arquivo.');

  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = nomeSugerido;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export const arquivosApi = {
  layouts: () =>
    api.get<{
      apolices: LayoutArquivo[];
      financeiro: LayoutArquivo[];
      carteira: LayoutArquivo[];
      /** Layouts ocultos e o motivo (ex.: seguradora desativada), para não sumirem em silêncio. */
      ocultos: {
        nome: string;
        seguradora: string;
        motivo: 'inativa' | 'nao_cadastrada';
      }[];
    }>('/importacao/layouts'),

  importarApolices: (
    arquivo: File,
    layout: string,
    simular: boolean,
    seguradora: string,
    vincular = true,
  ) =>
    enviarArquivo(
      `/importacao/apolices?layout=${encodeURIComponent(layout)}&simular=${simular}` +
        `&vincular=${vincular}&seguradora=${encodeURIComponent(seguradora)}`,
      arquivo,
    ),

  importarFinanceiro: (
    arquivo: File,
    layout: string,
    simular: boolean,
    seguradora: string,
    marcarInadimplentes = false,
  ) =>
    enviarArquivo(
      `/importacao/financeiro?layout=${encodeURIComponent(layout)}&simular=${simular}` +
        `&marcarInadimplentes=${marcarInadimplentes}&seguradora=${encodeURIComponent(seguradora)}`,
      arquivo,
    ),

  /** Guarda as correções da conferência e devolve um bilhete: o corpo da importação já é o arquivo. */
  guardarCorrecoes: (correcoes: Correcao[]) =>
    api.post<{ bilhete: string; total: number }>('/importacao/correcoes', { correcoes }),

  /** Carteira: o único caminho que cria CLIENTE a partir de um relatório. */
  importarCarteira: (
    arquivo: File,
    layout: string,
    simular: boolean,
    seguradora: string,
    bilheteDeCorrecoes?: string,
  ) =>
    enviarArquivo(
      `/importacao/carteira?layout=${encodeURIComponent(layout)}&simular=${simular}` +
        `&seguradora=${encodeURIComponent(seguradora)}` +
        (bilheteDeCorrecoes ? `&correcoes=${encodeURIComponent(bilheteDeCorrecoes)}` : ''),
      arquivo,
    ) as unknown as Promise<ResultadoCarteira>,

  auditoria: () => api.get<{ arquivos: ArquivoAuditoria[] }>('/importacao/arquivos'),

  baixarOriginal: (lote: string, nome: string) =>
    baixar(`/importacao/arquivos/${encodeURIComponent(lote)}`, nome),

  desfazer: (lote: string, motivo: string) =>
    api.post<{ lote: string; removidos: Record<string, number> }>(
      `/importacao/arquivos/${encodeURIComponent(lote)}/desfazer`,
      { motivo },
    ),
};

export const financeiroApi = {
  /** `seguradora`: o nome, como o cadastro grafa. Recorta só a inadimplência. */
  resumo: (seguradora?: string) =>
    api.get<ResumoFinanceiro>(
      seguradora ? `/financeiro/resumo?seguradora=${encodeURIComponent(seguradora)}` : '/financeiro/resumo',
    ),
  inadimplencia: (seguradora?: string) =>
    api.get<{ parcelas: ParcelaAtrasada[] }>(
      seguradora
        ? `/financeiro/inadimplencia?seguradora=${encodeURIComponent(seguradora)}`
        : '/financeiro/inadimplencia',
    ),
  /** Com período (`AAAA-MM`), só os pagos nele; sem, os 200 mais recentes. */
  comissoes: (periodo?: { de: string; ate: string }) =>
    api.get<{ lancamentos: LancamentoComissao[] }>(
      periodo
        ? `/financeiro/comissoes?de=${periodo.de}&ate=${periodo.ate}`
        : '/financeiro/comissoes',
    ),

  comissaoPeriodo: (de: string, ate: string) =>
    api.get<ComissaoDoPeriodo>(`/financeiro/comissoes/periodo?de=${de}&ate=${ate}`),

  /** A receber parcela a parcela — a Fila de comissões. `de`/`ate` em AAAA-MM. */
  parcelasAReceber: (de: string, ate: string) =>
    api.get<{ parcelas: ParcelaAReceber[] }>(`/financeiro/comissoes/parcelas?de=${de}&ate=${ate}`),
};

/** Parcela não paga com a comissão estimada; a soma bate com a da tela Comissões. */
export interface ParcelaAReceber {
  parcelaId: number;
  mes: string;
  vencimento: string | null;
  situacao: 'aberto' | 'atraso';
  seguradora: string;
  apolice: string;
  numeroParcela: number;
  valor: number;
  /** Estimada: valor × taxa da apólice. NULL = a seguradora não informa a taxa. */
  comissao: number | null;
  percentual: number | null;
  clienteUuid: string | null;
  cliente: string;
  corretor: string | null;
  telefone: string | null;
  email: string | null;
}

/** Comissão que ENTROU no período: demonstrativo, pela data do pagamento. */
export interface RecebidoNoPeriodo {
  mes: string;
  seguradora: string;
  lancamentos: number;
  bruto: number;
  impostos: number;
  liquido: number;
}

/** Comissão a entrar: parcelas não pagas × taxa, pelo vencimento (estimativa). */
export interface PendenteNoPeriodo {
  seguradora: string;
  parcelas: number;
  premio: number;
  comissao: number;
  /** Parcelas de apólice sem taxa de comissão conhecida (Bradesco, hoje). */
  semTaxaParcelas: number;
  semTaxaPremio: number;
}

export interface ComissaoDoPeriodo {
  meses: string[];
  recebido: RecebidoNoPeriodo[];
  pendente: (PendenteNoPeriodo & { mes: string; situacao: 'aberto' | 'atraso' })[];
  /** Venceram antes do período e seguem sem pagamento. */
  atrasoAnterior: PendenteNoPeriodo[];
}

export interface ComissaoDeCliente {
  clienteId: string;
  nome: string;
  cpfCnpj: string | null;
  situacao: string | null;
  produtor: string | null;
  apolices: number;
  premio: number;
  comissao: number;
  /** Comissão sobre prêmio. Nulo quando não há prêmio conhecido. */
  percentual: number | null;
}

/** Comissão por cliente, de `apolices.comissao` (o demonstrativo da seguradora vem por filial). */
export const comissaoClientesApi = {
  /** Com período (`AAAA-MM`), só as apólices EMITIDAS nele. */
  carregar: (periodo?: { de: string; ate: string }) =>
    api.get<{
      clientes: ComissaoDeCliente[];
      totais: { clientes: number; apolices: number; comissao: number; premio: number };
    }>(
      periodo
        ? `/financeiro/comissoes/por-cliente?de=${periodo.de}&ate=${periodo.ate}`
        : '/financeiro/comissoes/por-cliente',
    ),
};
