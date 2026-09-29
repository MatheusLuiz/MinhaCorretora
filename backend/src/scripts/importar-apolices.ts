/**
 * Importador de apólices a partir de relatório de seguradora.
 *
 *   npm run db:importar:apolices -- --arquivo "C:\...\Busca_de_apolices.xlsx" --layout yelum-busca-apolices --simular
 *   npm run db:importar:apolices -- --arquivo ... --layout yelum-busca-apolices --vincular
 *
 * Aceita .xlsx e .csv.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import { logger } from '../config/logger.js';
import { encerrarPool } from '../database/pool.js';
import * as apoliceRepo from '../repositories/apolice.repository.js';
import * as auditoria from '../services/arquivoAuditoria.service.js';
import {
  importarApolices,
  type ResultadoImportacaoApolices,
} from '../services/importacaoApolices.service.js';
import { LAYOUTS_APOLICES } from '../services/modelosApolices.js';
import { parseLinhaCsv } from '../services/importacaoClientes.service.js';
import { lerXlsx, pareceXlsx } from '../utils/xlsx.js';

interface Opcoes {
  arquivo: string;
  layout: string;
  simular: boolean;
  vincular: boolean;
}

function lerArgumentos(): Opcoes {
  const args = process.argv.slice(2);

  const valor = (nome: string): string | undefined => {
    const i = args.indexOf(`--${nome}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const arquivo = valor('arquivo');
  const layout = valor('layout');

  if (!arquivo || !layout) {
    console.error(
      '\nUso: npm run db:importar:apolices -- --arquivo <planilha> --layout <chave> [--simular] [--vincular]\n' +
        `\nLayouts disponíveis:\n${LAYOUTS_APOLICES.map((l) => `  ${l.chave.padEnd(28)} ${l.nome}`).join('\n')}\n`,
    );
    process.exit(1);
  }

  return {
    arquivo,
    layout,
    simular: args.includes('--simular'),
    vincular: args.includes('--vincular'),
  };
}

function lerGrade(caminho: string): string[][] {
  const conteudo = readFileSync(caminho);

  if (pareceXlsx(conteudo)) return lerXlsx(conteudo);

  const texto = conteudo.toString('utf8').replace(/^\uFEFF/, '');
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');

  if (linhas.length === 0) return [];

  // Excel em português salva com `;` porque a vírgula é o separador decimal.
  const cabecalho = linhas[0]!;
  const usaPontoEVirgula =
    (cabecalho.match(/;/g) ?? []).length > (cabecalho.match(/,/g) ?? []).length;

  return linhas.map((l) =>
    usaPontoEVirgula
      ? l.split(';').map((c) => c.trim().replace(/^"|"$/g, ''))
      : parseLinhaCsv(l),
  );
}

function imprimir(r: ResultadoImportacaoApolices): void {
  const linha = (rotulo: string, valor: string | number): void =>
    console.log(`  ${rotulo.padEnd(26, '.')}: ${valor}`);

  console.log('\n─────────────────────────────────────────────');
  console.log(r.simulacao ? '  SIMULAÇÃO (nada foi gravado)' : '  IMPORTAÇÃO DE APÓLICES CONCLUÍDA');
  console.log('─────────────────────────────────────────────');
  linha('arquivo', r.arquivo);
  linha('layout', `${r.layout} (${r.seguradora})`);
  linha('lote', r.lote);
  linha('linhas lidas', r.linhas);
  linha('recusadas', r.recusadas);
  linha('apólices', r.apolices);
  linha('movimentos', r.movimentos);

  if (Object.keys(r.porTipo).length > 0) {
    console.log('\n  movimentos por tipo:');
    for (const [tipo, n] of Object.entries(r.porTipo)) {
      console.log(`      ${String(n).padStart(6)}  ${tipo}`);
    }
  }

  if (r.semCabecalhoCompleto > 0) {
    console.log(
      `\n  ${r.semCabecalhoCompleto} apólice(s) sem a emissão original no arquivo.\n` +
        '    A vigência veio do endosso e o prêmio ficou em branco — a emissão\n' +
        '    é anterior ao período exportado. Importe uma janela mais ampla\n' +
        '    para completá-las.',
    );
  }

  console.log(`\n  produtos encontrados (${r.produtos.length}):`);
  for (const p of r.produtos) console.log(`    ${p}`);

  if (!r.simulacao) {
    console.log('');
    linha('vinculadas a cliente', r.vinculadas);
    linha('  por documento', r.vinculadasPorDocumento);
    linha('  vinculos corrigidos', r.vinculosCorrigidos);
    linha('sem cliente (total na base)', r.semCliente);
  }

  if (r.colunasIgnoradas.length > 0) {
    console.log(`\n  colunas ignoradas: ${r.colunasIgnoradas.join(', ')}`);
  }

  console.log('\n  tradução do cabeçalho:');
  for (const c of r.mapeamento.filter((x) => x.origem !== '')) {
    console.log(`    ${String(c.origem).padEnd(28)} → ${c.canonica ?? '(ignorada)'}`);
  }

  if (r.recusadas > 0) {
    console.log('\n  motivos das recusas:');
    for (const [motivo, n] of Object.entries(r.motivosDeRecusa)) {
      console.log(`    ${String(n).padStart(6)}  ${motivo}`);
    }
  }

  console.log('─────────────────────────────────────────────\n');
}

async function main(): Promise<void> {
  const opcoes = lerArgumentos();
  const nome = basename(opcoes.arquivo);

  logger.info(
    { arquivo: nome, layout: opcoes.layout, formato: extname(nome), simular: opcoes.simular },
    'Importação de apólices iniciada',
  );

  const resultado = await importarApolices(lerGrade(opcoes.arquivo), {
    layout: opcoes.layout,
    arquivo: nome,
    simular: opcoes.simular,
    vincularPorNome: opcoes.vincular,
  });

  imprimir(resultado);

  // Cópia só quando a carga gravou: arquivo sem carga confundiria a auditoria.
  if (!opcoes.simular) {
    const guardado = await auditoria.guardar({
      lote: resultado.lote,
      conteudo: readFileSync(opcoes.arquivo),
      nomeOriginal: nome,
      entidade: 'apolices',
      seguradora: resultado.seguradora,
      layout: resultado.layout,
      origemSistema: 'seguradora',
      resultado: { ...resultado, mapeamento: undefined },
    });

    if (guardado?.duplicataDe) {
      console.log(
        `  ATENÇÃO: arquivo idêntico já importado no lote ${guardado.duplicataDe}.\n` +
          '    A carga é idempotente, então nada foi duplicado — mas confira se\n' +
          '    era mesmo para rodar de novo.\n',
      );
    }
  }

  if (!opcoes.simular) {
    console.log('  situação da base:');
    const resumo = await apoliceRepo.resumo();
    for (const [chave, valor] of Object.entries(resumo)) {
      if (typeof valor === 'number') console.log(`    ${String(valor).padStart(6)}  ${chave}`);
    }
    console.log('');
  }
}

main()
  .catch((erro: unknown) => {
    const e = erro as { message?: string; details?: string[] };
    logger.fatal({ err: erro }, 'Falha na importação de apólices');

    if (e.details?.length) {
      console.error(`\n${e.message}\n${e.details.join('\n')}\n`);
    }

    process.exitCode = 1;
  })
  .finally(() => {
    void encerrarPool();
  });
