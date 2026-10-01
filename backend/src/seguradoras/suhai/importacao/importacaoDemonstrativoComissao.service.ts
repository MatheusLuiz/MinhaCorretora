import { randomUUID } from 'node:crypto';

import * as comissaoRepo from '../../../repositories/financeiro.repository.js';
import { resolver as resolverLayout } from '../../../services/layoutResolvido.js';
import { LAYOUTS_FINANCEIRO_POR_CHAVE } from '../../../services/modelosFinanceiro.js';
import { AppError } from '../../../utils/AppError.js';

/**
 * Demonstrativo de comissão da Suhai (um arquivo por pagamento, três blocos de rótulos: cabeçalho, itens, totais).
 * Sem número de recibo: o pagamento é `PG <menor id_pagamento>`, igual nos três formatos (reimportar não duplica).
 * `vl_parcela` NÃO é prêmio (é a comissão da parcela).
 */

const TOLERANCIA_CENTAVOS = 0.01;

export interface ResultadoDemonstrativoSuhai {
  lote: string;
  arquivo: string;
  layout: string;
  simulacao: boolean;
  entidade: 'comissoes';

  pagamento: string;
  pagoEm: string;
  competencia: string;

  linhas: number;
  vinculadas: number;
  apolicesDistintas: number;

  somaDasLinhas: number;
  comissaoBruta: number;
  impostos: number;
  liquido: number;
  diferenca: number;

  porTipo: { tipo: string; linhas: number; total: number }[];
  semApolice: string[];
  duplicataDe?: string | null;
}

