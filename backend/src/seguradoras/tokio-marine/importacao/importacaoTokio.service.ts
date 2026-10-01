import { randomUUID } from 'node:crypto';

import * as apoliceRepo from '../../../repositories/apolice.repository.js';
import * as comissaoRepo from '../../../repositories/financeiro.repository.js';
import * as seguradoraRepo from '../../../repositories/seguradora.repository.js';
import { normalizarNomeColuna } from '../../../services/colunasImportacao.js';
import { importarCarteira, type ResultadoCarteira } from '../../../services/importacaoCarteira.service.js';
import { resolver as resolverLayout } from '../../../services/layoutResolvido.js';
import { LAYOUTS_FINANCEIRO_POR_CHAVE } from '../../../services/modelosFinanceiro.js';
import { AppError } from '../../../utils/AppError.js';
import { gravarApolicesSemCliente, type ApoliceSemCliente } from '../../comum/apolicesSemCliente.js';

/**
 * Relatórios do portal da Tokio Marine.
 * EMITIDAS: sem fim de vigência (é início + 12 meses); apólice com vários locais vem em várias linhas (soma).
 * CANCELADAS: sem CPF (dono pela base); "Emissao" é a data do CANCELAMENTO.
 * COMISSÕES: extrato com impostos NEGATIVOS e rodapé conferido ao centavo.
 */

export const LAYOUT_EMITIDAS = 'tokio-apolices-emitidas';
export const LAYOUT_CANCELADAS = 'tokio-apolices-canceladas';
export const LAYOUT_COMISSOES = 'tokio-comissoes-extrato';
const TOLERANCIA = 0.01;

function colunas(cabecalho: string[]): (nome: string) => number {
  const cab = cabecalho.map(normalizarNomeColuna);
  return (nome) => cab.indexOf(nome);
}

