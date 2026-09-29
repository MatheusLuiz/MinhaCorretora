import { api } from '@/lib/api';

/** Cliente da API de apólices. */

export type SituacaoVigencia = 'vigente' | 'a_vencer' | 'vencida' | 'indefinida';

export interface Apolice {
  id: string;
  numero: string;
  seguradora: string;
  produto: string | null;

  nomeSegurado: string;
  /** Preenchido quando a apólice está ligada a um cliente da base. */
  clienteId: string | null;
  clienteNome: string | null;
  /** `nome` = vínculo por semelhança de nome, merece conferência. */
  vinculoOrigem: string | null;

  emitidaEm: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  situacao: SituacaoVigencia;

  premioTotal: number | null;
  premioLiquido: number | null;

  movimentos: number;
}

export interface ResumoApolices {
  apolices: number;
  movimentos: number;
  semCliente: number;
  comVinculoPorNome: number;
  produtos: number;
  porTipo: Record<string, number>;
  seguradoras: string[];
  conciliacao: {
    semCandidato: number;
    umCandidato: number;
    variosCandidatos: number;
  };
}

export interface ResultadoApolices {
  total: number;
  pagina: number;
  limite: number;
  paginas: number;
  apolices: Apolice[];
}

export interface ParametrosApolices {
  busca?: string;
  seguradora?: string;
  semCliente?: 'sim' | 'nao';
  pagina?: number;
  limite?: number;
}

function montarQuery(parametros: ParametrosApolices): string {
  const query = new URLSearchParams();

  for (const [chave, valor] of Object.entries(parametros)) {
    // Campo vazio é ausência de filtro, não filtro por vazio.
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
      query.set(chave, String(valor));
    }
  }

  const texto = query.toString();
  return texto ? `?${texto}` : '';
}

export const ROTULO_SITUACAO: Record<SituacaoVigencia, string> = {
  vigente: 'Vigente',
  a_vencer: 'A iniciar',
  vencida: 'Vencida',
  indefinida: 'Sem vigência',
};

export const apolicesApi = {
  listar: (parametros: ParametrosApolices = {}) =>
    api.get<ResultadoApolices>(`/apolices${montarQuery(parametros)}`),

  resumo: () => api.get<ResumoApolices>('/apolices/resumo'),
};