/** "262.2" (célula numérica) ou "1.262,20" (CSV) → número. */
function decimal(v: string | undefined): number {
  const t = (v ?? '').trim();
  if (!t) return 0;
  const brasileiro = t.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(t);
  const n = Number(brasileiro ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
}

/** Aceita hora no fim (o CSV traz "29/09/2026 00:00:00"). */
function data(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

const rotulos = (linha: string[]): Map<string, number> =>
  new Map(linha.map((c, i) => [c.trim().toLowerCase(), i]));

export async function importarDemonstrativoSuhai(
  grade: string[][],
  opcoes: { layout: string; arquivo: string; simular: boolean },
): Promise<ResultadoDemonstrativoSuhai> {
  const layout = await resolverLayout(opcoes.layout, LAYOUTS_FINANCEIRO_POR_CHAVE.get(opcoes.layout), 'financeiro');
  if (layout.seguradoraId === null) {
    throw AppError.unprocessable(
      `O modelo "${layout.nome}" não está vinculado a nenhuma companhia cadastrada. Vincule-o em Configurações → Seguradoras.`,
    );
  }
  const seguradoraId = layout.seguradoraId;

  const acha = (primeiro: string): number => grade.findIndex((l) => (l[0] ?? '').trim().toLowerCase() === primeiro);
  const iCab = grade.findIndex((l) => l.some((c) => c.trim().toLowerCase() === 'dt_pagto'));
  const iItens = acha('nm_cliente');
  const iTotal = acha('vl_bruto');
  if (iCab < 0 || iItens < 0 || iTotal < 0) {
    throw AppError.unprocessable(
      'Não reconheci o demonstrativo de comissão da Suhai: faltam os blocos "dt_pagto", "nm_cliente" e "vl_bruto".',
    );
  }

  const cab = rotulos(grade[iCab]!);
  const linhaCab = grade[iCab + 1] ?? [];
  const pagoEm = data(linhaCab[cab.get('dt_pagto') ?? -1]);
  if (!pagoEm) throw AppError.unprocessable('O demonstrativo não traz a data do pagamento (dt_pagto). Nada foi gravado.');
  const corretora = (linhaCab[cab.get('nm_corretor') ?? -1] ?? '').trim() || null;
  const susep = (linhaCab[cab.get('cd_susep') ?? -1] ?? '').trim() || null;

  const col = rotulos(grade[iItens]!);
  const v = (l: string[], nome: string): string => (l[col.get(nome) ?? -1] ?? '').trim();
  const itens: comissaoRepo.ItemAnalitico[] = [];
  const ids: number[] = [];
  for (const l of grade.slice(iItens + 1, iTotal)) {
    if (!l.some((c) => c.trim())) continue;
    // "1003100000002 End: 0000000": o endosso tem coluna própria.
    const numeroApolice = v(l, 'cd_apolice').split(/\s+End:/i)[0]!.trim();
    if (!numeroApolice) continue;
    const id = Number(v(l, 'id_pagamento'));
    if (Number.isFinite(id) && id > 0) ids.push(id);
    itens.push({
      sequencia: itens.length + 1,
      numeroApolice,
      nomeSegurado: v(l, 'nm_cliente') || null,
      marca: null,
      sucursal: null,
      ramoCodigo: null,
      susepProducao: susep,
      faturaEndosso: v(l, 'nr_endosso') || null,
      parcela: Number(v(l, 'nr_parcela')) || null,
      carne: null,
      data: pagoEm,
      premioLiquido: null,
      percentualComissao: decimal(v(l, 'pe_comissao')),
      comissao: decimal(v(l, 'vl_pagamento')),
      tipoCodigo: null,
      tipoDescricao: v(l, 'nm_tp_pagamento').slice(0, 60) || null,
    });
  }
  if (itens.length === 0) throw AppError.unprocessable('O demonstrativo não tem nenhuma linha de comissão.');
  if (ids.length === 0) {
    throw AppError.unprocessable(
      'O demonstrativo não traz "id_pagamento". Sem ele não há como saber se este pagamento já foi importado, e rodar de novo duplicaria os valores.',
    );
  }

  const tot = rotulos(grade[iTotal]!);
  const linhaTot = grade[iTotal + 1] ?? [];
  const t = (nome: string): number => decimal(linhaTot[tot.get(nome) ?? -1]);
  const comissaoBruta = t('vl_bruto');
  const impostos = t('vl_ir') + t('vl_iss') + t('vl_inss') + t('vl_tributo_social');
  const liquido = t('vl_liquido');

  const somaDasLinhas = itens.reduce((s, i) => s + i.comissao, 0);
  const diferenca = Number((somaDasLinhas - comissaoBruta).toFixed(2));
  if (Math.abs(diferenca) > TOLERANCIA_CENTAVOS) {
    throw AppError.unprocessable(
      `A soma das ${itens.length} linhas (${somaDasLinhas.toFixed(2)}) não bate com o bruto do rodapé (${comissaoBruta.toFixed(2)}) — diferença de ${diferenca.toFixed(2)}. O arquivo pode estar truncado; nada foi gravado.`,
    );
  }

  const pagamento = `PG ${Math.min(...ids)}`;
  const competencia = pagoEm.slice(0, 7);
  const lote = randomUUID();

  const vinculos = await comissaoRepo.apolicesPorNumero(seguradoraId, [...new Set(itens.map((i) => i.numeroApolice))]);
  for (const item of itens) item.apoliceId = vinculos.get(item.numeroApolice) ?? null;

  if (!opcoes.simular) {
    await comissaoRepo.gravarAnalitico({
      seguradoraId,
      competencia,
      tipo: 'Demonstrativo de comissão',
      ordem: pagamento,
      pagoEm,
      empresa: corretora,
      susepFavorecida: susep,
      comissaoBruta,
      impostos,
      liquido,
      itens,
      origemArquivo: opcoes.arquivo,
      origemLote: lote,
    });
  }

  const porTipo = new Map<string, { linhas: number; total: number }>();
  for (const i of itens) {
    const k = i.tipoDescricao ?? '—';
    const a = porTipo.get(k) ?? { linhas: 0, total: 0 };
    porTipo.set(k, { linhas: a.linhas + 1, total: Number((a.total + i.comissao).toFixed(2)) });
  }

  return {
    lote,
    arquivo: opcoes.arquivo,
    layout: layout.chave,
    simulacao: opcoes.simular,
    entidade: 'comissoes',
    pagamento,
    pagoEm,
    competencia,
    linhas: itens.length,
    vinculadas: itens.filter((i) => i.apoliceId !== null).length,
    apolicesDistintas: new Set(itens.map((i) => i.numeroApolice)).size,
    somaDasLinhas: Number(somaDasLinhas.toFixed(2)),
    comissaoBruta: Number(comissaoBruta.toFixed(2)),
    impostos: Number(impostos.toFixed(2)),
    liquido: Number(liquido.toFixed(2)),
    diferenca,
    porTipo: [...porTipo].map(([tipo, x]) => ({ tipo, ...x })).sort((a, b) => b.total - a.total),
    semApolice: [...new Set(itens.filter((i) => i.apoliceId === null).map((i) => i.numeroApolice))],
  };
}
