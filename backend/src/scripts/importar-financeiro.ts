/**
 * Importador de parcelas e comissões.
 *
 *   npm run db:importar:financeiro -- --arquivo "...\GestaoParcelas_Atrasadas.xlsx" --layout yelum-parcelas-atrasadas --simular
 *   npm run db:importar:financeiro -- --arquivo ... --layout yelum-parcelas-atrasadas --marcar-inadimplentes
 *   npm run db:importar:financeiro -- --arquivo "...\comissao_mensal_09_2026.xlsx" --layout yelum-comissao-mensal
 *
 * Aceita .xlsx e .csv, e acha a linha de cabeçalho por conteúdo — o
 * demonstrativo de comissão tem título e totalizador antes da tabela.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { logger } from '../config/logger.js';
import { encerrarPool } from '../database/pool.js';
import * as repo from '../repositories/financeiro.repository.js';
import * as auditoria from '../services/arquivoAuditoria.service.js';
import {
  importarFinanceiro,
  type ResultadoFinanceiro,
} from '../services/importacaoFinanceiro.service.js';
import { parseLinhaCsv } from '../services/importacaoClientes.service.js';
import { ehLayoutDetalheBradesco, importarComissaoBradesco } from '../seguradoras/bradesco/importacao/importacaoComissao.service.js';
import { LAYOUTS_FINANCEIRO } from '../services/modelosFinanceiro.js';
import { lerXlsx, pareceXlsx } from '../utils/xlsx.js';

function lerArgumentos(): {
  arquivo: string;
  layout: string;
  simular: boolean;
  marcar: boolean;
} {
  const args = process.argv.slice(2);
  const valor = (n: string): string | undefined => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const arquivo = valor('arquivo');
  const layout = valor('layout');

  if (!arquivo || !layout) {
    console.error(
      '\nUso: npm run db:importar:financeiro -- --arquivo <planilha> --layout <chave>' +
        ' [--simular] [--marcar-inadimplentes]\n' +
        `\nLayouts:\n${LAYOUTS_FINANCEIRO.map((l) => `  ${l.chave.padEnd(28)} ${l.nome}`).join('\n')}\n`,
    );
    process.exit(1);
  }

  return {
    arquivo,
    layout,
    simular: args.includes('--simular'),
    marcar: args.includes('--marcar-inadimplentes'),
  };
}

function lerGrade(caminho: string): string[][] {
  const conteudo = readFileSync(caminho);

  if (pareceXlsx(conteudo)) return lerXlsx(conteudo);

  const texto = conteudo.toString('utf8').replace(/^\u{FEFF}/u, '');
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (linhas.length === 0) return [];

  const cabecalho = linhas[0]!;
  const pontoEVirgula =
    (cabecalho.match(/;/g) ?? []).length > (cabecalho.match(/,/g) ?? []).length;

  return linhas.map((l) =>
    pontoEVirgula ? l.split(';').map((c) => c.trim().replace(/^"|"$/g, '')) : parseLinhaCsv(l),
  );
}

const reais = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function imprimir(r: ResultadoFinanceiro): void {
  const linha = (rotulo: string, valor: string | number): void =>
    console.log(`  ${rotulo.padEnd(28, '.')}: ${valor}`);

  console.log('\n─────────────────────────────────────────────');
  console.log(r.simulacao ? '  SIMULAÇÃO (nada foi gravado)' : '  IMPORTAÇÃO CONCLUÍDA');
  console.log('─────────────────────────────────────────────');
  linha('arquivo', r.arquivo);
  linha('layout', `${r.layout} (${r.entidade})`);
  linha('cabeçalho na linha', r.linhaDoCabecalho);
  linha('linhas de dados', r.linhas);
  linha('recusadas', r.recusadas);

  if (!r.simulacao) linha('gravadas', r.gravadas);

  if (r.entidade === 'parcelas') {
    linha('apólices criadas', r.apolicesCriadas);

    if (!r.simulacao) {
      linha('clientes inadimplentes', r.clientesInadimplentes);
      linha(
        'marcados como inadimplente',
        r.inadimplentesMarcados > 0
          ? r.inadimplentesMarcados
          : '0  (use --marcar-inadimplentes)',
      );
    }
  }

  if (r.entidade === 'comissoes') {
    linha('competência', r.competencia ?? '—');
    linha('total líquido', reais(r.totalLiquido ?? 0));
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

  logger.info({ arquivo: nome, layout: opcoes.layout, simular: opcoes.simular }, 'Importação financeira iniciada');

  // Detalhe do Bradesco: pendura cada linha no crédito do extrato.
  if (ehLayoutDetalheBradesco(opcoes.layout)) {
    const r = await importarComissaoBradesco(lerGrade(opcoes.arquivo), {
      layout: opcoes.layout,
      arquivo: nome,
      simular: opcoes.simular,
    });
    console.log(
      `\n  ${r.simulacao ? 'SIMULAÇÃO' : 'IMPORTADO'} ${nome}: ${r.competencia} · ${r.linhas - r.recusadas} itens · ` +
        `${reais(r.totalLiquido)} · ${r.creditosConciliados} créditos conferidos ao centavo · ${r.vinculadas} ligados a apólice\n`,
    );
    if (!r.simulacao) {
      await auditoria.guardar({
        lote: r.lote,
        conteudo: readFileSync(opcoes.arquivo),
        nomeOriginal: nome,
        entidade: r.entidade,
        seguradora: 'Bradesco',
        layout: r.layout,
        origemSistema: 'seguradora',
        resultado: { ...r },
      });
    }
    return;
  }

  const resultado = await importarFinanceiro(lerGrade(opcoes.arquivo), {
    layout: opcoes.layout,
    arquivo: nome,
    simular: opcoes.simular,
    marcarInadimplentes: opcoes.marcar,
  });

  imprimir(resultado);

  if (!opcoes.simular) {
    const guardado = await auditoria.guardar({
      lote: resultado.lote,
      conteudo: readFileSync(opcoes.arquivo),
      nomeOriginal: nome,
      entidade: resultado.entidade,
      seguradora: LAYOUTS_FINANCEIRO.find((l) => l.chave === resultado.layout)?.seguradora ?? null,
      layout: resultado.layout,
      origemSistema: 'seguradora',
      resultado: { ...resultado, mapeamento: undefined },
    });

    if (guardado?.duplicataDe) {
      console.log(`  ATENÇÃO: arquivo idêntico já importado no lote ${guardado.duplicataDe}.\n`);
    }

    const r = await repo.resumo();
    console.log('  situação da base:');
    console.log(`    ${String(r.parcelas).padStart(7)}  parcelas`);
    console.log(`    ${String(r.parcelasAtrasadas).padStart(7)}  em atraso`);
    console.log(`    ${reais(r.valorEmAtraso).padStart(16)}  em atraso`);
    console.log(`    ${String(r.apolicesComAtraso).padStart(7)}  apólices com atraso`);
    console.log(`    ${String(r.clientesInadimplentes).padStart(7)}  clientes atingidos`);
    console.log(`    ${String(r.comissoes).padStart(7)}  lançamentos de comissão`);
    console.log(`    ${reais(r.comissaoLiquida).padStart(16)}  comissão líquida`);
    console.log('');
  }
}

main()
  .catch((erro: unknown) => {
    const e = erro as { message?: string; details?: string[] };
    logger.fatal({ err: erro }, 'Falha na importação financeira');

    if (e.details?.length) console.error(`\n${e.message}\n${e.details.join('\n')}\n`);

    process.exitCode = 1;
  })
  .finally(() => {
    void encerrarPool();
  });
