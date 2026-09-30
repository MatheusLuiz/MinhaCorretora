import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { binarioParaUuid, uuidParaBinario } from '../utils/uuid.js';

// Datas em hora de Brasília. Trava de execução: `em_execucao_desde` — quem consegue o `UPDATE … IS NULL` executa.

export interface Tarefa {
  id: number;
  uuid: string;
  nome: string;
  descricao: string | null;
  arquivo: string;
  seguradoraId: number | null;
  seguradora: string | null;
  diasSemana: number;
  /** "HH:MM" */
  horario: string;
  ativa: boolean;
  parametros: Record<string, unknown> | null;
  proximaExecucao: Date | null;
  emExecucaoDesde: Date | null;
  ultimaExecucao: {
    situacao: 'executando' | 'sucesso' | 'erro' | 'interrompida';
    iniciadaEm: Date;
    finalizadaEm: Date | null;
    mensagem: string | null;
  } | null;
}

export interface DadosTarefa {
  nome: string;
  descricao: string | null;
  arquivo: string;
  seguradoraId: number | null;
  diasSemana: number;
  horario: string;
}

const SELECT = `
  SELECT t.id, t.uuid, t.nome, t.descricao, t.arquivo, t.seguradora_id, s.nome AS seguradora,
         t.dias_semana, TIME_FORMAT(t.horario, '%H:%i') AS horario, t.ativa, t.parametros,
         t.proxima_execucao, t.em_execucao_desde,
         e.situacao AS ult_situacao, e.iniciada_em AS ult_inicio, e.finalizada_em AS ult_fim,
         e.mensagem AS ult_mensagem
    FROM tarefas t
    LEFT JOIN seguradoras s ON s.id = t.seguradora_id
    LEFT JOIN tarefas_execucoes e ON e.id = (
      SELECT x.id FROM tarefas_execucoes x WHERE x.tarefa_id = t.id ORDER BY x.id DESC LIMIT 1
    )`;

function paraTarefa(l: RowDataPacket): Tarefa {
  return {
    id: Number(l.id),
    uuid: binarioParaUuid(l.uuid as Buffer),
    nome: String(l.nome),
    descricao: l.descricao === null ? null : String(l.descricao),
    arquivo: String(l.arquivo),
    seguradoraId: l.seguradora_id === null ? null : Number(l.seguradora_id),
    seguradora: l.seguradora === null ? null : String(l.seguradora),
    diasSemana: Number(l.dias_semana),
    horario: String(l.horario),
    ativa: Boolean(l.ativa),
    parametros: (l.parametros as Record<string, unknown> | null) ?? null,
    proximaExecucao: (l.proxima_execucao as Date | null) ?? null,
    emExecucaoDesde: (l.em_execucao_desde as Date | null) ?? null,
    ultimaExecucao: l.ult_situacao
      ? {
          situacao: l.ult_situacao,
          iniciadaEm: l.ult_inicio as Date,
          finalizadaEm: (l.ult_fim as Date | null) ?? null,
          mensagem: l.ult_mensagem === null ? null : String(l.ult_mensagem),
        }
      : null,
  };
}

export async function listar(): Promise<Tarefa[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(`${SELECT} ORDER BY t.ativa DESC, t.nome`);
  return linhas.map(paraTarefa);
}

export async function buscarPorUuid(uuid: string): Promise<Tarefa | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(`${SELECT} WHERE t.uuid = ?`, [uuidParaBinario(uuid)]);
  return linhas[0] ? paraTarefa(linhas[0]) : null;
}

export async function buscarPorId(id: number): Promise<Tarefa | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(`${SELECT} WHERE t.id = ?`, [id]);
  return linhas[0] ? paraTarefa(linhas[0]) : null;
}

/** Nome usado por OUTRA tarefa? (collation: sem acento, sem caixa) */
export async function nomeEmUso(nome: string, excetoId = 0): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM tarefas WHERE nome = ? AND id <> ? LIMIT 1',
    [nome, excetoId],
  );
  return linhas.length > 0;
}

export async function criar(dados: DadosTarefa, proxima: Date | null): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO tarefas (nome, descricao, arquivo, seguradora_id, dias_semana, horario, proxima_execucao)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [dados.nome, dados.descricao, dados.arquivo, dados.seguradoraId, dados.diasSemana, dados.horario, proxima],
  );
  return r.insertId;
}

