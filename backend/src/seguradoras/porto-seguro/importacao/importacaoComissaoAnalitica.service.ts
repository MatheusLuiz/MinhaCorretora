import { randomUUID } from 'node:crypto';

import * as comissaoRepo from '../../../repositories/financeiro.repository.js';
import { resolver as resolverLayout } from '../../../services/layoutResolvido.js';
import { LAYOUTS_FINANCEIRO_POR_CHAVE } from '../../../services/modelosFinanceiro.js';
import { AppError } from '../../../utils/AppError.js';
import { repararMojibake } from '../../../utils/texto.js';

/**
 * "Analítico dos Pagamentos de Comissões" da Porto: extrato em blocos (ordem, seções por Susep de
 * produção, rodapé), não planilha. A linha de dado se reconhece por ter 13 colunas.
 * A soma das linhas TEM de bater com a "Comissão Bruta" do rodapé, senão a carga é recusada.
 * "Premio Liq." é da PARCELA: nunca gravar como prêmio da apólice.
 */

/** Colunas da linha de dado, nesta ordem. */
const HISTORICO = 0;
const MARCA = 1;
const SUCURSAL = 2;
const RAMO = 3;
const APOLICE = 4;
const FAT_EDS = 5;
const PARCELA = 6;
const CARNE = 7;
const DATA = 8;
const PREMIO = 9;
const TAXA = 10;
const COMISSAO = 11;
const TIPO = 12;

const COLUNAS_DE_DADO = 13;

const TOLERANCIA_CENTAVOS = 0.01;

export interface ResultadoComissaoAnalitica {
  lote: string;
  arquivo: string;
  layout: string;
  simulacao: boolean;
  entidade: 'comissoes';

  ordem: string | null;
  pagoEm: string | null;
  competencia: string | null;
  empresa: string | null;
  susepFavorecida: string | null;

  linhas: number;
  vinculadas: number;
  apolicesDistintas: number;

  somaDasLinhas: number;
  comissaoBruta: number;
  impostos: number;
  liquido: number;
  diferenca: number;

  porTipo: { tipo: string; linhas: number; total: number }[];
  susepsDeProducao: string[];
  /** Números que não existem na base — a comissão entra, o vínculo não. */
  semApolice: string[];
  duplicataDe?: string | null;
}

export interface OpcoesComissaoAnalitica {
  layout: string;
  arquivo: string;
  simular: boolean;
  seguradora?: string;
}

const texto = (v: string | undefined): string => repararMojibake((v ?? '').trim());

