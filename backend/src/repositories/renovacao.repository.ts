import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';
import { nomeEmCaixaAlta } from '../utils/texto.js';

export interface RenovacaoImportada {
  seguradoraId: number;
  numeroApolice: string;
  vigenciaFim: string;
  nomeSegurado: string;
  sucursal: string | null;
  agencia: string | null;
  percentualComissao: number | null;
  veiculo: string | null;
  placa: string | null;
  sinistros: number | null;
  classeBonus: number | null;
  premioRenovacao: number | null;
  cotadoOutroCorretor: boolean | null;
  temResidencial: boolean | null;
  origemArquivo: string;
  origemLote: string;
}

const bool = (v: boolean | null): number | null => (v === null ? null : v ? 1 : 0);

/** Reimportar ATUALIZA com `COALESCE` (vazio não apaga). `origem_lote` fica fora do UPDATE. */
export async function inserirRenovacoes(
  itens: RenovacaoImportada[],
  conexao: PoolConnection,
): Promise<number> {
  if (itens.length === 0) return 0;

  const [r] = await conexao.query<ResultSetHeader>(
    `INSERT INTO renovacoes_previstas
       (seguradora_id, numero_apolice, vigencia_fim, nome_segurado, sucursal, agencia,
        percentual_comissao, veiculo, placa, sinistros, classe_bonus, premio_renovacao,
        cotado_outro_corretor, tem_residencial, origem_arquivo, origem_lote, importado_em)
     VALUES ? AS novo
     ON DUPLICATE KEY UPDATE
       nome_segurado        = novo.nome_segurado,
       sucursal             = COALESCE(novo.sucursal, renovacoes_previstas.sucursal),
       agencia              = COALESCE(novo.agencia, renovacoes_previstas.agencia),
       percentual_comissao  = COALESCE(novo.percentual_comissao, renovacoes_previstas.percentual_comissao),
       veiculo              = COALESCE(novo.veiculo, renovacoes_previstas.veiculo),
       placa                = COALESCE(novo.placa, renovacoes_previstas.placa),
       sinistros            = COALESCE(novo.sinistros, renovacoes_previstas.sinistros),
       classe_bonus         = COALESCE(novo.classe_bonus, renovacoes_previstas.classe_bonus),
       premio_renovacao     = COALESCE(novo.premio_renovacao, renovacoes_previstas.premio_renovacao),
       cotado_outro_corretor = COALESCE(novo.cotado_outro_corretor, renovacoes_previstas.cotado_outro_corretor),
       tem_residencial      = COALESCE(novo.tem_residencial, renovacoes_previstas.tem_residencial),
       origem_arquivo       = novo.origem_arquivo,
       importado_em         = novo.importado_em`,
    [
      itens.map((i) => [
        i.seguradoraId, i.numeroApolice, i.vigenciaFim, nomeEmCaixaAlta(i.nomeSegurado),
        i.sucursal, i.agencia, i.percentualComissao, i.veiculo, i.placa, i.sinistros,
        i.classeBonus, i.premioRenovacao, bool(i.cotadoOutroCorretor), bool(i.temResidencial),
        i.origemArquivo, i.origemLote, new Date(),
      ]),
    ],
  );

  return r.affectedRows;
}

/**
 * Liga a renovação à apólice (exato; o % de comissão desce só se a apólice não tiver) ou ao nome,
 * se casar com UM cliente com apólice na companhia. Roda também a cada PDF do Bradesco.
 */
