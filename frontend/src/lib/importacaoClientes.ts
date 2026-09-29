import { api, apiRequest, obterAccessToken } from '@/lib/api';

/** Cliente da API de importação e exportação de clientes (planilha como `text/csv` cru). */

export interface ModeloImportacao {
  chave: string;
  nome: string;
  descricao: string;
  /** `finalidade` = o que a planilha quer fazer; `seguradora` = de que arquivo veio. */
  grupo: 'finalidade' | 'seguradora';
  seguradora: string | null;
  situacaoPadrao: string;
  colunas: string[];
  observacoes: string[];
  /** Quantas colunas este layout traduz por conta própria. */
  aliases: number;
}

export interface ColunaMapeada {
  /** Como veio no arquivo. */
  origem: string;
  /** Coluna do sistema, ou null se não reconhecida. */
  canonica: string | null;
  via: 'canonica' | 'perfil' | 'global' | null;
}

export interface SituacaoCliente {
  id: number;
  chave: string;
  nome: string;
  descricao: string | null;
  contaComoCarteira: boolean;
  eSaida: boolean;
}

export interface ImpactoImportacao {
  novos: number;
  existentes: number;
  perdem: {
    telefones: number;
    emails: number;
    enderecos: number;
    segurados: number;
    seguradoras: number;
  };
}

export interface ResultadoImportacao {
  lote: string;
  arquivo: string;
  origem: string;
  simulacao: boolean;

  lidas: number;
  inseridas: number;
  atualizadas: number;
  recusadas: number;

  satelites: {
    telefones: number;
    emails: number;
    enderecos: number;
    segurados: number;
    vinculos: number;
  };
  valoresDistintos: Record<string, number>;

  emailsDescartados: number;
  recusas: { linha: number; motivo: string }[];
  motivosDeRecusa: Record<string, number>;

  colunasReconhecidas: string[];
  colunasIgnoradas: string[];
  /** De que nome no arquivo veio cada coluna do sistema. */
  mapeamento: ColunaMapeada[];

  impacto?: ImpactoImportacao;

  /** Lote de uma importação anterior com conteúdo idêntico. */
  duplicataDe?: string | null;
}

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

/** Download autenticado: o token vai no header, que um `<a href>` não carrega. */
async function baixar(caminho: string, nomeSugerido: string): Promise<void> {
  const token = obterAccessToken();

  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!resposta.ok) {
    throw new Error('Não foi possível baixar o arquivo.');
  }

  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = nomeSugerido;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Sem o revoke, o blob fica preso na memória da aba até ela fechar.
  URL.revokeObjectURL(url);
}

async function enviarPlanilha(
  caminho: string,
  conteudo: string,
  nomeArquivo: string,
): Promise<ResultadoImportacao> {
  return apiRequest<ResultadoImportacao>(caminho, {
    method: 'POST',
    body: conteudo,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // Header HTTP não carrega acento nem espaço com segurança.
      'X-Nome-Arquivo': encodeURIComponent(nomeArquivo),
    },
  });
}

export const importacaoApi = {
  modelos: () =>
    api.get<{ modelos: ModeloImportacao[]; situacoes: SituacaoCliente[] }>(
      '/clientes/importacao/modelos',
    ),

  baixarModelo: (chave: string) =>
    baixar(`/clientes/importacao/modelos/${encodeURIComponent(chave)}`, `modelo-${chave}.csv`),

  exportar: (situacao?: string) =>
    baixar(
      `/clientes/exportar${situacao ? `?situacao=${encodeURIComponent(situacao)}` : ''}`,
      `clientes-${situacao ?? 'todos'}.csv`,
    ),

  previa: (conteudo: string, nomeArquivo: string, modelo: string) =>
    enviarPlanilha(
      `/clientes/importacao/previa?modelo=${encodeURIComponent(modelo)}`,
      conteudo,
      nomeArquivo,
    ),

  /** `seguradora` só decide a pasta da cópia auditável. */
  executar: (conteudo: string, nomeArquivo: string, modelo: string, seguradora?: string | null) =>
    enviarPlanilha(
      `/clientes/importacao?modelo=${encodeURIComponent(modelo)}` +
        (seguradora ? `&seguradora=${encodeURIComponent(seguradora)}` : ''),
      conteudo,
      nomeArquivo,
    ),
};

// ─────────────────────────── Painel de clientes ───────────────────────────

export interface ResumoCarteira {
  /** Na carteira — quem tem apólice em vigor mais quem não teve apólice importada. */
  ativos: number;
  /** Tem apólice EM VIGOR na base. */
  comApoliceVigente: number;
  /** Cliente sem nenhuma apólice importada (entrou por cadastro) — não é perda de carteira. */
  semApoliceConhecida: number;
  /** Teve apólice na base e nenhuma está vigente. */
  inativos: number;
  prospectos: number;
  inadimplentes: number;
  novosNoAno: number;
  perdidosNoAno: number;
  total: number;
}

export interface MovimentoMes {
  periodo: string;
  novos: number;
  perdidos: number;
}

export interface Fatia {
  rotulo: string;
  valor: number;
}

export interface PainelClientes {
  carteira: ResumoCarteira;
  movimento: MovimentoMes[];
  distribuicoes: {
    porSituacao: Fatia[];
    porUf: Fatia[];
    porSeguradora: Fatia[];
    porProdutor: Fatia[];
    porFaixaRenda: Fatia[];
    porTipoPessoa: Fatia[];
  };
  /** Quais análises têm origem hoje; o resto aparece como pendente. */
  disponivel: {
    carteira: boolean;
    movimentoEntradas: boolean;
    movimentoSaidas: boolean;
    frequenciaContratacao: boolean;
    crossSell: boolean;
  };
}

export const painelClientesApi = {
  carregar: () => api.get<PainelClientes>('/clientes/painel'),
};