/** "2499.6" (célula numérica) ou "2.499,60" → número. */
function valor(v: string | undefined): number {
  const t = (v ?? '').trim();
  if (!t) return 0;
  const brasileiro = t.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(t);
  const n = Number(brasileiro ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
}

/** 29/02 cai em 28/02 (o ano seguinte não é bissexto). */
function umAnoDepois(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(br.trim());
  if (!m) return '';
  const dia = m[1] === '29' && m[2] === '02' ? '28' : m[1];
  return `${dia}/${m[2]}/${Number(m[3]) + 1}`;
}

function acharCabecalho(grade: string[][]): number {
  return grade.findIndex((l) => {
    const n = l.map(normalizarNomeColuna);
    return n.includes('apolice') && n.includes('segurado');
  });
}

export interface ResultadoEmitidasTokio extends ResultadoCarteira {
  tokio: { linhasDoArquivo: number; apolices: number; linhasSomadas: number };
}

export async function importarEmitidasTokio(
  grade: string[][],
  opcoes: { arquivo: string; simular: boolean; lote?: string },
): Promise<ResultadoEmitidasTokio> {
  const iCab = acharCabecalho(grade);
  if (iCab < 0) throw AppError.unprocessable('Não reconheci o relatório de apólices emitidas da Tokio Marine (faltam "Apolice" e "Segurado").');
  const c = colunas(grade[iCab]!);
  const col = {
    documento: c('cpf_cnpj'), nome: c('segurado'), ramo: c('ramo'), apolice: c('apolice'),
    emissao: c('emissao'), inicio: c('vigencia'), premio: c('premio'),
  };
  if (col.documento < 0 || col.inicio < 0) throw AppError.unprocessable('O relatório de emitidas da Tokio não traz "CPF/CNPJ" e "Vigencia".');

  const porApolice = new Map<string, { linha: string[]; premio: number }>();
  let dados = 0;
  for (const l of grade.slice(iCab + 1)) {
    const numero = (l[col.apolice] ?? '').trim();
    if (!numero) continue;
    dados++;
    const k = `${numero}|${(l[col.documento] ?? '').replace(/\D/g, '')}`;
    const atual = porApolice.get(k);
    if (atual) atual.premio += valor(l[col.premio]);
    else porApolice.set(k, { linha: l, premio: valor(l[col.premio]) });
  }

  const saida: string[][] = [
    ['numero_apolice', 'cpf_cnpj', 'nome_civil', 'ramo_descricao', 'produto', 'emitida_em', 'vigencia_inicio', 'vigencia_fim', 'premio_total'],
  ];
  for (const { linha: l, premio } of porApolice.values()) {
    const v = (i: number): string => (i >= 0 ? (l[i] ?? '').trim() : '');
    saida.push([
      v(col.apolice), v(col.documento), v(col.nome), v(col.ramo), v(col.ramo),
      v(col.emissao), v(col.inicio), umAnoDepois(v(col.inicio)), premio ? premio.toFixed(2) : '',
    ]);
  }

  const resultado = await importarCarteira(saida, {
    layout: LAYOUT_EMITIDAS,
    arquivo: opcoes.arquivo,
    simular: opcoes.simular,
    ...(opcoes.lote ? { lote: opcoes.lote } : {}),
  });
  return { ...resultado, tokio: { linhasDoArquivo: dados, apolices: porApolice.size, linhasSomadas: dados - porApolice.size } };
}

export interface ResultadoCanceladasTokio extends ResultadoCarteira {
  tokio: {
    linhasDoArquivo: number;
    cpfDaBase: number;
    semCpf: string[];
    gravadasSemCliente: number;
  };
}

export async function importarCanceladasTokio(
  grade: string[][],
  opcoes: { arquivo: string; simular: boolean; lote?: string },
): Promise<ResultadoCanceladasTokio> {
  const iCab = acharCabecalho(grade);
  if (iCab < 0) throw AppError.unprocessable('Não reconheci o relatório de apólices canceladas da Tokio Marine (faltam "Apolice" e "Segurado").');
  const c = colunas(grade[iCab]!);
  const col = { nome: c('segurado'), ramo: c('ramo'), apolice: c('apolice'), data: c('emissao'), motivo: c('motivo_cancelamento') };
  if (col.data < 0 || col.motivo < 0) throw AppError.unprocessable('O relatório de canceladas da Tokio não traz "Emissao" (a data do cancelamento) e "Motivo Cancelamento".');

  const linhas = grade.slice(iCab + 1).filter((l) => (l[col.apolice] ?? '').trim());
  const seguradora = await seguradoraRepo.porChave('tokio-marine');
  if (!seguradora) throw AppError.unprocessable('A Tokio Marine não está no cadastro de seguradoras (migration 061).');
  const base = await apoliceRepo.donosPorNumero(seguradora.id, linhas.map((l) => (l[col.apolice] ?? '').trim()));

  const saida: string[][] = [
    ['numero_apolice', 'cpf_cnpj', 'nome_civil', 'ramo_descricao', 'produto', 'cancelada_em', 'motivo_cancelamento'],
  ];
  let cpfDaBase = 0;
  const semCpf: string[] = [];
  const semCliente: ApoliceSemCliente[] = [];
  for (const l of linhas) {
    const v = (i: number): string => (i >= 0 ? (l[i] ?? '').trim() : '');
    const numero = v(col.apolice);
    const dono = base.get(numero)?.[0];
    const documento = dono?.documento;
    if (!documento) {
      semCpf.push(`${numero} · ${v(col.nome)} · ${v(col.ramo)} · ${v(col.motivo)}`);
      semCliente.push({
        numero,
        nomeSegurado: v(col.nome),
        produto: v(col.ramo) || null,
        situacaoCia: 'cancelada',
        canceladaEm: v(col.data),
        motivoCancelamento: v(col.motivo) || null,
      });
      continue;
    }
    cpfDaBase++;
    saida.push([numero, documento, v(col.nome), v(col.ramo), v(col.ramo), v(col.data), v(col.motivo)]);
  }

  if (saida.length < 2) {
    throw AppError.unprocessable(
      `Nenhuma das ${linhas.length} canceladas tem dono conhecido na base (importe antes as emitidas).`,
    );
  }

  const resultado = await importarCarteira(saida, {
    layout: LAYOUT_CANCELADAS,
    arquivo: opcoes.arquivo,
    simular: opcoes.simular,
    ...(opcoes.lote ? { lote: opcoes.lote } : {}),
  });
  const gravadasSemCliente = opcoes.simular
    ? 0
    : await gravarApolicesSemCliente(seguradora.id, semCliente, { lote: resultado.lote, arquivo: opcoes.arquivo });
  return {
    ...resultado,
    tokio: { linhasDoArquivo: linhas.length, cpfDaBase, semCpf, gravadasSemCliente },
  };
}

export interface ResultadoExtratoTokio {
  lote: string;
  arquivo: string;
  layout: string;
  simulacao: boolean;
  entidade: 'comissoes';
  extratos: number;
  periodo: { de: string; ate: string };
  comissaoBruta: number;
  impostos: number;
  liquido: number;
  diferenca: { bruto: number; liquido: number };
  duplicataDe?: string | null;
}

export async function importarExtratoComissaoTokio(
  grade: string[][],
  opcoes: { arquivo: string; simular: boolean },
): Promise<ResultadoExtratoTokio> {
  const layout = await resolverLayout(LAYOUT_COMISSOES, LAYOUTS_FINANCEIRO_POR_CHAVE.get(LAYOUT_COMISSOES), 'financeiro');
  if (layout.seguradoraId === null) throw AppError.unprocessable('A Tokio Marine não está no cadastro de seguradoras (migration 061).');

  const iCab = grade.findIndex((l) => normalizarNomeColuna(l[0] ?? '') === 'data_de_processamento');
  if (iCab < 0) throw AppError.unprocessable('Não reconheci o extrato de comissão da Tokio Marine (falta "Data de Processamento").');
  const c = colunas(grade[iCab]!);
  const col = {
    data: c('data_de_processamento'), extrato: c('extrato'), bruto: c('valor_bruto'), inss: c('inss'),
    irrf: c('irrf'), iss: c('iss'), outros: c('outros_ajustes_sem_impostos'), liquido: c('valor_liquido'),
  };

  const lote = randomUUID();
  const comissoes: comissaoRepo.ComissaoImportada[] = [];
  const rodape = { bruto: NaN, liquido: NaN };
  let soma = { bruto: 0, impostos: 0, liquido: 0 };
  for (const l of grade.slice(iCab + 1)) {
    const rotulo = normalizarNomeColuna(l[0] ?? '');
    // Rodapé: o valor está na última célula preenchida.
    const ultimo = [...l].reverse().find((x) => (x ?? '').trim()) ?? '';
    if (rotulo === 'total_da_comissao_bruta') { rodape.bruto = valor(ultimo); continue; }
    if (rotulo === 'total_comissao_liquida') { rodape.liquido = valor(ultimo); continue; }

    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((l[col.data] ?? '').trim());
    const numero = (l[col.extrato] ?? '').trim();
    if (!m || !/^\d+$/.test(numero)) continue;
    const pagoEm = `${m[3]}-${m[2]}-${m[1]}`;
    const bruto = valor(l[col.bruto]);
    // Os impostos vêm NEGATIVOS no arquivo; em `comissoes.impostos` são o quanto saiu.
    const impostos = Math.abs(valor(l[col.inss])) + Math.abs(valor(l[col.irrf])) + Math.abs(valor(l[col.iss]));
    const outros = valor(l[col.outros]);
    const liquido = valor(l[col.liquido]);
    if (Math.abs(bruto - impostos + outros - liquido) > TOLERANCIA) {
      throw AppError.unprocessable(`Extrato ${numero} (${l[col.data]}): bruto − impostos + ajustes não dá o líquido. Nada foi gravado.`);
    }
    soma = { bruto: soma.bruto + bruto, impostos: soma.impostos + impostos, liquido: soma.liquido + liquido };
    comissoes.push({
      seguradoraId: layout.seguradoraId,
      competencia: pagoEm.slice(0, 7),
      corretora: null,
      filial: null,
      codigoCliente: null,
      // A chave única inclui o estabelecimento e NULL não conta como repetição: sem valor fixo, reimportar duplica.
      codigoEstabelecimento: 'TOKIO',
      numero,
      tipo: 'Extrato de comissão',
      totalBruto: bruto.toFixed(2),
      desconto: outros ? (-outros).toFixed(2) : null,
      impostos: impostos.toFixed(2),
      totalLiquido: liquido.toFixed(2),
      pagoEm,
      formaPagamento: null,
      origemArquivo: opcoes.arquivo,
      origemLote: lote,
    });
  }
  if (comissoes.length === 0) throw AppError.unprocessable('O extrato da Tokio não tem nenhuma linha de comissão.');

  const diferenca = {
    bruto: Number((soma.bruto - rodape.bruto).toFixed(2)),
    liquido: Number((soma.liquido - rodape.liquido).toFixed(2)),
  };
  if (Number.isNaN(diferenca.bruto) || Number.isNaN(diferenca.liquido)) {
    throw AppError.unprocessable('O extrato não traz o rodapé ("Total da Comissão Bruta" e "Total Comissão Líquida") para conferir. Nada foi gravado.');
  }
  if (Math.abs(diferenca.bruto) > TOLERANCIA || Math.abs(diferenca.liquido) > TOLERANCIA) {
    throw AppError.unprocessable(
      `A soma dos ${comissoes.length} extratos não bate com o rodapé (bruto ${diferenca.bruto}, líquido ${diferenca.liquido}). O arquivo pode estar truncado; nada foi gravado.`,
    );
  }

  if (!opcoes.simular) await comissaoRepo.inserirComissoes(comissoes);

  const datas = comissoes.map((x) => x.pagoEm!).sort();
  return {
    lote,
    arquivo: opcoes.arquivo,
    layout: LAYOUT_COMISSOES,
    simulacao: opcoes.simular,
    entidade: 'comissoes',
    extratos: comissoes.length,
    periodo: { de: datas[0]!, ate: datas[datas.length - 1]! },
    comissaoBruta: Number(soma.bruto.toFixed(2)),
    impostos: Number(soma.impostos.toFixed(2)),
    liquido: Number(soma.liquido.toFixed(2)),
    diferenca,
  };
}
