import type { Request, RequestHandler } from 'express';

import * as repo from '../repositories/conciliacao.repository.js';
import { conciliar, mesesEntre, ordensDoMes } from '../services/conciliacao.service.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import { AppError } from '../utils/AppError.js';
import { gerarXlsx } from '../utils/xlsxEscrita.js';

// Conciliação: dinheiro da CORRETORA, sem recorte por carteira — exige `comissoes.todas`.

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

async function exigirComissoesTodas(req: Request): Promise<void> {
  const escopo = await escopoDaRequisicao(req);
  if (!escopo.comissoesTodas) throw AppError.forbidden('Comissão da corretora exige comissoes.todas.');
}

/** `de`/`ate` em AAAA-MM, no máximo 5 anos — o mesmo teto da tela de Comissões. */
function periodo(query: Record<string, unknown>): { de: string; ate: string } {
  const de = typeof query.de === 'string' ? query.de : '';
  const ate = typeof query.ate === 'string' ? query.ate : '';
  if (!MES.test(de) || !MES.test(ate)) throw AppError.unprocessable('Período inválido: use AAAA-MM em "de" e "ate".');
  if (de > ate) throw AppError.unprocessable('O início do período precisa ser antes do fim.');
  if (mesesEntre(de, ate).length > 60) throw AppError.unprocessable('Período longo demais: no máximo 5 anos.');
  return { de, ate };
}

export const grade: RequestHandler = async (req, res, next) => {
  try {
    await exigirComissoesTodas(req);
    const { de, ate } = periodo(req.query);
    res.json(await conciliar(de, ate));
  } catch (erro) {
    next(erro);
  }
};

export const ordens: RequestHandler = async (req, res, next) => {
  try {
    await exigirComissoesTodas(req);
    const seguradoraId = Number(req.query.seguradora);
    const mes = typeof req.query.mes === 'string' ? req.query.mes : '';
    if (!Number.isInteger(seguradoraId) || seguradoraId <= 0) throw AppError.unprocessable('Informe a seguradora.');
    if (!MES.test(mes)) throw AppError.unprocessable('Mês inválido: use AAAA-MM.');
    res.json(await ordensDoMes(seguradoraId, mes));
  } catch (erro) {
    next(erro);
  }
};

/** Impostos do recibo com a separação INSS/IRRF/ISS do extrato AO LADO — nunca somada (é o mesmo imposto). */
async function linhasDeRetencao(de: string, ate: string) {
  const [linhas, doExtrato] = await Promise.all([repo.retencoes(de, ate), repo.impostosDoExtrato(de, ate)]);
  const separacao = new Map(doExtrato.map((e) => [`${e.mes}|${e.seguradora}`, e]));
  return linhas.map((l) => {
    const e = separacao.get(`${l.mes}|${l.seguradora}`);
    return { ...l, inss: e?.inss ?? null, irrf: e?.irrf ?? null, iss: e?.iss ?? null };
  });
}

export const retencoes: RequestHandler = async (req, res, next) => {
  try {
    await exigirComissoesTodas(req);
    const { de, ate } = periodo(req.query);
    const linhas = await linhasDeRetencao(de, ate);
    res.json({
      linhas,
      // Só o extrato da Porto separa IR, ISS e INSS.
      separacaoDisponivel: linhas.some((l) => l.inss !== null || l.irrf !== null || l.iss !== null),
      impostosCalculados: linhas.reduce((t, l) => t + l.impostosCalculados, 0),
    });
  } catch (erro) {
    next(erro);
  }
};

/** Dinheiro como texto pt-BR com centavo: a planilha grava célula de texto, de propósito. */
const reais = (n: number | null): string =>
  n === null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `.xlsx`, nunca CSV: o Excel estraga número e data do CSV ao abrir. */
export const retencoesXlsx: RequestHandler = async (req, res, next) => {
  try {
    await exigirComissoesTodas(req);
    const { de, ate } = periodo(req.query);
    const linhas = await linhasDeRetencao(de, ate);

    const grade: string[][] = [
      ['Mês', 'Seguradora', 'Recibos', 'Bruto', 'Desconto', 'Impostos', 'INSS (extrato)', 'IRRF (extrato)', 'ISS (extrato)', 'Líquido', 'Impostos calculados'],
      ...linhas.map((l) => [
        `${l.mes.slice(5, 7)}/${l.mes.slice(0, 4)}`,
        l.seguradora,
        String(l.recibos),
        reais(l.bruto),
        reais(l.desconto),
        reais(l.impostos),
        reais(l.inss),
        reais(l.irrf),
        reais(l.iss),
        reais(l.liquido),
        // Recibos sem a coluna de impostos, cujo valor é bruto − desconto − líquido.
        l.impostosCalculados > 0 ? String(l.impostosCalculados) : '',
      ]),
    ];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="retencoes_${de}_a_${ate}.xlsx"`);
    res.send(gerarXlsx(grade, 'Retenções'));
  } catch (erro) {
    next(erro);
  }
};