export async function atualizar(id: number, dados: DadosTarefa, proxima: Date | null): Promise<void> {
  await pool.execute(
    `UPDATE tarefas
        SET nome = ?, descricao = ?, arquivo = ?, seguradora_id = ?, dias_semana = ?, horario = ?,
            proxima_execucao = ?
      WHERE id = ?`,
    [dados.nome, dados.descricao, dados.arquivo, dados.seguradoraId, dados.diasSemana, dados.horario, proxima, id],
  );
}

export async function definirAtiva(id: number, ativa: boolean, proxima: Date | null): Promise<void> {
  await pool.execute('UPDATE tarefas SET ativa = ?, proxima_execucao = ? WHERE id = ?', [
    ativa ? 1 : 0,
    proxima,
    id,
  ]);
}

export async function excluir(id: number): Promise<void> {
  await pool.execute('DELETE FROM tarefas WHERE id = ?', [id]);
}

/** Ids das tarefas ativas cuja hora chegou e que não estão rodando. */
export async function vencidas(): Promise<number[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM tarefas
      WHERE ativa = 1 AND em_execucao_desde IS NULL
        AND proxima_execucao IS NOT NULL AND proxima_execucao <= NOW(3)
      ORDER BY proxima_execucao`,
  );
  return linhas.map((l) => Number(l.id));
}

/** Pega a trava. `false` = outra execução chegou antes. */
export async function travar(id: number): Promise<boolean> {
  const [r] = await pool.execute<ResultSetHeader>(
    'UPDATE tarefas SET em_execucao_desde = NOW(3) WHERE id = ? AND em_execucao_desde IS NULL',
    [id],
  );
  return r.affectedRows === 1;
}

/** Solta a trava e, quando veio da agenda, marca a próxima vez. */
export async function liberar(id: number, proxima?: Date | null): Promise<void> {
  if (proxima === undefined) {
    await pool.execute('UPDATE tarefas SET em_execucao_desde = NULL WHERE id = ?', [id]);
  } else {
    await pool.execute('UPDATE tarefas SET em_execucao_desde = NULL, proxima_execucao = ? WHERE id = ?', [
      proxima,
      id,
    ]);
  }
}

export async function iniciarExecucao(
  tarefaId: number,
  disparo: 'agenda' | 'manual',
  usuarioId: number | null,
): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    'INSERT INTO tarefas_execucoes (tarefa_id, disparo, usuario_id) VALUES (?, ?, ?)',
    [tarefaId, disparo, usuarioId],
  );
  return r.insertId;
}

export async function finalizarExecucao(
  execucaoId: number,
  situacao: 'sucesso' | 'erro',
  mensagem: string | null,
  detalhes: unknown,
): Promise<void> {
  await pool.execute(
    `UPDATE tarefas_execucoes
        SET situacao = ?, finalizada_em = NOW(3), mensagem = ?, detalhes = ?
      WHERE id = ?`,
    [situacao, mensagem?.slice(0, 1000) ?? null, detalhes === undefined ? null : JSON.stringify(detalhes), execucaoId],
  );
}

/** Na subida: o que ficou "executando" morreu com o processo anterior; marca interrompida e solta a trava. */
export async function recuperarInterrompidas(): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE tarefas_execucoes
        SET situacao = 'interrompida', finalizada_em = NOW(3),
            mensagem = 'O servidor reiniciou durante a execução.'
      WHERE situacao = 'executando'`,
  );
  await pool.execute('UPDATE tarefas SET em_execucao_desde = NULL WHERE em_execucao_desde IS NOT NULL');
  return r.affectedRows;
}

export interface Execucao {
  id: number;
  disparo: 'agenda' | 'manual';
  usuario: string | null;
  situacao: 'executando' | 'sucesso' | 'erro' | 'interrompida';
  iniciadaEm: Date;
  finalizadaEm: Date | null;
  mensagem: string | null;
}