export async function vincularRenovacoes(
  seguradoraId: number,
  conexao?: PoolConnection,
): Promise<{ porApolice: number; porNome: number; semVinculo: number; comissaoNaApolice: number }> {
  const executor = conexao ?? pool;

  const [porApolice] = await executor.query<ResultSetHeader>(
    `UPDATE renovacoes_previstas r
       JOIN (SELECT seguradora_id, numero, MIN(id) AS id, MIN(cliente_id) AS cliente_id
               FROM apolices
              WHERE seguradora_id = ?
              GROUP BY seguradora_id, numero
             HAVING COUNT(*) = 1) a
         ON a.seguradora_id = r.seguradora_id AND a.numero = r.numero_apolice
        SET r.apolice_id = a.id,
            r.cliente_id = a.cliente_id,
            r.vinculo_origem = 'apolice'
      WHERE r.seguradora_id = ?
        AND (r.apolice_id IS NULL OR r.apolice_id <> a.id OR r.vinculo_origem <> 'apolice')`,
    [seguradoraId, seguradoraId],
  );

  const [porNome] = await executor.query<ResultSetHeader>(
    `UPDATE renovacoes_previstas r
       JOIN (SELECT c.nome, MIN(c.id) AS id
               FROM clientes c
              WHERE EXISTS (SELECT 1 FROM apolices a
                             WHERE a.cliente_id = c.id AND a.seguradora_id = ?)
              GROUP BY c.nome
             HAVING COUNT(*) = 1) c
         ON c.nome = r.nome_segurado
        SET r.cliente_id = c.id,
            r.vinculo_origem = 'nome'
      WHERE r.seguradora_id = ?
        AND r.apolice_id IS NULL
        AND r.cliente_id IS NULL`,
    [seguradoraId, seguradoraId],
  );

  const [comissao] = await executor.query<ResultSetHeader>(
    `UPDATE apolices a
       JOIN renovacoes_previstas r ON r.apolice_id = a.id
        SET a.percentual_comissao = r.percentual_comissao
      WHERE r.seguradora_id = ?
        AND r.percentual_comissao IS NOT NULL
        AND a.percentual_comissao IS NULL`,
    [seguradoraId],
  );

  const [[resto]] = await executor.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM renovacoes_previstas WHERE seguradora_id = ? AND cliente_id IS NULL',
    [seguradoraId],
  );

  return {
    porApolice: porApolice.affectedRows,
    porNome: porNome.affectedRows,
    semVinculo: Number(resto?.n ?? 0),
    comissaoNaApolice: comissao.affectedRows,
  };
}

/** O mesmo vínculo, pela chave da companhia — para quem não tem o id à mão (PDF do Bradesco). */
export async function vincularPorChave(
  seguradoraChave: string,
): Promise<Awaited<ReturnType<typeof vincularRenovacoes>> | null> {
  const [[s]] = await pool.execute<RowDataPacket[]>('SELECT id FROM seguradoras WHERE chave = ?', [
    seguradoraChave,
  ]);
  return s ? vincularRenovacoes(Number(s.id)) : null;
}

export interface RenovacaoPrevista {
  seguradora: string;
  numeroApolice: string;
  vigenciaFim: string;
  nomeSegurado: string;
  clienteId: string | null;
  vinculoOrigem: 'apolice' | 'nome' | null;
  produtor: string | null;
  percentualComissao: number | null;
  veiculo: string | null;
  placa: string | null;
  sinistros: number | null;
  classeBonus: number | null;
  premioRenovacao: number | null;
  cotadoOutroCorretor: boolean;
}

/** A lista a partir de hoje; renovação sem cliente some para quem só vê a própria carteira. */
export async function listarAVencer(escopo: Escopo = ESCOPO_TOTAL, limite = 200): Promise<RenovacaoPrevista[]> {
  const n = Math.min(Math.max(Math.trunc(limite), 1), 500);
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT s.nome AS seguradora, r.numero_apolice, r.vigencia_fim, r.nome_segurado,
            BIN_TO_UUID(c.uuid, 1) AS cliente_id, r.vinculo_origem, pr.nome AS produtor,
            r.percentual_comissao, r.veiculo, r.placa, r.sinistros, r.classe_bonus,
            r.premio_renovacao, r.cotado_outro_corretor
       FROM renovacoes_previstas r
       JOIN seguradoras s ON s.id = r.seguradora_id
       LEFT JOIN clientes c ON c.id = r.cliente_id
       LEFT JOIN produtores pr ON pr.id = c.produtor_id
      WHERE r.vigencia_fim >= CURDATE()
        ${carteira.condicao ? `AND ${carteira.condicao}` : ''}
      ORDER BY r.vigencia_fim, r.nome_segurado
      LIMIT ${n}`,
    carteira.valores,
  );

  return linhas.map((l) => ({
    seguradora: String(l.seguradora),
    numeroApolice: String(l.numero_apolice),
    vigenciaFim: String(l.vigencia_fim).slice(0, 10),
    nomeSegurado: String(l.nome_segurado),
    clienteId: l.cliente_id ? String(l.cliente_id) : null,
    vinculoOrigem: l.vinculo_origem ?? null,
    produtor: l.produtor ? String(l.produtor) : null,
    percentualComissao: l.percentual_comissao === null ? null : Number(l.percentual_comissao),
    veiculo: l.veiculo ? String(l.veiculo) : null,
    placa: l.placa ? String(l.placa) : null,
    sinistros: l.sinistros === null ? null : Number(l.sinistros),
    classeBonus: l.classe_bonus === null ? null : Number(l.classe_bonus),
    premioRenovacao: l.premio_renovacao === null ? null : Number(l.premio_renovacao),
    cotadoOutroCorretor: l.cotado_outro_corretor === 1,
  }));
}
