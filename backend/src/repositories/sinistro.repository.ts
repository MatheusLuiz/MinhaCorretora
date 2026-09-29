import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { nomeEmCaixaAlta } from '../utils/texto.js';

export type TipoSinistro = 'sinistro' | 'assistencia';

export interface SinistroImportado {
  seguradoraId: number;
  numero: string;
  numeroApolice: string;
  nomeSinistrado: string | null;
  tipo: TipoSinistro;
  ramo: string | null;
  cobertura: string | null;
  causa: string | null;
  ocorridoEm: string | null;
  comunicadoEm: string | null;
  statusProcesso: string | null;
  statusMovimento: string | null;
  reserva: string | null;
  reservaRo: string | null;
  placa: string | null;
  veiculo: string | null;
  origemArquivo: string;
  origemLote: string;
}

/** Grava os acionamentos; o mesmo número ATUALIZA (status e reserva seguem o arquivo mais recente). `origem_lote` fica fora do UPDATE. */
export async function inserirSinistros(
  sinistros: SinistroImportado[],
  conexao?: PoolConnection,
): Promise<number> {
  if (sinistros.length === 0) return 0;

  const executor = conexao ?? pool;
  const agora = new Date();

  const valores: unknown[] = [];
  for (const s of sinistros) {
    valores.push(
      s.seguradoraId, s.numero, s.numeroApolice, nomeEmCaixaAlta(s.nomeSinistrado),
      s.tipo, s.ramo, s.cobertura, s.causa, s.ocorridoEm, s.comunicadoEm,
      s.statusProcesso, s.statusMovimento, s.reserva, s.reservaRo, s.placa, s.veiculo,
      s.origemArquivo, s.origemLote, agora,
    );
  }

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO sinistros
       (seguradora_id, numero, numero_apolice, nome_sinistrado,
        tipo, ramo, cobertura, causa, ocorrido_em, comunicado_em,
        status_processo, status_movimento, reserva, reserva_ro, placa, veiculo,
        origem_arquivo, origem_lote, importado_em)
     VALUES ${sinistros.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE
       numero_apolice = VALUES(numero_apolice),
       nome_sinistrado = VALUES(nome_sinistrado),
       tipo = VALUES(tipo),
       ramo = VALUES(ramo),
       cobertura = VALUES(cobertura),
       causa = VALUES(causa),
       ocorrido_em = VALUES(ocorrido_em),
       comunicado_em = VALUES(comunicado_em),
       status_processo = VALUES(status_processo),
       status_movimento = VALUES(status_movimento),
       reserva = VALUES(reserva),
       reserva_ro = VALUES(reserva_ro),
       placa = COALESCE(VALUES(placa), placa),
       veiculo = COALESCE(VALUES(veiculo), veiculo),
       origem_arquivo = VALUES(origem_arquivo),
       importado_em = VALUES(importado_em)`,
    valores,
  );

  return resultado.affectedRows;
}

/**
 * Liga os acionamentos à apólice (número com UM dono só na companhia) ou, senão, ao nome
 * (UM cliente da companhia; marcado `nome`). Marca `possui_sinistro` só para sinistro, não assistência.
 */
export async function vincularSinistros(
  seguradoraId: number,
  conexao?: PoolConnection,
): Promise<{ porApolice: number; porNome: number; semVinculo: number }> {
  const executor = conexao ?? pool;

  const [porApolice] = await executor.query<ResultSetHeader>(
    `UPDATE sinistros s
       JOIN (SELECT seguradora_id, numero, MIN(id) AS id, MIN(cliente_id) AS cliente_id
               FROM apolices
              WHERE seguradora_id = ?
              GROUP BY seguradora_id, numero
             HAVING COUNT(*) = 1) a
         ON a.seguradora_id = s.seguradora_id AND a.numero = s.numero_apolice
        SET s.apolice_id = a.id,
            s.cliente_id = a.cliente_id,
            s.vinculo_origem = 'apolice'
      WHERE s.seguradora_id = ?
        AND (s.apolice_id IS NULL OR s.apolice_id <> a.id OR s.vinculo_origem <> 'apolice')`,
    [seguradoraId, seguradoraId],
  );

  const [porNome] = await executor.query<ResultSetHeader>(
    `UPDATE sinistros s
       JOIN (SELECT c.nome, MIN(c.id) AS id
               FROM clientes c
              WHERE EXISTS (SELECT 1 FROM apolices a
                             WHERE a.cliente_id = c.id AND a.seguradora_id = ?)
              GROUP BY c.nome
             HAVING COUNT(*) = 1) c
         ON c.nome = s.nome_sinistrado
        SET s.cliente_id = c.id,
            s.vinculo_origem = 'nome'
      WHERE s.seguradora_id = ?
        AND s.apolice_id IS NULL
        AND s.cliente_id IS NULL`,
    [seguradoraId, seguradoraId],
  );

  await executor.query(
    `UPDATE apolices a
        SET a.possui_sinistro = 1
      WHERE a.seguradora_id = ?
        AND EXISTS (SELECT 1 FROM sinistros s
                     WHERE s.apolice_id = a.id AND s.tipo = 'sinistro')`,
    [seguradoraId],
  );

  const [[resto]] = await executor.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM sinistros WHERE seguradora_id = ? AND cliente_id IS NULL',
    [seguradoraId],
  );

  return {
    porApolice: porApolice.affectedRows,
    porNome: porNome.affectedRows,
    semVinculo: Number(resto?.n ?? 0),
  };
}

export interface SinistroDoCliente {
  numero: string;
  numero_apolice: string;
  seguradora: string;
  tipo: TipoSinistro;
  ramo: string | null;
  cobertura: string | null;
  causa: string | null;
  ocorrido_em: string | null;
  comunicado_em: string | null;
  status_processo: string | null;
  status_movimento: string | null;
  reserva: string | null;
  veiculo: string | null;
  vinculo_origem: 'apolice' | 'nome' | null;
}

/** Acionamentos do cliente, mais recente primeiro. */
export async function listarDoCliente(clienteId: number): Promise<SinistroDoCliente[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT s.numero, s.numero_apolice, sg.nome AS seguradora, s.tipo, s.ramo,
            s.cobertura, s.causa, s.ocorrido_em, s.comunicado_em,
            s.status_processo, s.status_movimento, s.reserva, s.veiculo, s.vinculo_origem
       FROM sinistros s
       JOIN seguradoras sg ON sg.id = s.seguradora_id
      WHERE s.cliente_id = ?
      ORDER BY s.ocorrido_em DESC, s.numero DESC`,
    [clienteId],
  );

  return linhas as SinistroDoCliente[];
}

/** Separa "não acionou" de "não sabemos": alguma companhia do cliente tem relatório de sinistros importado? */
export async function haCoberturaParaCliente(clienteId: number): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT EXISTS (
       SELECT 1 FROM apolices a
        WHERE a.cliente_id = ?
          AND EXISTS (SELECT 1 FROM sinistros s WHERE s.seguradora_id = a.seguradora_id)
     ) AS coberto`,
    [clienteId],
  );

  return Number(linhas[0]?.coberto ?? 0) === 1;
}
