import { randomUUID } from 'node:crypto';

import { logger } from '../../../config/logger.js';
import * as repo from '../../../repositories/financeiro.repository.js';
import * as seguradoraRepo from '../../../repositories/seguradora.repository.js';
import { AppError } from '../../../utils/AppError.js';

/**
 * DETALHE das comissões do Bradesco (AUTORE/VIDA/SAUDESA): grava só os ITENS, cada um no crédito do
 * extrato (importado antes) em que foi pago. Tudo ou nada: cada crédito tem de bater com seus itens.
 * Saldo negativo de um dia passa ao próximo crédito, por isso o item vai ao PRIMEIRO crédito com data ≥ a dele.
 */

export interface ResultadoComissaoBradesco {
  lote: string;
  arquivo: string;
  layout: string;
  simulacao: boolean;
  entidade: 'comissoes';
  linhas: number;
  gravadas: number;
  recusadas: number;
  motivosDeRecusa: Record<string, number>;
  mapeamento: [];
  colunasIgnoradas: string[];
  /** Intervalo de datas dos lançamentos, "03/08/2026 a 24/09/2026". */
  competencia: string;
  totalLiquido: number;
  creditosConciliados: number;
  vinculadas: number;
  apolicesDistintas: number;
}

const TIPO_LANCAMENTO: Record<string, string> = {
  '100': 'Comissão (crédito)',
  '102': 'Comissão (parcelas antecipadas)',
  '216': 'Crédito sem apólice',
  '400': 'Débito',
  '402': 'Débito (R$ 50,00 por linha)',
  '404': 'Estorno (recuperação de parcelas antecipadas)',
};

/** Códigos que DESCONTAM apesar de virem positivos (provado contra o extrato; código novo: confira lá). */
const DEBITOS = new Set(['400', '402', '404']);

/** Empresas do grupo: mesmo layout de detalhe, créditos próprios. O arquivo não diz a empresa; o layout diz. */
export const EMPRESAS_BRADESCO = {
  'bradesco-comissoes-autore': { empresa: 'AUTO', marca: 'Bradesco Auto RE', arquivo: 'AUTORE' },
  'bradesco-comissoes-vida': { empresa: 'VIDA', marca: 'Bradesco Vida e Previdência', arquivo: 'VIDA' },
  'bradesco-comissoes-saude': { empresa: 'SAUDE', marca: 'Bradesco Saúde', arquivo: 'SAUDESA' },
} as const;
export type LayoutDetalheBradesco = keyof typeof EMPRESAS_BRADESCO;
export const ehLayoutDetalheBradesco = (x: string): x is LayoutDetalheBradesco =>
  Object.prototype.hasOwnProperty.call(EMPRESAS_BRADESCO, x);

