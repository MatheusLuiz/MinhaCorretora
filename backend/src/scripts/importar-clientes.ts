/**
 * Importador de base de clientes a partir de CSV — linha de comando.
 *
 *   npm run db:importar:clientes -- --arquivo "C:\caminho\clientes.csv" --origem manual
 *   npm run db:importar:clientes -- --arquivo ... --origem seguradora --simular
 *   npm run db:importar:clientes -- --arquivo ... --origem manual --situacao prospecto
 *
 * `--origem` é obrigatória. A lógica é a mesma da tela
 * (`services/importacaoClientes.service.ts`).
 */
import { createReadStream, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';

import { logger } from '../config/logger.js';
import { encerrarPool } from '../database/pool.js';
import type { OrigemSistema } from '../repositories/cliente.repository.js';
import * as auditoria from '../services/arquivoAuditoria.service.js';
import { importar, type ResultadoImportacao } from '../services/importacaoClientes.service.js';
import { lerXlsx, pareceXlsx } from '../utils/xlsx.js';

const ORIGENS_VALIDAS: OrigemSistema[] = ['seguradora', 'manual'];

interface Opcoes {
  arquivo: string;
  origem: OrigemSistema;
  situacao: string | undefined;
  simular: boolean;
}

function lerArgumentos(): Opcoes {
  const args = process.argv.slice(2);

  const valor = (nome: string): string | undefined => {
    const i = args.indexOf(`--${nome}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const arquivo = valor('arquivo');

  if (!arquivo) {
    console.error(
      '\nUso: npm run db:importar:clientes -- --arquivo <caminho.csv>' +
        ' --origem <seguradora|manual> [--situacao ativo] [--simular]\n',
    );
    process.exit(1);
  }

  const origemInformada = valor('origem');
  if (!origemInformada || !ORIGENS_VALIDAS.includes(origemInformada as OrigemSistema)) {
    console.error(
      `\n--origem ${origemInformada ? `inválida: ${origemInformada}` : 'é obrigatória'}. Use uma de: ${ORIGENS_VALIDAS.join(', ')}\n`,
    );
    process.exit(1);
  }
  const origem = origemInformada as OrigemSistema;

  return {
    arquivo,
    origem,
    situacao: valor('situacao') ?? 'ativo',
    simular: args.includes('--simular'),
  };
}

function imprimirRelatorio(r: ResultadoImportacao): void {
  const linha = (rotulo: string, valor: string | number): void =>
    console.log(`  ${rotulo.padEnd(22, '.')}: ${valor}`);

  console.log('\n─────────────────────────────────────────────');
  console.log(r.simulacao ? '  SIMULAÇÃO (nada foi gravado)' : '  IMPORTAÇÃO CONCLUÍDA');
  console.log('─────────────────────────────────────────────');
  linha('arquivo', r.arquivo);
  linha('origem', r.origem);
  linha('lote', r.lote);
  linha('linhas lidas', r.lidas);

  if (!r.simulacao) {
    linha('clientes inseridos', r.inseridas);
    linha('clientes atualizados', r.atualizadas);
  }

  linha('recusadas', r.recusadas);
  linha('e-mails descartados', `${r.emailsDescartados}  (inválidos; o cadastro entrou sem eles)`);

  if (r.colunasIgnoradas.length > 0) {
    console.log(`\n  colunas ignoradas (o importador não as conhece):`);
    console.log(`    ${r.colunasIgnoradas.join(', ')}`);
  }

  console.log('\n  satélites:');
  for (const [nome, n] of Object.entries(r.satelites)) {
    console.log(`    ${String(n).padStart(7)}  ${nome}`);
  }

  // A collation ignora acento e caixa: o banco costuma ter menos valores.
  console.log('\n  valores distintos no arquivo (o banco consolida acento/caixa):');
  for (const [nome, n] of Object.entries(r.valoresDistintos)) {
    console.log(`    ${String(n).padStart(7)}  ${nome}`);
  }

  if (r.impacto) {
    console.log('\n  o que a gravação faria:');
    console.log(`    ${String(r.impacto.novos).padStart(7)}  cadastros novos`);
    console.log(
      `    ${String(r.impacto.existentes).padStart(7)}  cadastros existentes sobrescritos`,
    );

    const perdas = Object.entries(r.impacto.perdem).filter(([, n]) => n > 0);

    if (perdas.length > 0) {
      console.log('\n  ATENÇÃO — a planilha não traz estas colunas, e espelhar APAGA:');
      for (const [tipo, n] of perdas) {
        console.log(`    ${String(n).padStart(7)}  clientes perderiam ${tipo}`);
      }
    }
  }

  if (r.recusadas > 0) {
    console.log('\n  motivos das recusas:');
    for (const [motivo, quantidade] of Object.entries(r.motivosDeRecusa)) {
      console.log(`    ${String(quantidade).padStart(7)}  ${motivo}`);
    }
    console.log(`\n  primeiras linhas recusadas: ${r.recusas.slice(0, 10).map((x) => x.linha).join(', ')}`);
  }

  console.log('─────────────────────────────────────────────\n');
}

/** Planilha → linhas de CSV (`;`); o cabeçalho é a 1ª linha com mais de 5 células. */
async function* linhasDaPlanilha(grade: string[][]): AsyncGenerator<string> {
  const inicio = grade.findIndex((l) => l.filter((c) => (c ?? '').trim()).length > 5);
  if (inicio < 0) throw new Error('Não encontrei o cabeçalho na planilha.');
  const celula = (c: string | undefined): string => {
    const v = c ?? '';
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  for (const linha of grade.slice(inicio)) yield linha.map(celula).join(';');
}

async function main(): Promise<void> {
  const opcoes = lerArgumentos();
  const nomeArquivo = basename(opcoes.arquivo);

  logger.info(
    { arquivo: nomeArquivo, origem: opcoes.origem, simular: opcoes.simular },
    opcoes.simular ? 'Simulação de importação iniciada' : 'Importação iniciada',
  );

  // O `readline` emite linhas assim que é criado: nenhum `await` entre criá-lo
  // e consumi-lo, senão o cabeçalho se perde. Formato pelo conteúdo, não extensão.
  const bruto = readFileSync(opcoes.arquivo);
  const leitor = pareceXlsx(bruto)
    ? linhasDaPlanilha(lerXlsx(bruto))
    : createInterface({ input: createReadStream(opcoes.arquivo, 'utf8'), crlfDelay: Infinity });

  const resultado = await importar(leitor, {
    origem: opcoes.origem,
    arquivo: nomeArquivo,
    simular: opcoes.simular,
    situacaoPadrao: opcoes.situacao,
    aoProgredir: (lidas) => {
      if (lidas % 2000 === 0) logger.info({ lidas }, 'Importação em andamento');
    },
  });

  imprimirRelatorio(resultado);

  if (!opcoes.simular) {
    const guardado = await auditoria.guardar({
      lote: resultado.lote,
      conteudo: readFileSync(opcoes.arquivo),
      nomeOriginal: nomeArquivo,
      entidade: 'clientes',
      seguradora: opcoes.origem === 'seguradora' ? null : opcoes.origem,
      layout: null,
      origemSistema: opcoes.origem,
      resultado: { ...resultado, mapeamento: undefined, recusas: undefined },
    });

    if (guardado?.duplicataDe) {
      console.log(`  ATENÇÃO: arquivo idêntico já importado no lote ${guardado.duplicataDe}.\n`);
    }
  }
}

main()
  .catch((erro: unknown) => {
    logger.fatal({ err: erro }, 'Falha na importação');
    process.exitCode = 1;
  })
  .finally(() => {
    void encerrarPool();
  });
