import { api } from '@/lib/api';

/** Tarefas agendadas. Datas chegam sem fuso: são hora de Brasília, e `new Date` as lê como local. */

export type SituacaoExecucao = 'executando' | 'sucesso' | 'erro' | 'interrompida';

export interface Tarefa {
  id: string;
  nome: string;
  descricao: string | null;
  /** Arquivo de integração que a tarefa executa ("porto-seguro/apolices-emitidas"). */
  arquivo: string;
  arquivoNome: string;
  seguradoraId: number | null;
  seguradora: string | null;
  /** Bits: 1 = domingo … 64 = sábado. */
  diasSemana: number;
  /** "HH:MM", hora de Brasília. */
  horario: string;
  ativa: boolean;
  proximaExecucao: string | null;
  executando: boolean;
  ultimaExecucao: {
    situacao: SituacaoExecucao;
    iniciadaEm: string;
    finalizadaEm: string | null;
    mensagem: string | null;
  } | null;
}

/** Um arquivo em `backend/src/integrations/seguradoras`. */
export interface ArquivoIntegracao {
  arquivo: string;
  nome: string;
  descricao: string;
  /** A pasta (`seguradoras.chave`); `null` = rotina genérica, serve a qualquer seguradora. */
  seguradoraChave: string | null;
}

export interface Execucao {
  id: number;
  disparo: 'agenda' | 'manual';
  usuario: string | null;
  situacao: SituacaoExecucao;
  iniciadaEm: string;
  finalizadaEm: string | null;
  mensagem: string | null;
}

/** Uma execução na aba Execuções (todas as tarefas). */
export interface ExecucaoGeral extends Execucao {
  tarefaUuid: string;
  tarefa: string;
  seguradora: string | null;
  arquivo: string;
}

export interface LinhaLog {
  id: number;
  em: string;
  nivel: 'info' | 'aviso' | 'erro';
  mensagem: string;
}

export interface DadosTarefa {
  nome: string;
  descricao: string;
  arquivo: string;
  seguradoraId: number | null;
  diasSemana: number;
  horario: string;
}

export const tarefasApi = {
  listar: () => api.get<{ tarefas: Tarefa[]; arquivos: ArquivoIntegracao[] }>('/tarefas'),
  criar: (dados: DadosTarefa) => api.post<{ tarefa: Tarefa }>('/tarefas', dados),
  atualizar: (id: string, dados: DadosTarefa) => api.patch<{ tarefa: Tarefa }>(`/tarefas/${id}`, dados),
  definirSituacao: (id: string, ativa: boolean) =>
    api.patch<{ tarefa: Tarefa }>(`/tarefas/${id}/situacao`, { ativa }),
  excluir: (id: string) => api.delete<void>(`/tarefas/${id}`),
  executarAgora: (id: string) => api.post<{ mensagem: string }>(`/tarefas/${id}/executar`, {}),
  execucoes: (id: string) => api.get<{ execucoes: Execucao[] }>(`/tarefas/${id}/execucoes`),
  /** Todas as execuções, paginadas; filtro opcional por tarefa e situação. */
  execucoesGerais: (filtro: { tarefa?: string; situacao?: string; pagina: number; porPagina: number }) => {
    const q = new URLSearchParams({ pagina: String(filtro.pagina), porPagina: String(filtro.porPagina) });
    if (filtro.tarefa) q.set('tarefa', filtro.tarefa);
    if (filtro.situacao) q.set('situacao', filtro.situacao);
    return api.get<{ total: number; execucoes: ExecucaoGeral[] }>(`/tarefas/execucoes?${q.toString()}`);
  },
  /** O log de uma execução; `depois` = id da última linha já recebida (acompanhar ao vivo). */
  log: (execucaoId: number, depois = 0) =>
    api.get<{ execucao: ExecucaoGeral; linhas: LinhaLog[] }>(`/tarefas/execucoes/${execucaoId}/log?depois=${depois}`),
};

/** Os dias, na ordem dos bits (domingo = 1). */
export const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/** "seg a sex", "todo dia", "Seg, Qua" — a mesma leitura de `utils/agenda.ts`. */
export function descreverDias(dias: number): string {
  const d = dias & 127;
  if (d === 127) return 'todo dia';
  if (d === 62) return 'seg a sex';
  if (d === 65) return 'fim de semana';
  return DIAS.filter((_, i) => d & (1 << i)).join(', ') || 'nenhum dia';
}

export const ROTULO_SITUACAO: Record<SituacaoExecucao, { texto: string; classe: string }> = {
  executando: { texto: 'Executando', classe: 'etiqueta--atencao' },
  sucesso: { texto: 'Sucesso', classe: 'etiqueta--ok' },
  erro: { texto: 'Erro', classe: 'etiqueta--critico' },
  interrompida: { texto: 'Interrompida', classe: 'etiqueta--atencao' },
};

/** "01/10/2026 07:00" a partir da data sem fuso do servidor. */
export function formatarQuando(iso: string | null, vazio = '—'): string {
  if (!iso) return vazio;
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
