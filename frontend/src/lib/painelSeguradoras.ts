import { api } from '@/lib/api';

/** Contrato do dashboard de Seguradoras (`painelSeguradoras.controller.ts`). */

export type SituacaoCarga = 'atrasada' | 'nunca' | 'em_dia';

export const ROTULO_SITUACAO: Record<SituacaoCarga, string> = {
  atrasada: 'Atrasada',
  nunca: 'Nunca importado',
  em_dia: 'Em dia',
};

export interface CartaoSeguradora {
  nome: string;
  chave: string | null;
  ativa: boolean;
  apolices: number;
  emVigor: number;
  clientesEmVigor: number;
  /** `null` = nenhuma apólice em vigor traz prêmio. */
  premioEmVigor: number | null;
  percentualCarteira: number;
  /** Ausente para quem não tem `comissoes.todas` — não é zero. */
  comissao?: { mes: number; ano: number };
  ultimaCarga: { em: string; dias: number } | null;
  situacaoCargas: SituacaoCarga;
  relatoriosAtrasados: number;
  relatoriosNuncaImportados: number;
  relatorios: number;
}

export interface ResumoSeguradoras {
  prazoDias: number;
  /** A fatia de cada companhia é por prêmio ou, sem prêmio na base, por apólice. */
  basePercentual: 'premio' | 'apolices';
  premioEmVigorTotal: number;
  emVigorTotal: number;
  comissaoVisivel: boolean;
  seguradoras: CartaoSeguradora[];
}

export const painelSeguradorasApi = {
  resumoSeguradoras: () => api.get<ResumoSeguradoras>('/filas/seguradoras/resumo'),
};