const texto = (v: string | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim();

/** Valor do .xlsx vem com resíduo de float (`2562.610107…`): em centavos, arredondado. */
function centavos(v: string | undefined): number {
  const n = Number(texto(v));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function data(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const br = (iso: string): string => iso.split('-').reverse().join('/');

export async function importarComissaoBradesco(
  grade: string[][],
  opcoes: { layout: string; arquivo: string; simular: boolean },
): Promise<ResultadoComissaoBradesco> {
  if (!ehLayoutDetalheBradesco(opcoes.layout)) {
    throw AppError.unprocessable(`Layout de detalhe do Bradesco desconhecido: ${opcoes.layout}.`);
  }
  const { empresa, marca, arquivo: prefixo } = EMPRESAS_BRADESCO[opcoes.layout];
  // Vida no layout de Auto iria ao crédito errado e poderia até fechar: confere pelo nome do arquivo.
  const prefixoDoArquivo = /^(AUTORE|VIDA|SAUDESA)-/i.exec(opcoes.arquivo)?.[1]?.toUpperCase();
  if (prefixoDoArquivo && prefixoDoArquivo !== prefixo) {
    throw AppError.unprocessable(
      `O arquivo ${opcoes.arquivo} é do detalhe ${prefixoDoArquivo}, e o layout escolhido é o de ${prefixo}.`,
    );
  }
  const iCab = grade.findIndex((l) => l.some((c) => texto(c).toUpperCase() === 'NÚMERO DA FATURA'));
  if (iCab < 0) {
    throw AppError.unprocessable(
      'Não encontrei o cabeçalho do detalhe de comissões (coluna "NÚMERO DA FATURA"). Confira se é o arquivo de detalhe (AUTORE, VIDA ou SAUDESA) do portal do Bradesco.',
    );
  }
  const cab = grade[iCab]!.map((c) => texto(c).toUpperCase());
  const col = (nome: string): number => cab.indexOf(nome);
  const C = {
    fatura: col('NÚMERO DA FATURA'),
    sucursal: col('SUCURSAL'),
    data: col('DATA LANÇ'),
    lanc: col('LANÇ'),
    apolice: col('APÓLICE / SUBFATURA'),
    ramo: col('RAMO'),
    segurado: col('SEGURADO'),
    parcela: col('PARCELA'),
    premio: col('VL_PRÊMIO'),
    percentual: col('%'),
    valor: col('VALOR'),
  };
  const faltando = Object.entries(C).filter(([, i]) => i < 0).map(([k]) => k);
  if (faltando.length > 0) {
    throw AppError.unprocessable(`O detalhe não tem as colunas esperadas: ${faltando.join(', ')}.`);
  }

  const seguradora = await seguradoraRepo.porChave('bradesco');
  if (!seguradora) throw AppError.unprocessable('A seguradora Bradesco não está cadastrada.');

  const lote = randomUUID();
  const recusas: Record<string, number> = {};
  const recusar = (m: string): void => {
    recusas[m] = (recusas[m] ?? 0) + 1;
  };

  interface Linha {
    sequencia: number;
    data: string;
    lanc: string;
    numeroApolice: string;
    centavos: number;
    item: Omit<repo.ItemDetalheComissao, 'apoliceId' | 'comissao'>;
  }

  const dados = grade.slice(iCab + 1).filter((l) => texto(l[C.fatura]));
  const linhas: Linha[] = [];

  dados.forEach((l, i) => {
    const quando = data(l[C.data]);
    if (!quando) {
      recusar('sem data de lançamento');
      return;
    }
    const lanc = texto(l[C.lanc]);
    const valor = centavos(l[C.valor]);
    // "COM.PG" com valor zero: comissão paga antes.
    if (valor === 0) {
      recusar('comissão zero (linha "COM.PG" — paga antes)');
      return;
    }
    const assinado = DEBITOS.has(lanc) ? -valor : valor;
    // "000123456/0" → "123456". A subfatura não distingue veículo de frota.
    const numeroApolice = texto(l[C.apolice]).split('/')[0]!.replace(/^0+/, '');
    const percentual = Number(texto(l[C.percentual]));
    const premio = centavos(l[C.premio]);

    linhas.push({
      sequencia: i + 1,
      data: quando,
      lanc,
      numeroApolice,
      centavos: assinado,
      item: {
        sequencia: i + 1,
        numeroApolice,
        nomeSegurado: texto(l[C.segurado]).replace(/\s*COM\.PG$/i, '') || null,
        marca,
        sucursal: texto(l[C.sucursal]) || null,
        ramoCodigo: texto(l[C.ramo]) || null,
        faturaEndosso: texto(l[C.fatura]) || null,
        parcela: Number(texto(l[C.parcela])) || null,
        data: quando,
        premioLiquido: premio > 0 ? premio / 100 : null,
        percentualComissao: Number.isFinite(percentual) && percentual > 0 ? percentual : null,
        tipoCodigo: lanc || null,
        tipoDescricao: TIPO_LANCAMENTO[lanc] ?? (lanc ? `Lançamento ${lanc}` : null),
      },
    });
  });

  if (linhas.length === 0) throw AppError.unprocessable('Nenhuma linha com comissão no arquivo.');

  const creditos = await repo.creditosBradesco(seguradora.id, empresa);
  const semCredito = new Set<string>();
  const porCredito = new Map<number, Linha[]>();
  for (const linha of linhas) {
    const credito = creditos.find((c) => c.pagoEm >= linha.data);
    if (!credito) {
      semCredito.add(linha.data);
      continue;
    }
    porCredito.set(credito.id, [...(porCredito.get(credito.id) ?? []), linha]);
  }

  if (semCredito.size > 0) {
    throw AppError.unprocessable(
      'Há lançamentos sem crédito correspondente na base. Importe antes o extrato de "Últimos lançamentos" que cobre estas datas.',
      [...semCredito].sort().map((d) => `  ${br(d)}`),
    );
  }

  const diferencas: string[] = [];
  for (const [id, itens] of porCredito) {
    const credito = creditos.find((c) => c.id === id)!;
    const soma = itens.reduce((t, l) => t + l.centavos, 0);
    const esperado = Math.round(credito.bruto * 100);
    if (soma !== esperado) {
      diferencas.push(`  ${br(credito.pagoEm)}: itens R$ ${(soma / 100).toFixed(2)} × crédito R$ ${(esperado / 100).toFixed(2)}`);
    }
  }
  if (diferencas.length > 0) {
    throw AppError.unprocessable(
      'O detalhe não fecha com o extrato — nada foi gravado. Um detalhe pela metade pareceria apurado.',
      diferencas.slice(0, 15),
    );
  }

  const apolices = await repo.apolicesUnicasPorNumero(
    seguradora.id,
    linhas.map((l) => l.numeroApolice),
  );

  const porComissao = new Map<number, repo.ItemDetalheComissao[]>(
    [...porCredito].map(([id, itens]) => [
      id,
      itens.map((l) => ({
        ...l.item,
        apoliceId: apolices.get(l.numeroApolice) ?? null,
        comissao: l.centavos / 100,
      })),
    ]),
  );

  const datas = linhas.map((l) => l.data).sort();
  const total = linhas.reduce((t, l) => t + l.centavos, 0) / 100;
  const vinculadas = linhas.filter((l) => apolices.has(l.numeroApolice)).length;

  const gravadas = opcoes.simular ? 0 : await repo.substituirItensDeComissoes(porComissao, lote);

  if (!opcoes.simular) {
    logger.info(
      { lote, arquivo: opcoes.arquivo, itens: gravadas, creditos: porComissao.size, total },
      'Detalhe de comissões do Bradesco importado',
    );
  }

  return {
    lote,
    arquivo: opcoes.arquivo,
    layout: opcoes.layout,
    simulacao: opcoes.simular,
    entidade: 'comissoes',
    linhas: dados.length,
    gravadas,
    recusadas: Object.values(recusas).reduce((a, b) => a + b, 0),
    motivosDeRecusa: recusas,
    mapeamento: [],
    colunasIgnoradas: [],
    competencia: `${br(datas[0]!)} a ${br(datas[datas.length - 1]!)}`,
    totalLiquido: Math.round(total * 100) / 100,
    creditosConciliados: porComissao.size,
    vinculadas,
    apolicesDistintas: new Set(linhas.map((l) => l.numeroApolice).filter(Boolean)).size,
  };
}
