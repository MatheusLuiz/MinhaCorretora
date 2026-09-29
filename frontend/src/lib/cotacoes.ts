import { api } from '@/lib/api';

/** Cliente da API de cotações (046). Espelha `routes/cotacoes.routes.ts`. */

export type SituacaoCotacao = 'em_cotacao' | 'enviada' | 'fechada' | 'perdida';

export const ROTULO_SITUACAO: Record<SituacaoCotacao, string> = {
  em_cotacao: 'Em cotação',
  enviada: 'Enviada ao cliente',
  fechada: 'Fechada',
  perdida: 'Perdida',
};

export const CLASSE_SITUACAO: Record<SituacaoCotacao, string> = {
  em_cotacao: 'etiqueta--atencao',
  enviada: 'etiqueta--tranquilo',
  fechada: 'etiqueta--ok',
  perdida: 'etiqueta--critico',
};

export interface CotacaoResumo {
  id: string;
  situacao: SituacaoCotacao;
  cliente: { id: string; nome: string; cpfCnpj: string | null };
  corretor: string | null;
  tipos: string[];
  propostas: number;
  menorPremio: number | null;
  criadaEm: string;
  encerradaEm: string | null;
}

export interface VeiculoCotacao {
  placa: string | null;
  chassi: string | null;
  fabricante: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  codigoFipe: string | null;
  uso: string | null;
  zeroKm: boolean | null;
  cepPernoite: string | null;
  condutorNome: string | null;
  condutorDocumento: string | null;
  condutorNascimento: string | null;
}

export interface PropostaCotacao {
  id: number;
  seguradoraId: number;
  seguradora: string;
  tipoSeguroId: number;
  tipoSeguro: string;
  premio: number;
  franquia: number | null;
  formaPagamento: string | null;
  observacao: string | null;
  escolhida: boolean;
}

export interface CotacaoDetalhe extends Omit<CotacaoResumo, 'propostas'> {
  observacoes: string | null;
  motivoPerda: string | null;
  tiposDetalhe: { id: number; nome: string; formulario: string }[];
  veiculo: VeiculoCotacao | null;
  propostas: PropostaCotacao[];
  /** As seguradoras que oferecem cada tipo (Configurações › Tipos de seguro). */
  seguradorasPorTipo: { tipoSeguroId: number; seguradoras: { id: number; nome: string }[] }[];
}

export interface NovaCotacao {
  clienteId?: string;
  novoCliente?: { cpfCnpj: string; nome: string; telefone?: string; email?: string };
  corretor?: string;
  tipos: number[];
  veiculo?: Partial<VeiculoCotacao>;
  observacoes?: string;
}

export interface NovaProposta {
  seguradoraId: number;
  tipoSeguroId: number;
  premio: number;
  franquia?: number | null;
  formaPagamento?: string;
  observacao?: string;
}

export const cotacoesApi = {
  listar: (situacao?: SituacaoCotacao) =>
    api.get<{ cotacoes: CotacaoResumo[] }>(`/cotacoes${situacao ? `?situacao=${situacao}` : ''}`),

  detalhar: (id: string) => api.get<{ cotacao: CotacaoDetalhe }>(`/cotacoes/${encodeURIComponent(id)}`),

  criar: (dados: NovaCotacao) => api.post<{ cotacao: CotacaoDetalhe }>('/cotacoes', dados),

  adicionarProposta: (id: string, dados: NovaProposta) =>
    api.post<{ cotacao: CotacaoDetalhe }>(`/cotacoes/${encodeURIComponent(id)}/propostas`, dados),

  removerProposta: (id: string, propostaId: number) =>
    api.delete<{ cotacao: CotacaoDetalhe }>(`/cotacoes/${encodeURIComponent(id)}/propostas/${propostaId}`),

  definirSituacao: (
    id: string,
    dados: { situacao: SituacaoCotacao; motivoPerda?: string; propostaEscolhidaId?: number | null },
  ) => api.patch<{ cotacao: CotacaoDetalhe }>(`/cotacoes/${encodeURIComponent(id)}/situacao`, dados),
};
