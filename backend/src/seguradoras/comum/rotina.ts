import type { Seguradora } from '../../repositories/seguradora.repository.js';

/**
 * Contrato de uma rotina de tarefa agendada: `<chave>/tarefas/<rotina>.ts` ou `comum/tarefas/<rotina>.ts`,
 * exportando `export const rotina: Rotina`. Erro = `throw new Error(...)`; nunca credencial no log;
 * dado importado passa pelos mesmos serviços das cargas manuais (ver LEIA-ME.md).
 */

export type NivelLog = 'info' | 'aviso' | 'erro';

export interface ContextoRotina {
  seguradora: Seguradora | null;
  /** `tarefas.parametros`. */
  parametros: Record<string, unknown> | null;
  /** Grava uma linha no log da execução na hora. */
  log: (mensagem: string, nivel?: NivelLog) => void;
}

export interface ResultadoRotina {
  mensagem: string;
  detalhes?: unknown;
}

export interface Rotina {
  nome: string;
  descricao: string;
  executar: (contexto: ContextoRotina) => Promise<ResultadoRotina>;
}
