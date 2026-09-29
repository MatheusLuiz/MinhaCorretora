import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { binarioParaUuid, uuidParaBinario } from '../utils/uuid.js';
import { condicaoEmVigor } from '../utils/vigencia.js';

// Só digitação, nunca carga (sem `origem_lote`); o recorte de consulta é do serviço.

export interface Atendimento {
  id: string;
  canal: 'whatsapp' | 'email' | 'carta' | 'ligacao';
  motivo: 'inadimplencia' | 'novo_cliente' | 'renovacao' | 'outro';
  resultado: 'contato_feito' | 'sem_resposta' | 'retornar' | 'recusou' | 'enviado';
  descricao: string | null;
  /** `AAAA-MM-DDTHH:MM:SS`, sem fuso. */
  contatoEm: string;
  proximoContato: string | null;
  apolice: { id: string; numero: string } | null;
  /** null = cliente sem apólice ativa. */
  seguradora: string | null;
  registradoPor: { id: string; nome: string };
  registradoEm: string;
}

/** Pool lê DATETIME com `timezone: 'Z'`: usar os getters UTC para manter a hora gravada. */
function dataHora(valor: unknown): string {
  if (valor instanceof Date) {
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${valor.getUTCFullYear()}-${p(valor.getUTCMonth() + 1)}-${p(valor.getUTCDate())}T${p(valor.getUTCHours())}:${p(valor.getUTCMinutes())}:${p(valor.getUTCSeconds())}`;
  }
  return String(valor ?? '');
}

export async function listarDoCliente(clienteId: number): Promise<Atendimento[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT at.uuid, at.canal, at.motivo, at.resultado, at.descricao,
            at.contato_em, at.proximo_contato, at.criado_em,
            ap.uuid AS apolice_uuid, ap.numero AS apolice_numero,
            u.uuid AS usuario_uuid, u.nome AS usuario_nome, s.nome AS seguradora
       FROM atendimentos at
       JOIN usuarios u ON u.id = at.usuario_id
       LEFT JOIN apolices ap ON ap.id = at.apolice_id
       LEFT JOIN seguradoras s ON s.id = at.seguradora_id
      WHERE at.cliente_id = ?
      ORDER BY at.contato_em DESC, at.id DESC`,
    [clienteId],
  );

  return linhas.map((l) => ({
    id: binarioParaUuid(l.uuid as Buffer),
    canal: l.canal,
    motivo: l.motivo,
    resultado: l.resultado,
    descricao: l.descricao === null ? null : String(l.descricao),
    contatoEm: dataHora(l.contato_em),
    proximoContato: l.proximo_contato === null ? null : String(l.proximo_contato).slice(0, 10),
    apolice:
      l.apolice_uuid === null
        ? null
        : { id: binarioParaUuid(l.apolice_uuid as Buffer), numero: String(l.apolice_numero) },
    seguradora: l.seguradora === null ? null : String(l.seguradora),
    registradoPor: { id: binarioParaUuid(l.usuario_uuid as Buffer), nome: String(l.usuario_nome) },
    registradoEm: dataHora(l.criado_em),
  }));
}

export interface ApoliceAtiva {
  id: string;
  numero: string;
  seguradora: string;
  vigenciaFim: string | null;
}

/** Apólices em vigor por `condicaoEmVigor`, não pelas datas: cancelada com vigência em curso não recebe contato. */
export async function apolicesAtivas(
  clienteId: number,
): Promise<(ApoliceAtiva & { idInterno: number; seguradoraId: number })[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT a.id, a.uuid, a.numero, a.vigencia_fim, a.seguradora_id, s.nome AS seguradora
       FROM apolices a
       JOIN seguradoras s ON s.id = a.seguradora_id
      WHERE a.cliente_id = ? AND ${condicaoEmVigor('a')}
      ORDER BY a.vigencia_fim, a.numero`,
    [clienteId],
  );
  return linhas.map((l) => ({
    idInterno: Number(l.id),
    id: binarioParaUuid(l.uuid as Buffer),
    numero: String(l.numero),
    seguradora: String(l.seguradora),
    seguradoraId: Number(l.seguradora_id),
    vigenciaFim: l.vigencia_fim === null ? null : String(l.vigencia_fim).slice(0, 10),
  }));
}

export async function criar(dados: {
  clienteId: number;
  usuarioUuid: string;
  canal: string;
  motivo: string;
  resultado: string;
  descricao: string | null;
  contatoEm: string | null;
  proximoContato: string | null;
  apoliceId: number | null;
  seguradoraId: number | null;
}): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `INSERT INTO atendimentos
       (cliente_id, usuario_id, canal, motivo, resultado, descricao, contato_em, proximo_contato, apolice_id, seguradora_id)
     VALUES (?, (SELECT id FROM usuarios WHERE uuid = ?), ?, ?, ?, ?, COALESCE(?, NOW(3)), ?, ?, ?)`,
    [
      dados.clienteId,
      uuidParaBinario(dados.usuarioUuid),
      dados.canal,
      dados.motivo,
      dados.resultado,
      dados.descricao,
      dados.contatoEm,
      dados.proximoContato,
      dados.apoliceId,
      dados.seguradoraId,
    ],
  );
}

/** Apaga só o registro do PRÓPRIO autor, do cliente informado. */
export async function excluirDoAutor(
  clienteId: number,
  atendimentoUuid: string,
  usuarioUuid: string,
): Promise<boolean> {
  const [resultado] = await pool.execute<ResultSetHeader>(
    `DELETE at FROM atendimentos at
       JOIN usuarios u ON u.id = at.usuario_id
      WHERE at.uuid = ? AND at.cliente_id = ? AND u.uuid = ?`,
    [uuidParaBinario(atendimentoUuid), clienteId, uuidParaBinario(usuarioUuid)],
  );
  return resultado.affectedRows > 0;
}
