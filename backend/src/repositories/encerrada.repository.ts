import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';
import { nomeEmCaixaAlta } from '../utils/texto.js';

/** Acesso a `apolices_encerradas` (a lista que a seguradora entrega). */

export interface EncerradaImportada {
  seguradoraId: number;
  numeroApolice: string;
  sucursal: string | null;
  nomeSegurado: string;
  placa: string | null;
  teveEndosso: boolean | null;
  emitidaEm: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string;
  origemArquivo: string;
  origemLote: string;
}

/** Vigência mais curta que isto acabou ANTES do prazo; a folga cobre bissexto e vigência de ~11 meses. */
const DIAS_DE_PRAZO_CHEIO = 350;

/** Janela, em dias, em torno do fim da antiga, para a nova apólice do mesmo veículo começar. */
const JANELA_DA_RENOVACAO = 30;

export async function inserirEncerradas(
  itens: EncerradaImportada[],
  conexao: PoolConnection,
): Promise<number> {
  if (itens.length === 0) return 0;

  // `origem_lote` fora do UPDATE: desfazer a carga nova não apaga a antiga.
  const [r] = await conexao.query<ResultSetHeader>(
    `INSERT INTO apolices_encerradas
       (seguradora_id, numero_apolice, sucursal, nome_segurado, placa, teve_endosso,
        emitida_em, vigencia_inicio, vigencia_fim, origem_arquivo, origem_lote, importado_em)
     VALUES ? AS novo
     ON DUPLICATE KEY UPDATE
       nome_segurado   = novo.nome_segurado,
       sucursal        = COALESCE(novo.sucursal, apolices_encerradas.sucursal),
       placa           = COALESCE(novo.placa, apolices_encerradas.placa),
       teve_endosso    = COALESCE(novo.teve_endosso, apolices_encerradas.teve_endosso),
       emitida_em      = COALESCE(novo.emitida_em, apolices_encerradas.emitida_em),
       vigencia_inicio = COALESCE(novo.vigencia_inicio, apolices_encerradas.vigencia_inicio),
       origem_arquivo  = novo.origem_arquivo,
       importado_em    = novo.importado_em`,
    [
      itens.map((i) => [
        i.seguradoraId, i.numeroApolice, i.sucursal, nomeEmCaixaAlta(i.nomeSegurado), i.placa,
        i.teveEndosso === null ? null : i.teveEndosso ? 1 : 0,
        i.emitidaEm, i.vigenciaInicio, i.vigenciaFim, i.origemArquivo, i.origemLote, new Date(),
      ]),
    ],
  );

  return r.affectedRows;
}

/**
 * Liga cada encerrada: pela apólice (exato); à RENOVAÇÃO (mesmo veículo, início a ±30 dias do fim,
 * marca `renovacao` se vazio); cliente pela renovação; cliente pelo NOME, se casar com um só.
 */
export async function vincularEncerradas(
  seguradoraId: number,
  conexao?: PoolConnection,
): Promise<{ porApolice: number; renovadas: number; porNome: number; semVinculo: number }> {
  const executor = conexao ?? pool;

  const [porApolice] = await executor.query<ResultSetHeader>(
    `UPDATE apolices_encerradas e
       JOIN (SELECT seguradora_id, numero, MIN(id) AS id, MIN(cliente_id) AS cliente_id
               FROM apolices
              WHERE seguradora_id = ?
              GROUP BY seguradora_id, numero
             HAVING COUNT(*) = 1) a
         ON a.seguradora_id = e.seguradora_id AND a.numero = e.numero_apolice
        SET e.apolice_id = a.id,
            e.cliente_id = COALESCE(a.cliente_id, e.cliente_id),
            e.vinculo_origem = 'apolice'
      WHERE e.seguradora_id = ?
        AND (e.apolice_id IS NULL OR e.apolice_id <> a.id)`,
    [seguradoraId, seguradoraId],
  );

  // MENOR apólice por encerrada, para o UPDATE não depender da ordem do JOIN.
  const [renovadas] = await executor.query<ResultSetHeader>(
    `UPDATE apolices_encerradas e
       JOIN (SELECT e2.id AS encerrada_id, MIN(a.id) AS nova_id
               FROM apolices_encerradas e2
               JOIN apolice_veiculos v ON v.placa = e2.placa
               JOIN apolices a ON a.id = v.apolice_id
              WHERE e2.seguradora_id = ?
                AND e2.placa IS NOT NULL
                AND a.numero <> e2.numero_apolice
                AND a.vigencia_inicio BETWEEN e2.vigencia_fim - INTERVAL ? DAY
                                          AND e2.vigencia_fim + INTERVAL ? DAY
              GROUP BY e2.id) n ON n.encerrada_id = e.id
        SET e.renovada_por_apolice_id = n.nova_id`,
    [seguradoraId, JANELA_DA_RENOVACAO, JANELA_DA_RENOVACAO],
  );

  await executor.query(
    `UPDATE apolices a
       JOIN apolices_encerradas e ON e.renovada_por_apolice_id = a.id
        SET a.tipo_negocio = 'renovacao'
      WHERE e.seguradora_id = ? AND a.tipo_negocio IS NULL`,
    [seguradoraId],
  );

  await executor.query(
    `UPDATE apolices_encerradas e
       JOIN apolices a ON a.id = e.renovada_por_apolice_id
        SET e.cliente_id = a.cliente_id,
            e.vinculo_origem = 'renovacao'
      WHERE e.seguradora_id = ?
        AND e.cliente_id IS NULL
        AND a.cliente_id IS NOT NULL`,
    [seguradoraId],
  );

  const [porNome] = await executor.query<ResultSetHeader>(
    `UPDATE apolices_encerradas e
       JOIN (SELECT c.nome, MIN(c.id) AS id
               FROM clientes c
              WHERE EXISTS (SELECT 1 FROM apolices a
                             WHERE a.cliente_id = c.id AND a.seguradora_id = ?)
              GROUP BY c.nome
             HAVING COUNT(*) = 1) c
         ON c.nome = e.nome_segurado
        SET e.cliente_id = c.id,
            e.vinculo_origem = 'nome'
      WHERE e.seguradora_id = ?
        AND e.cliente_id IS NULL`,
    [seguradoraId, seguradoraId],
  );

  const [[resto]] = await executor.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM apolices_encerradas WHERE seguradora_id = ? AND cliente_id IS NULL',
    [seguradoraId],
  );

  return {
    porApolice: porApolice.affectedRows,
    renovadas: renovadas.affectedRows,
    porNome: porNome.affectedRows,
    semVinculo: Number(resto?.n ?? 0),
  };
}

