import { logger } from '../config/logger.js';
import { pool } from '../database/pool.js';

/**
 * Remove os cadastros cujo nome continua mascarado pelo portal.
 *
 *   npm run db:remover-mascarados              # só mede
 *   npm run db:remover-mascarados -- --aplicar # apaga
 *   npm run db:remover-mascarados -- --aplicar --inclusive-vigentes
 *
 * Cliente com apólice em vigor fica por padrão: a FK é ON DELETE SET NULL e a
 * apólice órfã contaria na produção sem abrir ficha. A apólice sai junto.
 */

const MASCARA = "nome COLLATE utf8mb4_bin REGEXP '(^|[^[:alpha:]])X{2,}[a-z]'";

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const inclusiveVigentes = process.argv.includes('--inclusive-vigentes');

  const protecao = inclusiveVigentes
    ? ''
    : `AND NOT EXISTS (
         SELECT 1 FROM apolices a
          WHERE a.cliente_id = c.id
            AND a.cancelada_em IS NULL
            AND (a.situacao_cia IS NULL OR a.situacao_cia = 'ativa')
            AND a.vigencia_fim >= CURDATE())`;

  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    await conexao.query(`
      CREATE TEMPORARY TABLE remover AS
        SELECT c.id FROM clientes c WHERE ${MASCARA} ${protecao}`);

    const [resumo] = await conexao.query<any[]>(`
      SELECT
        (SELECT COUNT(*) FROM remover) clientes,
        (SELECT COUNT(*) FROM apolices a JOIN remover r ON r.id = a.cliente_id) apolices,
        (SELECT COUNT(*) FROM apolices a JOIN remover r ON r.id = a.cliente_id
          WHERE a.cancelada_em IS NULL AND (a.situacao_cia IS NULL OR a.situacao_cia = 'ativa')
            AND a.vigencia_fim >= CURDATE()) em_vigor,
        (SELECT COUNT(*) FROM comissoes_itens i
           JOIN apolices a ON a.id = i.apolice_id JOIN remover r ON r.id = a.cliente_id) itens_comissao,
        (SELECT COUNT(*) FROM parcelas p
           JOIN apolices a ON a.id = p.apolice_id JOIN remover r ON r.id = a.cliente_id) parcelas,
        (SELECT COUNT(*) FROM clientes WHERE ${MASCARA}) mascarados_hoje`);

    const r = resumo[0] ?? {};
    logger.info(r, aplicar ? 'Removendo' : 'Prévia — nada foi apagado');

    // Apagar apólice com comissão ou parcela desligaria o pagamento do contrato.
    if (Number(r.itens_comissao ?? 0) > 0 || Number(r.parcelas ?? 0) > 0) {
      throw new Error(
        `Recusado: ${r.itens_comissao} item(ns) de comissão e ${r.parcelas} parcela(s) dependem dessas apólices. Nada foi apagado.`,
      );
    }

    if (!aplicar) {
      await conexao.rollback();
      logger.info('Rode de novo com --aplicar para efetivar.');
      return;
    }

    const [apolices] = await conexao.query<any>(
      'DELETE a FROM apolices a JOIN remover r ON r.id = a.cliente_id',
    );
    const [clientes] = await conexao.query<any>(
      'DELETE c FROM clientes c JOIN remover r ON r.id = c.id',
    );

    await conexao.commit();

    const [depois] = await conexao.query<any[]>(`
      SELECT COUNT(*) clientes,
             SUM(${MASCARA}) mascarados,
             (SELECT COUNT(*) FROM apolices) apolices,
             (SELECT COUNT(*) FROM apolices WHERE cliente_id IS NULL) orfas
        FROM clientes`);

    logger.info(
      {
        clientesApagados: clientes.affectedRows,
        apolicesApagadas: apolices.affectedRows,
        ...depois[0],
      },
      'Removido',
    );
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (erro: unknown) => {
    logger.error({ erro: (erro as Error).message }, 'Falha ao remover');
    await pool.end();
    process.exitCode = 1;
  });
