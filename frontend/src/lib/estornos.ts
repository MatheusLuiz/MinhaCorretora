import { api } from '@/lib/api';

/** Estornos: `estornos` (descontado de recibo) e `cancelamentos` (comissão que deixa de vir) NÃO se somam. */

export interface EstornoLinha {
  /** `item` = linha do detalhe da seguradora; `recibo` = recibo inteiro negativo, sem detalhe. */
  origem: 'item' | 'recibo';
  mes: string;
  pagoEm: string | null;
  data: string | null;
  seguradora: string;
  recibo: string;
  apolice: string | null;
  segurado: string | null;
  parcela: number | null;
  tipo: string | null;
  premio: number | null;
  /** Negativo, como veio no extrato. */
  valor: number;
  clienteUuid: string | null;
  cliente: string | null;
}

export interface CancelamentoLinha {
  mes: string;
  canceladaEm: string | null;
  seguradora: string;
  apolice: string;
  segurado: string;
  motivo: string | null;
  inadimplencia: boolean;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  premio: number | null;
  /** Null = a origem não informa. Nunca somar como zero. */
  comissao: number | null;
  clienteUuid: string | null;
  cliente: string | null;
  corretor: string | null;
}

export interface EstornoMes {
  mes: string;
  seguradora: string;
  lancamentos: number;
  valor: number;
}

export interface CancelamentoMes {
  mes: string;
  seguradora: string;
  apolices: number;
  comissaoInformada: number;
  semComissao: number;
  premioInformado: number;
  semPremio: number;
}

export interface RespostaEstornos {
  meses: string[];
  estornos: { linhas: EstornoLinha[]; porMes: EstornoMes[] };
  cancelamentos: { linhas: CancelamentoLinha[]; porMes: CancelamentoMes[] };
}

export const estornosApi = {
  /** `de`/`ate` em AAAA-MM; no máximo 60 meses. */
  listar: (de: string, ate: string) =>
    api.get<RespostaEstornos>(`/financeiro/estornos?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`),
};