/** O mesmo vínculo, pela chave da companhia (PDF do Bradesco). */
export async function vincularPorChave(
  seguradoraChave: string,
): Promise<Awaited<ReturnType<typeof vincularEncerradas>> | null> {
  const [[s]] = await pool.execute<RowDataPacket[]>('SELECT id FROM seguradoras WHERE chave = ?', [
    seguradoraChave,
  ]);
  return s ? vincularEncerradas(Number(s.id)) : null;
}

export type DesfechoEncerrada = 'renovada' | 'antes_do_prazo' | 'sem_renovacao';

export interface ApoliceEncerrada {
  seguradora: string;
  numeroApolice: string;
  nomeSegurado: string;
  placa: string | null;
  teveEndosso: boolean | null;
  vigenciaInicio: string | null;
  vigenciaFim: string;
  clienteId: string | null;
  vinculoOrigem: 'apolice' | 'renovacao' | 'nome' | null;
  produtor: string | null;
  /** `sem_renovacao` NÃO é "perdida": a nova pode só não ter sido importada ainda. */
  desfecho: DesfechoEncerrada;
  renovadaPor: { numero: string; seguradora: string; vigenciaInicio: string | null } | null;
}

/** As encerradas, da mais recente à mais antiga; sem cliente some para quem só vê a própria carteira. */
export async function listar(escopo: Escopo = ESCOPO_TOTAL, limite = 200): Promise<ApoliceEncerrada[]> {
  const n = Math.min(Math.max(Math.trunc(limite), 1), 500);
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT s.nome AS seguradora, e.numero_apolice, e.nome_segurado, e.placa, e.teve_endosso,
            e.vigencia_inicio, e.vigencia_fim, BIN_TO_UUID(c.uuid, 1) AS cliente_id,
            e.vinculo_origem, pr.nome AS produtor,
            nova.numero AS nova_numero, sn.nome AS nova_seguradora, nova.vigencia_inicio AS nova_inicio,
            CASE
              WHEN e.renovada_por_apolice_id IS NOT NULL THEN 'renovada'
              WHEN e.vigencia_inicio IS NOT NULL
               AND DATEDIFF(e.vigencia_fim, e.vigencia_inicio) < ? THEN 'antes_do_prazo'
              ELSE 'sem_renovacao'
            END AS desfecho
       FROM apolices_encerradas e
       JOIN seguradoras s ON s.id = e.seguradora_id
       LEFT JOIN clientes c ON c.id = e.cliente_id
       LEFT JOIN produtores pr ON pr.id = c.produtor_id
       LEFT JOIN apolices nova ON nova.id = e.renovada_por_apolice_id
       LEFT JOIN seguradoras sn ON sn.id = nova.seguradora_id
      ${carteira.condicao ? `WHERE ${carteira.condicao}` : ''}
      ORDER BY e.vigencia_fim DESC, e.nome_segurado
      LIMIT ${n}`,
    [DIAS_DE_PRAZO_CHEIO, ...carteira.valores],
  );

  const dataIso = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

  return linhas.map((l) => ({
    seguradora: String(l.seguradora),
    numeroApolice: String(l.numero_apolice),
    nomeSegurado: String(l.nome_segurado),
    placa: l.placa ? String(l.placa) : null,
    teveEndosso: l.teve_endosso === null ? null : l.teve_endosso === 1,
    vigenciaInicio: dataIso(l.vigencia_inicio),
    vigenciaFim: dataIso(l.vigencia_fim)!,
    clienteId: l.cliente_id ? String(l.cliente_id) : null,
    vinculoOrigem: l.vinculo_origem ?? null,
    produtor: l.produtor ? String(l.produtor) : null,
    desfecho: l.desfecho as DesfechoEncerrada,
    renovadaPor: l.nova_numero
      ? { numero: String(l.nova_numero), seguradora: String(l.nova_seguradora), vigenciaInicio: dataIso(l.nova_inicio) }
      : null,
  }));
}
