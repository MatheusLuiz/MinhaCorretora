import { api } from '@/lib/api';

/** Dimensões da gaveta de detalhe: enum fechado porque no servidor cada uma escolhe um SQL constante. */
export type Dimensao =
  | 'seguradora'
  | 'ramo'
  | 'produto'
  | 'vendedor'
  | 'canal'
  | 'tipoNegocio'
  | 'celula'
  | 'mes'
  | 'semPremio'
  | 'comSinistro'
  | 'sinistroRamo'
  | 'assistenciaRamo'
  | 'provisoria'
  | 'vencimento'
  | 'vencimentoMes'
  | 'aRenovar'
  | 'todasApolices'
  | 'situacaoCliente'
  | 'entradaMes'
  | 'crossSellRamo'
  | 'quantidadeApolices'
  | 'carteiraDoVendedor'
  | 'situacaoPorNome'
  | 'uf'
  | 'tipoPessoa'
  | 'faixaRenda'
  | 'seguradoraDoCliente'
  | 'cancelados'
  | 'canceladosPerdidos';

export interface PedidoDetalhe {
  dimensao: Dimensao;
  valor?: string;
  /** `AAAA-MM`, quando o clique foi numa coluna da série. */
  periodo?: string;
  /** Limita aos 12 meses da janela — use quando o gráfico clicado usa a janela. */
  naJanela?: boolean;
  /** O que escrever no topo da gaveta. Não vai ao servidor. */
  titulo: string;
  /** Uma linha explicando o recorte, quando ele não é óbvio pelo título. */
  nota?: string;
  /** Fila do mesmo recorte, com o filtro na URL (botão "Abrir na fila"). Ex.: `/filas/renovacao?prazo=30`. */
  fila?: string;
}

export interface ItemApolice {
  uuid: string;
  numero: string;
  numeroProposta: string | null;
  provisoria: boolean;
  seguradora: string;
  produto: string | null;
  ramo: string | null;
  segurado: string;
  documento: string | null;
  clienteUuid: string | null;
  vendedor: string | null;
  canal: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  premio: number | null;
  comissao: number | null;
  tipoNegocio: string | null;
  possuiSinistro: boolean | null;
}

export interface ItemCliente {
  uuid: string;
  nome: string;
  documento: string | null;
  situacao: string;
  corretor: string | null;
  telefone: string | null;
  email: string | null;
  apolices: number;
  premio: number;
  comissao: number;
}

export type ResultadoDetalhe =
  | { tipo: 'apolices'; total: number; mostrando: number; itens: ItemApolice[] }
  | { tipo: 'clientes'; total: number; mostrando: number; itens: ItemCliente[] };

export const detalheApi = {
  carregar: (p: PedidoDetalhe) => {
    const busca = new URLSearchParams({ dimensao: p.dimensao });
    if (p.valor) busca.set('valor', p.valor);
    if (p.periodo) busca.set('periodo', p.periodo);
    if (p.naJanela) busca.set('naJanela', 'true');
    // O filtro por consultor mora na URL (`?produtor=`): a gaveta sai do mesmo recorte do número.
    const produtor = new URLSearchParams(window.location.search).get('produtor');
    if (produtor) busca.set('produtor', produtor);

    return api.get<ResultadoDetalhe>(`/paineis/detalhe?${busca.toString()}`);
  },
};