export async function listarExecucoes(tarefaId: number, limite = 20): Promise<Execucao[]> {
  const n = Math.min(Math.max(Math.trunc(limite), 1), 100);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT e.id, e.disparo, CONCAT_WS(' ', u.nome, u.sobrenome) AS usuario, e.situacao,
            e.iniciada_em, e.finalizada_em, e.mensagem
       FROM tarefas_execucoes e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.tarefa_id = ?
      ORDER BY e.id DESC
      LIMIT ${n}`,
    [tarefaId],
  );
  return linhas.map((l) => ({
    id: Number(l.id),
    disparo: l.disparo,
    usuario: l.usuario ? String(l.usuario) : null,
    situacao: l.situacao,
    iniciadaEm: l.iniciada_em as Date,
    finalizadaEm: (l.finalizada_em as Date | null) ?? null,
    mensagem: l.mensagem === null ? null : String(l.mensagem),
  }));
}

export type NivelLog = 'info' | 'aviso' | 'erro';

export async function registrarLog(execucaoId: number, nivel: NivelLog, mensagem: string): Promise<void> {
  await pool.execute('INSERT INTO tarefas_logs (execucao_id, nivel, mensagem) VALUES (?, ?, ?)', [
    execucaoId,
    nivel,
    mensagem.slice(0, 2000),
  ]);
}

export interface LinhaLog {
  id: number;
  em: Date;
  nivel: NivelLog;
  mensagem: string;
}

/** O log de uma execução; `depoisDe` traz só as linhas novas (acompanhar ao vivo). */
export async function logDaExecucao(execucaoId: number, depoisDe = 0): Promise<LinhaLog[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT id, em, nivel, mensagem FROM tarefas_logs
      WHERE execucao_id = ? AND id > ?
      ORDER BY id
      LIMIT 2000`,
    [execucaoId, depoisDe],
  );
  return linhas.map((l) => ({
    id: Number(l.id),
    em: l.em as Date,
    nivel: l.nivel as NivelLog,
    mensagem: String(l.mensagem),
  }));
}

export interface ExecucaoGeral extends Execucao {
  tarefaUuid: string;
  tarefa: string;
  seguradora: string | null;
  arquivo: string;
}

const SELECT_EXECUCAO = `
  SELECT e.id, e.disparo, CONCAT_WS(' ', u.nome, u.sobrenome) AS usuario, e.situacao,
         e.iniciada_em, e.finalizada_em, e.mensagem,
         t.uuid AS tarefa_uuid, t.nome AS tarefa, t.arquivo, s.nome AS seguradora
    FROM tarefas_execucoes e
    JOIN tarefas t ON t.id = e.tarefa_id
    LEFT JOIN seguradoras s ON s.id = t.seguradora_id
    LEFT JOIN usuarios u ON u.id = e.usuario_id`;

function paraExecucaoGeral(l: RowDataPacket): ExecucaoGeral {
  return {
    id: Number(l.id),
    disparo: l.disparo,
    usuario: l.usuario ? String(l.usuario) : null,
    situacao: l.situacao,
    iniciadaEm: l.iniciada_em as Date,
    finalizadaEm: (l.finalizada_em as Date | null) ?? null,
    mensagem: l.mensagem === null ? null : String(l.mensagem),
    tarefaUuid: binarioParaUuid(l.tarefa_uuid as Buffer),
    tarefa: String(l.tarefa),
    seguradora: l.seguradora === null ? null : String(l.seguradora),
    arquivo: String(l.arquivo),
  };
}

export interface FiltroExecucoes {
  tarefaUuid?: string;
  situacao?: Execucao['situacao'];
  pagina: number;
  porPagina: number;
}

/** Todas as execuções, da mais recente para trás — a tela de logs. */
export async function listarExecucoesGerais(
  filtro: FiltroExecucoes,
): Promise<{ total: number; execucoes: ExecucaoGeral[] }> {
  const condicoes: string[] = [];
  const valores: (string | Buffer)[] = [];
  if (filtro.tarefaUuid) {
    condicoes.push('t.uuid = ?');
    valores.push(uuidParaBinario(filtro.tarefaUuid));
  }
  if (filtro.situacao) {
    condicoes.push('e.situacao = ?');
    valores.push(filtro.situacao);
  }
  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const porPagina = Math.min(Math.max(Math.trunc(filtro.porPagina), 1), 100);
  const deslocamento = (Math.max(Math.trunc(filtro.pagina), 1) - 1) * porPagina;

  const [total] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM tarefas_execucoes e JOIN tarefas t ON t.id = e.tarefa_id ${onde}`,
    valores,
  );
  const [linhas] = await pool.query<RowDataPacket[]>(
    `${SELECT_EXECUCAO} ${onde} ORDER BY e.id DESC LIMIT ${porPagina} OFFSET ${deslocamento}`,
    valores,
  );
  return { total: Number(total[0]?.n ?? 0), execucoes: linhas.map(paraExecucaoGeral) };
}

export async function buscarExecucao(id: number): Promise<ExecucaoGeral | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(`${SELECT_EXECUCAO} WHERE e.id = ?`, [id]);
  return linhas[0] ? paraExecucaoGeral(linhas[0]) : null;
}