/** "1.709,98" → 1709.98. Negativo vem com o sinal na frente. */
function decimal(v: string | undefined): number {
  const limpo = texto(v).replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

function data(v: string | undefined): string | null {
  const t = texto(v);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

function inteiro(v: string | undefined): number | null {
  const n = Number(texto(v).replace(/\D/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function importarComissaoAnalitica(
  grade: string[][],
  opcoes: OpcoesComissaoAnalitica,
): Promise<ResultadoComissaoAnalitica> {
  const layout = await resolverLayout(
    opcoes.layout,
    LAYOUTS_FINANCEIRO_POR_CHAVE.get(opcoes.layout),
    'financeiro',
  );

  // Número de apólice só é único DENTRO de uma seguradora.
  if (layout.seguradoraId === null) {
    throw AppError.unprocessable(
      `O modelo "${layout.nome}" não está vinculado a nenhuma companhia cadastrada. Vincule-o em Configurações → Seguradoras antes de importar.`,
    );
  }

  const seguradoraId = layout.seguradoraId;
  const lote = randomUUID();

  let ordem: string | null = null;
  let pagoEm: string | null = null;
  let empresa: string | null = null;
  let susepFavorecida: string | null = null;
  let susepProducao: string | null = null;

  const itens: comissaoRepo.ItemAnalitico[] = [];
  const suseps: string[] = [];
  let comissaoBruta = 0;
  let impostos = 0;
  let liquido = 0;
  let achouRodape = false;

  for (let i = 0; i < grade.length; i++) {
    const l = grade[i] ?? [];
    const c0 = texto(l[0]);

    if (c0 === 'Ordem de Pagamento:') {
      ordem = texto(l[1]);
      pagoEm = data(l[3]);
      continue;
    }

    if (c0 === 'Empresa:') {
      empresa = texto(l[1]);
      continue;
    }

    if (c0.startsWith('Susep Favorecida')) {
      susepFavorecida = texto(l[1]).split(/\s*-\s*/)[0] ?? null;
      continue;
    }

    if (c0.startsWith('Susep de Produção')) {
      susepProducao = c0.replace(/^Susep de Produção:?\s*/, '');
      if (susepProducao && !suseps.includes(susepProducao)) suseps.push(susepProducao);
      continue;
    }

    // Rodapé: rótulos numa linha, valores na seguinte.
    if (c0 === 'Comissão Bruta') {
      const v = grade[i + 1] ?? [];
      comissaoBruta += decimal(v[0]);
      impostos += decimal(v[1]) + decimal(v[2]) + decimal(v[3]);
      liquido += decimal(v[4]);
      achouRodape = true;
      continue;
    }

    if (l.length !== COLUNAS_DE_DADO) continue;

    if (texto(l[HISTORICO]) === 'Histórico') continue;

    const tipoBruto = texto(l[TIPO]);
    const separador = tipoBruto.match(/^(\d+)\s*-\s*(.+)$/);

    itens.push({
      sequencia: itens.length + 1,
      numeroApolice: texto(l[APOLICE]),
      nomeSegurado: texto(l[HISTORICO]) || null,
      marca: texto(l[MARCA]) || null,
      sucursal: texto(l[SUCURSAL]) || null,
      ramoCodigo: texto(l[RAMO]) || null,
      susepProducao,
      faturaEndosso: texto(l[FAT_EDS]) || null,
      parcela: inteiro(l[PARCELA]),
      carne: texto(l[CARNE]) || null,
      data: data(l[DATA]),
      premioLiquido: decimal(l[PREMIO]),
      percentualComissao: decimal(l[TAXA]),
      comissao: decimal(l[COMISSAO]),
      tipoCodigo: separador?.[1] ?? null,
      tipoDescricao: separador?.[2] ?? tipoBruto ?? null,
    });
  }

  if (itens.length === 0) {
    throw AppError.unprocessable(
      'Nenhuma linha de comissão foi reconhecida. Confira se o arquivo é o "Analítico dos Pagamentos de Comissões" da Porto — ele sai do portal com extensão .do e é uma tabela HTML.',
    );
  }

  if (!ordem) {
    throw AppError.unprocessable(
      'O arquivo não traz "Ordem de Pagamento". Sem ela não há como saber se este pagamento já foi importado, e rodar de novo duplicaria os valores.',
    );
  }

  const somaDasLinhas = itens.reduce((s, i) => s + i.comissao, 0);
  const diferenca = Number((somaDasLinhas - comissaoBruta).toFixed(2));

  if (achouRodape && Math.abs(diferenca) > TOLERANCIA_CENTAVOS) {
    throw AppError.unprocessable(
      `A soma das ${itens.length} linhas (${somaDasLinhas.toFixed(2)}) não bate com a Comissão Bruta do rodapé (${comissaoBruta.toFixed(2)}) — diferença de ${diferenca.toFixed(2)}. O arquivo pode estar truncado; nada foi gravado.`,
    );
  }

  const competencia = pagoEm ? pagoEm.slice(0, 7) : null;

  const vinculos = await comissaoRepo.apolicesPorNumero(
    seguradoraId,
    [...new Set(itens.map((i) => i.numeroApolice))],
  );

  for (const item of itens) item.apoliceId = vinculos.get(item.numeroApolice) ?? null;

  const porTipo = new Map<string, { linhas: number; total: number }>();
  for (const i of itens) {
    const k = i.tipoDescricao ?? '—';
    const a = porTipo.get(k) ?? { linhas: 0, total: 0 };
    porTipo.set(k, { linhas: a.linhas + 1, total: Number((a.total + i.comissao).toFixed(2)) });
  }

  if (!opcoes.simular) {
    if (!competencia) {
      throw AppError.unprocessable(
        'O arquivo não traz a data de pagamento, e a competência sai dela. Nada foi gravado.',
      );
    }

    await comissaoRepo.gravarAnalitico({
      seguradoraId,
      competencia,
      ordem,
      pagoEm,
      empresa,
      susepFavorecida,
      comissaoBruta,
      impostos,
      liquido,
      itens,
      origemArquivo: opcoes.arquivo,
      origemLote: lote,
    });
  }

  return {
    lote,
    arquivo: opcoes.arquivo,
    layout: layout.chave,
    simulacao: opcoes.simular,
    entidade: 'comissoes',

    ordem,
    pagoEm,
    competencia,
    empresa,
    susepFavorecida,

    linhas: itens.length,
    vinculadas: itens.filter((i) => i.apoliceId !== null).length,
    apolicesDistintas: new Set(itens.map((i) => i.numeroApolice)).size,

    somaDasLinhas: Number(somaDasLinhas.toFixed(2)),
    comissaoBruta: Number(comissaoBruta.toFixed(2)),
    impostos: Number(impostos.toFixed(2)),
    liquido: Number(liquido.toFixed(2)),
    diferenca,

    porTipo: [...porTipo]
      .map(([tipo, v]) => ({ tipo, ...v }))
      .sort((a, b) => b.total - a.total),
    susepsDeProducao: suseps,
    semApolice: [
      ...new Set(itens.filter((i) => i.apoliceId === null).map((i) => i.numeroApolice)),
    ],
  };
}
