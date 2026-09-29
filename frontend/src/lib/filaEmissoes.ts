import { api } from '@/lib/api';

/** Fila de emissões e resumo de Produção. "Emitida no mês" = início de vigência no mês. */

export interface LinhaEmissao {
  uuid: string;
  numero: string;
  seguradora: string;
  tipoSeguro: string | null;
  segurado: string;
  clienteUuid: string | null;
  /** Dono da carteira do cliente. Nenhuma apólice traz vendedor hoje. */
  corretor: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  premio: number | null;
  /** `null` = a origem não informa — nunca "novo". */
  tipoNegocio: 'novo' | 'renovacao' | null;
}

export interface ResultadoFilaEmissoes {
  total: number;
  premio: number;
  /** Mais linhas que o teto do servidor: a tela pede um filtro de ano. */
  limitado: boolean;
  linhas: LinhaEmissao[];
}

export interface MesSeguradora {
  mes: string;
  seguradora: string;
  apolices: number;
  comPremio: number;
  premio: number;
}

export type Negocio = 'novo' | 'renovacao' | 'nao_informado';

export interface MesNegocio {
  mes: string;
  /** `nao_informado` = a origem não disse; nunca somado a "novo". */
  negocio: Negocio;
  apolices: number;
  premio: number;
}

export interface ResumoEmissoes {
  meses: MesSeguradora[];
  /** Opcional: backend anterior não manda. Mesma janela e total de `meses`. */
  negocios?: MesNegocio[];
  /** Mês anterior até o mesmo dia de hoje: a variação compara intervalos iguais. */
  anteriorAteHoje: { apolices: number; comPremio: number; premio: number };
  futuras: number;
  semInicio: number;
  /** Anos com apólice, do mais novo ao mais antigo. Opcional: backend anterior não manda. */
  anos?: number[];
}

export const filaEmissoesApi = {
  listar: (filtro: { de?: string; ate?: string } = {}) => {
    const q = new URLSearchParams();
    if (filtro.de) q.set('de', filtro.de);
    if (filtro.ate) q.set('ate', filtro.ate);
    const texto = q.toString();
    return api.get<ResultadoFilaEmissoes>(`/filas/emissoes${texto ? `?${texto}` : ''}`);
  },
  /** Sem ano: os últimos 12 meses. Com ano: os 12 meses daquele ano. */
  resumo: (ano?: string) => api.get<ResumoEmissoes>(`/filas/emissoes/resumo${ano ? `?ano=${ano}` : ''}`),
};
