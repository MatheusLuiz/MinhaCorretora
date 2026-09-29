import { api } from '@/lib/api';

/** Cliente da API de cadastro de seguradoras e da integração de cada uma. */

export type TipoIntegracao = 'nenhuma' | 'api' | 'sftp' | 'portal';
export type Ambiente = 'producao' | 'homologacao';

export interface Integracao {
  tipo: TipoIntegracao;
  ambiente: Ambiente;
  ativa: boolean;
  baseUrl: string | null;
  usuario: string | null;
  /** Só os últimos caracteres do segredo: o valor inteiro nunca sai do servidor. */
  segredoDica: string | null;
  temSegredo: boolean;
  observacoes: string | null;
  ultimaSincronizacaoEm: string | null;
  /** Como a API funciona — em claro. Opcionais: backend anterior não manda. */
  documentacaoUrl?: string | null;
  documentacao?: string | null;
  /** Nome e últimos caracteres de cada credencial. O valor nunca desce. */
  credenciais?: { nome: string; dica: string | null }[];
}

export interface Seguradora {
  id: number;
  nome: string;
  /** Chave estável (`porto-seguro`): a pasta dos arquivos de integração. Opcional: backend anterior não manda. */
  chave?: string | null;
  cnpj: string | null;
  codigoSusep: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
  ativa: boolean;
  inativadaEm: string | null;
  /** O que impede de apagar em vez de inativar. */
  clientes: number;
  apolices: number;
  integracao: Integracao | null;
}

export interface DadosSeguradora {
  nome: string;
  cnpj?: string | null;
  codigoSusep?: string | null;
  site?: string | null;
  telefone?: string | null;
  email?: string | null;
  observacoes?: string | null;
}

export interface DadosIntegracao {
  tipo: TipoIntegracao;
  ambiente: Ambiente;
  ativa: boolean;
  baseUrl?: string | null;
  usuario?: string | null;
  observacoes?: string | null;
  /** Ausente mantém o segredo; `null` apaga; texto substitui. */
  segredo?: string | null;
  documentacaoUrl?: string | null;
  documentacao?: string | null;
  /** Lista COMPLETA: `valor` vazio mantém o gravado; nome ausente é removido; campo ausente não mexe. */
  credenciais?: { nome: string; valor?: string }[];
}

export const seguradorasApi = {
  /** Sem `todas`, devolve só as ativas — que é o que um <select> quer. */
  listar: (todas = false) =>
    api.get<{ seguradoras: Seguradora[] }>(`/seguradoras${todas ? '?todas=true' : ''}`),

  criar: (dados: DadosSeguradora) =>
    api.post<{ seguradora: Seguradora }>('/seguradoras', dados),

  atualizar: (id: number, dados: DadosSeguradora) =>
    api.patch<{ seguradora: Seguradora }>(`/seguradoras/${id}`, dados),

  definirSituacao: (id: number, ativa: boolean) =>
    api.patch<{ seguradora: Seguradora }>(`/seguradoras/${id}/situacao`, { ativa }),

  salvarIntegracao: (id: number, dados: DadosIntegracao) =>
    api.put<{ seguradora: Seguradora }>(`/seguradoras/${id}/integracao`, dados),
};
