import { api, obterAccessToken } from '@/lib/api';

/** Financeiro › Conciliação: recibos importados × extrato da companhia, e as retenções. */

export type SituacaoCelula = 'conferido' | 'divergente' | 'sem_extrato' | 'sem_recebimento';
export type SituacaoOrdem = 'conferida' | 'faltando' | 'sobrando' | 'divergente' | 'sem_extrato';

export interface CelulaConciliacao {
  seguradoraId: number;
  seguradora: string;
  mes: string;
  situacao: SituacaoCelula;
  recibos: { qtde: number; bruto: number; impostos: number; desconto: number; liquido: number };
  /** Nulo: a companhia não tem relatório de detalhe (não é "zero itens"). */
  detalhe: { itens: number; somaItens: number; creditosComDetalhe: number } | null;
  /** Nulo: nenhum extrato gravado no mês. */
  extrato: { ordens: number; bruto: number; liquido: number } | null;
  pendencias: { faltando: string[]; sobrando: string[]; divergentes: string[] };
}

export interface Conciliacao {
  meses: string[];
  seguradoras: { id: number; nome: string; temDetalhe: boolean; temExtrato: boolean }[];
  celulas: CelulaConciliacao[];
  contagem: Record<SituacaoCelula, number>;
}

export interface LinhaOrdem {
  ordem: string;
  situacao: SituacaoOrdem;
  recibo: {
    numero: string;
    mes: string;
    pagoEm: string | null;
    bruto: number;
    impostos: number;
    liquido: number;
    itens: number;
    somaItens: number;
  } | null;
  extrato: {
    pagoEm: string | null;
    bruto: number;
    liquido: number | null;
    inss: number | null;
    irrf: number | null;
    iss: number | null;
  } | null;
  diferenca: number | null;
}

export interface LinhaRetencao {
  mes: string;
  seguradora: string;
  recibos: number;
  bruto: number;
  desconto: number;
  impostos: number;
  liquido: number;
  impostosCalculados: number;
  /** Só do extrato do portal, quando ele traz a coluna. Nulo = não informado. */
  inss: number | null;
  irrf: number | null;
  iss: number | null;
}

export interface Retencoes {
  linhas: LinhaRetencao[];
  separacaoDisponivel: boolean;
  impostosCalculados: number;
}

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

const periodo = (de: string, ate: string): string =>
  `de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`;

export const conciliacaoApi = {
  grade: (de: string, ate: string) => api.get<Conciliacao>(`/financeiro/conciliacao?${periodo(de, ate)}`),

  ordens: (seguradoraId: number, mes: string) =>
    api.get<{ celula: CelulaConciliacao | null; linhas: LinhaOrdem[] }>(
      `/financeiro/conciliacao/ordens?seguradora=${seguradoraId}&mes=${encodeURIComponent(mes)}`,
    ),

  retencoes: (de: string, ate: string) =>
    api.get<Retencoes>(`/financeiro/conciliacao/retencoes?${periodo(de, ate)}`),

  /** Download autenticado: um `<a href>` chegaria sem Bearer (401). */
  async baixarRetencoes(de: string, ate: string): Promise<void> {
    const token = obterAccessToken();
    const resposta = await fetch(`${BASE_URL}/financeiro/conciliacao/retencoes.xlsx?${periodo(de, ate)}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resposta.ok) throw new Error('Não foi possível gerar a planilha de retenções.');

    const url = URL.createObjectURL(await resposta.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `retencoes_${de}_a_${ate}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
