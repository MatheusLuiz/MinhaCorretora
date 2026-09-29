import { logger } from '../config/logger.js';
import { pool } from '../database/pool.js';
import * as arquivos from '../repositories/arquivoImportado.repository.js';
import { recuperar } from '../services/arquivoAuditoria.service.js';
import { gravarVeiculoDoPdf } from '../seguradoras/bradesco/importacao/importacaoPdf.service.js';
import { lerHistoricoBradesco } from '../seguradoras/bradesco/importacao/leitorPdf.js';

/**
 * Relê os PDFs do Bradesco já importados e grava o veículo de cada apólice.
 *
 *   npm run db:veiculos-bradesco
 *
 * Só toca `apolice_veiculos` e o tipo da apólice. Do lote mais antigo para o
 * mais novo (vence o PDF mais recente). Idempotente.
 */

const lotes = await arquivos.lotesDoLayout('bradesco-historico-apolice');
let gravados = 0;
const semApolice: string[] = [];
const falhas: string[] = [];

for (const lote of lotes) {
  try {
    const { nome, conteudo } = await recuperar(lote);
    const apolice = lerHistoricoBradesco(conteudo);
    if (!apolice.veiculo) continue;

    if (await gravarVeiculoDoPdf(apolice)) gravados++;
    else semApolice.push(`${nome} (${apolice.apolice}/${apolice.item ?? '?'})`);
  } catch (erro) {
    falhas.push(`${lote}: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

logger.info({ lotes: lotes.length, gravados, semApolice, falhas }, 'Veículos do Bradesco relidos dos PDFs');
await pool.end();
