/**
 * QUANDO as apólices canceladas da Porto foram canceladas (para o
 * dashboard de Cancelamentos).
 *
 *   npm run db:cancelamentos-porto -- --canceladas <download.xls> --mes 2026-08 \
 *        --canceladas <download.xls> --mes 2026-09                   # prévia
 *   ... --aplicar                                                    # grava
 *
 * A Porto não dá a data: o mês do arquivo vai em `cancelada_mes`, nunca um dia
 * inventado em `cancelada_em`. Só aceita arquivo com TODA linha CANCELADO (o de
 * vencidas também traz CANCELADO, de outros meses). A primeira escrita vence.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { lerGrade } from '../controllers/importacaoArquivos.controller.js';
import { encerrarPool, pool } from '../database/pool.js';
import { numeroDaApolice } from '../seguradoras/porto-seguro/importacao/importacaoConsultaPortal.service.js';

/** Os pares `--canceladas <arquivo> --mes AAAA-MM`, na ordem em que vieram. */
function pares(): { arquivo: string; mes: string }[] {
  const saida: { arquivo: string; mes: string }[] = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--canceladas') continue;
    const arquivo = argv[i + 1];
    const mes = argv[i + 2] === '--mes' ? argv[i + 3] : undefined;
    if (!arquivo || !mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      throw new Error('Cada --canceladas <arquivo> vem seguido de --mes AAAA-MM.');
    }
    saida.push({ arquivo, mes });
  }
  return saida;
}

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const arquivos = pares();

  const [[porto]] = await pool.query<RowDataPacket[]>(`SELECT id FROM seguradoras WHERE chave = 'porto-seguro'`);
  if (!porto) throw new Error('A Porto Seguro não está no cadastro de seguradoras.');
  const [semData] = await pool.query<RowDataPacket[]>(
    `SELECT id, numero FROM apolices
      WHERE seguradora_id = ? AND situacao_cia = 'cancelada' AND cancelada_em IS NULL`,
    [porto.id],
  );
  console.log(`\nPorto: ${semData.length} apólice(s) cancelada(s) sem data de cancelamento.`);

  const porNumero = new Map(semData.map((a) => [String(a.numero), Number(a.id)]));
  const comMes = new Map<number, string>();
  for (const { arquivo, mes } of arquivos) {
    const grade = lerGrade(readFileSync(arquivo));
    const cab = grade[0] ?? [];
    const iNum = cab.findIndex((c) => /^Ap.lice\/Contrato$/i.test(c.trim()));
    const iSit = cab.findIndex((c) => /^Status$/i.test(c.trim()));
    if (iNum < 0 || iSit < 0) throw new Error(`${arquivo}: não é a consulta do portal da Porto (faltam "Apólice/Contrato" e "Status").`);
    const linhas = grade.slice(1).filter((l) => (l[iNum] ?? '').trim());
    const outras = linhas.filter((l) => !/^CANCELADO$/i.test((l[iSit] ?? '').trim())).length;
    if (outras > 0) {
      throw new Error(`${arquivo}: ${outras} linha(s) que não estão CANCELADAS — é o arquivo de vencidas ou de emitidas, não o de canceladas.`);
    }
    let novas = 0;
    for (const l of linhas) {
      const id = porNumero.get(numeroDaApolice(l[iNum]!));
      if (id === undefined || comMes.has(id)) continue;
      comMes.set(id, mes);
      novas++;
    }
    console.log(`  ${basename(arquivo)} (${mes}): ${linhas.length} linha(s), ${novas} apólice(s) ganham o mês`);
  }
  const restam = semData.length - comMes.size;
  console.log(`  sem mês (ficam "sem data" no painel): ${restam}`);

  if (!aplicar) {
    console.log('\nPrévia. Para gravar: o mesmo comando com --aplicar (faça um db:ponto antes).\n');
    return;
  }

  const conexao: PoolConnection = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    let meses = 0;
    for (const [id, mes] of comMes) {
      const [r] = await conexao.execute<ResultSetHeader>(
        `UPDATE apolices SET cancelada_mes = ?
          WHERE id = ? AND cancelada_em IS NULL AND cancelada_mes IS NULL`,
        [`${mes}-01`, id],
      );
      meses += r.affectedRows;
    }
    await conexao.commit();
    console.log(`\nGravado: ${meses} com o mês.\n`);
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

main()
  .catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  })
  .finally(() => encerrarPool());
