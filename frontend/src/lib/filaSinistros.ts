import { api } from '@/lib/api';

/** Contrato de `/filas/sinistros`: fila e números com o MESMO critério. */

export type TipoAcionamento = 'sinistro' | 'assistencia';
/** Derivada no servidor dos dois status da companhia; o movimento manda. */
export type SituacaoAcionamento = 'em_analise' | 'recusado' | 'encerrado';

export interface Acionamento {
  id: number;
  numero: string;
  tipo: TipoAcionamento;
  situacao: SituacaoAcionamento;
  statusProcesso: string | null;
  statusMovimento: string | null;
  ocorridoEm: string | null;
  comunicadoEm: string | null;
  seguradora: string;
  ramo: string | null;
  cobertura: string | null;
  causa: string | null;
  reserva: number | null;
  placa: string | null;
  veiculo: string | null;
  nomeSinistrado: string | null;
  clienteUuid: string | null;
  clienteNome: string | null;
  vinculoOrigem: 'apolice' | 'nome' | null;
  numeroApolice: string;
  apoliceNaBase: boolean;
}

export interface FiltrosSinistros {
  tipo?: TipoAcionamento | '';
  status?: SituacaoAcionamento | '';
  seguradora?: string;
  mes?: string;
  /** Causa como o dashboard de Sinistros agrupa (sem causa, a cobertura). */
  causa?: string;
}

export interface ListaSinistros {
  acionamentos: Acionamento[];
  opcoes: { seguradoras: string[]; meses: string[] };
}

export interface ResumoSinistros {
  sinistros: { total: number; emAnalise: number; recusados: number; reservaEmAnalise: number };
  assistencias: { total: number; emAnalise: number };
  frequencia: { cobertas: number; comSinistro: number; comAssistencia: number };
  porMes: { periodo: string; tipo: TipoAcionamento; quantidade: number }[];
  tipos: { tipo: string; apolices: number; emVigor: number; premioEmVigor: number; comPremio: number }[];
  // Opcionais: backend anterior não manda — leia com `Array.isArray`.
  porSeguradora?: {
    seguradora: string;
    tipo: TipoAcionamento;
    situacao: SituacaoAcionamento;
    quantidade: number;
    reserva: number;
  }[];
  porCausa?: { causa: string; tipo: TipoAcionamento; quantidade: number }[];
  /** Há quanto tempo o que está em análise foi comunicado. */
  idadeDosAbertos?: { tipo: TipoAcionamento; faixa: 'ate15' | 'ate30' | 'ate60' | 'mais60' | 'sem_data'; quantidade: number }[];
  /** Por seguradora com apólice em vigor: tem relatório de sinistros? `comMarca` = "possui sinistro" da origem. */
  cobertura?: { seguradora: string; emVigor: number; comMarca: number; temRelatorio: boolean }[];
  /** Acionamentos que não casaram com cliente da base. */
  semCliente?: number;
}

export const ROTULO_SITUACAO: Record<SituacaoAcionamento, string> = {
  em_analise: 'Em análise',
  recusado: 'Recusado',
  encerrado: 'Encerrado',
};

export const ROTULO_TIPO: Record<TipoAcionamento, string> = {
  sinistro: 'Sinistro',
  assistencia: 'Assistência',
};

export const filaSinistrosApi = {
  listar(filtros: FiltrosSinistros): Promise<ListaSinistros> {
    const q = new URLSearchParams();
    for (const [chave, valor] of Object.entries(filtros)) if (valor) q.set(chave, valor);
    const texto = q.toString();
    return api.get<ListaSinistros>(`/filas/sinistros${texto ? `?${texto}` : ''}`);
  },
  resumo(): Promise<ResumoSinistros> {
    return api.get<ResumoSinistros>('/filas/sinistros/resumo');
  },
};
