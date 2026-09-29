import { api } from '@/lib/api';

/** Fila de cadastro (espelho de `filaCadastro.controller.ts`); resumo e lista saem da mesma consulta. */

export type Pendencia =
  | 'sem_contato'
  | 'sem_telefone'
  | 'sem_email'
  | 'sem_endereco'
  | 'sem_nascimento'
  | 'sem_corretor'
  | 'nome_mascarado'
  | 'inativo'
  | 'inadimplente';

export type SituacaoCliente = 'prospecto' | 'ativo' | 'inadimplente' | 'inativo';

export type ContagemDaCarteira = Record<'ativo' | 'inadimplente' | 'inativo' | 'outros' | 'total', number> & {
  /** Entraram no mês atual (`cliente_desde`). Opcionais: backend anterior não manda. */
  novosNoMes?: number;
  novosNoMesComSeguro?: number;
  novosMesAnterior?: number;
};

/** `critico` = impede o contato; `atencao` = atrapalha. A ordem é a das etiquetas e do filtro. */
export const PENDENCIAS: { chave: Pendencia; rotulo: string; tom: 'critico' | 'atencao' | 'tranquilo' }[] = [
  { chave: 'sem_contato', rotulo: 'Sem nenhum contato', tom: 'critico' },
  { chave: 'sem_telefone', rotulo: 'Sem telefone', tom: 'critico' },
  { chave: 'sem_email', rotulo: 'Sem e-mail', tom: 'atencao' },
  { chave: 'nome_mascarado', rotulo: 'Nome mascarado', tom: 'atencao' },
  { chave: 'inadimplente', rotulo: 'Inadimplente', tom: 'atencao' },
  { chave: 'inativo', rotulo: 'Inativo (a recuperar)', tom: 'atencao' },
  { chave: 'sem_endereco', rotulo: 'Sem endereço', tom: 'tranquilo' },
  { chave: 'sem_nascimento', rotulo: 'Sem nascimento/abertura', tom: 'tranquilo' },
  { chave: 'sem_corretor', rotulo: 'Sem corretor', tom: 'tranquilo' },
];

export const ehPendencia = (x: string | null): x is Pendencia => PENDENCIAS.some((p) => p.chave === x);

export interface ClienteDaFila {
  uuid: string;
  nome: string;
  documento: string;
  tipoPessoa: 'F' | 'J';
  situacao: SituacaoCliente | null;
  situacaoNome: string | null;
  telefone: string | null;
  email: string | null;
  pendencias: Pendencia[];
  apolicesEmVigor: number;
  proximoVencimento: string | null;
  seguradoras: string | null;
}

interface Recorte {
  carteiraPropria: boolean;
  semCarteira: boolean;
}

export interface RespostaFilaCadastro {
  /** Total com o filtro; passa de `clientes.length` só quando bate no `limite`. */
  total: number;
  limite: number;
  clientes: ClienteDaFila[];
  recorte: Recorte;
}

export interface ResumoCarteira {
  /** Cada grupo de cliente por si (chave → contagem). */
  porCarteira?: Record<string, ContagemDaCarteira>;
  /** Os grupos de cliente (057). Ler com `gruposDoPayload`: backend anterior não manda. */
  grupos?: unknown;
  /** Clientes que entraram em cada um dos últimos 12 meses (`cliente_desde`). */
  entradasPorMes?: { mes: string; clientes: number; comSeguro: number }[];
  total: number;
  naFila: number;
  situacao: Record<SituacaoCliente | 'semSituacao', number>;
  pendencias: Record<Pendencia, number>;
  recorte: Recorte;
}

export interface FiltroFilaCadastro {
  pendencia?: Pendencia | '';
  situacao?: SituacaoCliente | '';
  busca?: string;
}

export const filaCadastroApi = {
  resumo: (): Promise<ResumoCarteira> => api.get<ResumoCarteira>('/filas/cadastro/resumo'),

  listar: (filtro: FiltroFilaCadastro = {}): Promise<RespostaFilaCadastro> => {
    const qs = new URLSearchParams();
    if (filtro.pendencia) qs.set('pendencia', filtro.pendencia);
    if (filtro.situacao) qs.set('situacao', filtro.situacao);
    if (filtro.busca?.trim()) qs.set('busca', filtro.busca.trim());
    const s = qs.toString();
    return api.get<RespostaFilaCadastro>(`/filas/cadastro${s ? `?${s}` : ''}`);
  },
};
