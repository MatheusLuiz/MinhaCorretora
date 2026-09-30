import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { rotinas } from '../../seguradoras/comum/catalogo.js';
import type { NivelLog } from '../../seguradoras/comum/rotina.js';
import * as seguradoraRepo from '../../repositories/seguradora.repository.js';
import * as repo from '../../repositories/tarefa.repository.js';
import { agoraEmBrasilia, proximaExecucao } from '../../utils/agenda.js';

// A cada minuto roda as tarefas vencidas. A trava no banco (`repo.travar`) garante uma
// execução por vez, mesmo com "executar agora" no meio da agenda.

const INTERVALO_MS = 60_000;
let relogio: NodeJS.Timeout | null = null;
let rodando = false;

/** A próxima vez da tarefa a partir de agora (hora de Brasília). */
export function proximaDe(t: Pick<repo.Tarefa, 'diasSemana' | 'horario' | 'ativa'>): Date | null {
  return t.ativa ? proximaExecucao(t.diasSemana, t.horario, agoraEmBrasilia()) : null;
}

/** Grava em fila para não trocar a ordem das linhas; falha ao gravar não derruba a rotina. */
function criarLog(execucaoId: number): { log: (m: string, n?: NivelLog) => void; esvaziar: () => Promise<void> } {
  let fila: Promise<void> = Promise.resolve();
  return {
    log: (mensagem, nivel = 'info') => {
      fila = fila
        .then(() => repo.registrarLog(execucaoId, nivel, mensagem))
        .catch((erro: unknown) => logger.error({ err: erro, execucaoId }, 'Falha ao gravar log de tarefa'));
    },
    esvaziar: () => fila,
  };
}

/** Devolve `false` se a tarefa já estava rodando. */
export async function executar(
  tarefaId: number,
  disparo: 'agenda' | 'manual',
  usuarioId: number | null = null,
): Promise<boolean> {
  if (!(await repo.travar(tarefaId))) return false;

  const execucaoId = await repo.iniciarExecucao(tarefaId, disparo, usuarioId);
  const { log, esvaziar } = criarLog(execucaoId);
  const tarefa = await repo.buscarPorId(tarefaId);
  const inicio = Date.now();

  try {
    if (!tarefa) throw new Error('Tarefa não encontrada.');
    log(`Início (${disparo === 'agenda' ? 'agenda' : 'executar agora'}): arquivo ${tarefa.arquivo}.`);

    const rotina = (await rotinas()).get(tarefa.arquivo);
    if (!rotina) throw new Error(`O arquivo "${tarefa.arquivo}" não existe mais em seguradoras/*/tarefas.`);

    const seguradora = tarefa.seguradoraId ? await seguradoraRepo.buscarPorId(tarefa.seguradoraId) : null;
    if (!seguradora) throw new Error('A tarefa precisa de uma seguradora.');

    const resultado = await rotina.executar({ seguradora, parametros: tarefa.parametros, log });
    log(`Fim: ${resultado.mensagem} (${((Date.now() - inicio) / 1000).toFixed(1)} s).`);
    await esvaziar();
    await repo.finalizarExecucao(execucaoId, 'sucesso', resultado.mensagem, resultado.detalhes);
    logger.info({ tarefa: tarefa.nome, disparo }, `Tarefa concluída: ${resultado.mensagem}`);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    log(`Erro: ${mensagem}`, 'erro');
    await esvaziar();
    await repo.finalizarExecucao(execucaoId, 'erro', mensagem, undefined);
    // Sem stack: falha costuma ser de negócio, e o stack a cada minuto afogaria o log.
    logger.warn({ tarefa: tarefa?.nome ?? tarefaId, disparo }, `Tarefa falhou: ${mensagem}`);
  } finally {
    // Próxima vez a partir de AGORA: atrasada roda uma vez só. Manual não mexe na agenda.
    await repo.liberar(tarefaId, disparo === 'agenda' && tarefa ? proximaDe(tarefa) : undefined);
  }
  return true;
}

async function tique(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    for (const id of await repo.vencidas()) {
      await executar(id, 'agenda');
    }
  } catch (erro) {
    logger.error({ err: erro }, 'Falha no agendador de tarefas');
  } finally {
    rodando = false;
  }
}

export async function iniciarAgendador(): Promise<void> {
  if (!env.TAREFAS_AGENDADAS) {
    logger.info('Agendador de tarefas desligado (TAREFAS_AGENDADAS=false).');
    return;
  }
  const interrompidas = await repo.recuperarInterrompidas();
  if (interrompidas > 0) logger.warn({ interrompidas }, 'Execuções interrompidas pelo reinício marcadas como tal.');
  // Carregar na subida: arquivo quebrado aparece no log agora, não no horário da tarefa.
  await rotinas();

  relogio = setInterval(() => void tique(), INTERVALO_MS);
  relogio.unref();
  void tique();
  logger.info('Agendador de tarefas no ar (a cada minuto).');
}

export function pararAgendador(): void {
  if (relogio) clearInterval(relogio);
  relogio = null;
}
