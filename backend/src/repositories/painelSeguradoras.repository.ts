import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';
import { condicaoEmVigor } from '../utils/vigencia.js';

/**
 * Dashboard de Seguradoras. "O relatório chegou?" se lê em `arquivos_importados`, não nas apólices
 * (mês sem venda ≠ mês sem arquivo). `arquivos_importados.seguradora` é TEXTO: cruza por nome.
 */

export interface CargaPorLayout {
  seguradora: string | null;
  layout: string | null;
  entidade: string;
  cargas: number;
  desfeitas: number;
  /** Carga mais recente. `AAAA-MM-DD HH:MM` formatado no SQL, para o dia não virar na conversão a UTC. */
  ultimaEm: string;
  ultimaPor: string | null;
  ultimaArquivo: string;
  ultimaDesfeitaEm: string | null;
  /** A válida (não desfeita) mais recente — é ela que diz se está em dia. */
  ultimaValidaEm: string | null;
  ultimaValidaPor: string | null;
  diasDesdeValida: number | null;
}

/** Por seguradora × layout: a carga mais recente e a válida mais recente (o prazo conta da que FICOU). */
export async function cargasPorLayout(): Promise<CargaPorLayout[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT x.seguradora, x.layout, x.entidade, x.cargas, x.desfeitas,
            DATE_FORMAT(x.importado_em, '%Y-%m-%d %H:%i') AS ultima_em, u.nome AS ultima_por,
            x.nome_original AS ultima_arquivo,
            DATE_FORMAT(x.desfeito_em, '%Y-%m-%d %H:%i') AS ultima_desfeita_em,
            DATE_FORMAT(v.importado_em, '%Y-%m-%d %H:%i') AS ultima_valida_em,
            uv.nome AS ultima_valida_por,
            DATEDIFF(CURDATE(), DATE(v.importado_em)) AS dias_desde_valida
       FROM (
             SELECT a.*,
                    ROW_NUMBER() OVER (grupo ORDER BY a.importado_em DESC, a.id DESC) AS ordem,
                    COUNT(*) OVER grupo AS cargas,
                    SUM(a.desfeito_em IS NOT NULL) OVER grupo AS desfeitas
               FROM arquivos_importados a
             WINDOW grupo AS (PARTITION BY a.seguradora, a.layout)
            ) x
       LEFT JOIN usuarios u ON u.id = x.importado_por
       LEFT JOIN (
             SELECT b.seguradora, b.layout, b.importado_em, b.importado_por,
                    ROW_NUMBER() OVER (PARTITION BY b.seguradora, b.layout
                                       ORDER BY b.importado_em DESC, b.id DESC) AS ordem
               FROM arquivos_importados b
              WHERE b.desfeito_em IS NULL
            ) v ON v.ordem = 1
               AND v.seguradora <=> x.seguradora
               AND v.layout <=> x.layout
       LEFT JOIN usuarios uv ON uv.id = v.importado_por
      WHERE x.ordem = 1`,
  );

  return linhas.map((l) => ({
    seguradora: l.seguradora === null ? null : String(l.seguradora),
    layout: l.layout === null ? null : String(l.layout),
    entidade: String(l.entidade),
    cargas: Number(l.cargas),
    desfeitas: Number(l.desfeitas),
    ultimaEm: String(l.ultima_em),
    ultimaPor: l.ultima_por === null ? null : String(l.ultima_por),
    ultimaArquivo: String(l.ultima_arquivo),
    ultimaDesfeitaEm: l.ultima_desfeita_em === null ? null : String(l.ultima_desfeita_em),
    ultimaValidaEm: l.ultima_valida_em === null ? null : String(l.ultima_valida_em),
    ultimaValidaPor: l.ultima_valida_por === null ? null : String(l.ultima_valida_por),
    diasDesdeValida: l.dias_desde_valida === null ? null : Number(l.dias_desde_valida),
  }));
}

export interface SeguradoraCadastrada {
  id: number;
  chave: string | null;
  nome: string;
  ativa: boolean;
}

export async function seguradorasCadastradas(): Promise<SeguradoraCadastrada[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    'SELECT id, chave, nome, ativa FROM seguradoras ORDER BY nome',
  );
  return linhas.map((l) => ({
    id: Number(l.id),
    chave: l.chave === null ? null : String(l.chave),
    nome: String(l.nome),
    ativa: Boolean(l.ativa),
  }));
}

export interface CarteiraDaSeguradora {
  seguradoraId: number;
  apolices: number;
  emVigor: number;
  /** Prêmio das apólices em vigor. `null` = nenhuma em vigor tem prêmio. */
  premioEmVigor: number | null;
  clientesEmVigor: number;
}

/**
 * Apólices e prêmio EM VIGOR por companhia. Sem recorte, a apólice sem cliente conta; com recorte,
 * a condição de carteira a descarta.
 */
export async function carteiraPorSeguradora(escopo: Escopo = ESCOPO_TOTAL): Promise<CarteiraDaSeguradora[]> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const emVigor = condicaoEmVigor('a');

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT a.seguradora_id,
            COUNT(*) AS apolices,
            SUM(${emVigor}) AS em_vigor,
            SUM(CASE WHEN ${emVigor} THEN a.premio_total END) AS premio_em_vigor,
            COUNT(DISTINCT CASE WHEN ${emVigor} THEN a.cliente_id END) AS clientes_em_vigor
       FROM apolices a
       LEFT JOIN clientes c ON c.id = a.cliente_id
      ${carteira.condicao ? `WHERE ${carteira.condicao}` : ''}
      GROUP BY a.seguradora_id`,
    carteira.valores,
  );

  return linhas.map((l) => ({
    seguradoraId: Number(l.seguradora_id),
    apolices: Number(l.apolices),
    emVigor: Number(l.em_vigor ?? 0),
    premioEmVigor: l.premio_em_vigor === null ? null : Number(l.premio_em_vigor),
    clientesEmVigor: Number(l.clientes_em_vigor ?? 0),
  }));
}

export interface ComissaoDaSeguradora {
  seguradoraId: number;
  liquidoMes: number;
  liquidoAno: number;
}

/** Comissão líquida RECEBIDA, pela data do pagamento. Sem escopo: só com `comissoes.todas`. */
export async function comissaoRecebidaPorSeguradora(): Promise<ComissaoDaSeguradora[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT seguradora_id,
            SUM(CASE WHEN DATE_FORMAT(pago_em, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
                     THEN total_liquido ELSE 0 END) AS mes,
            SUM(total_liquido) AS ano
       FROM comissoes
      WHERE YEAR(pago_em) = YEAR(CURDATE())
      GROUP BY seguradora_id`,
  );
  return linhas.map((l) => ({
    seguradoraId: Number(l.seguradora_id),
    liquidoMes: Number(l.mes ?? 0),
    liquidoAno: Number(l.ano ?? 0),
  }));
}
