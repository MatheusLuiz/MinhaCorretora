import type { RequestHandler } from 'express';

import * as repo from '../repositories/estornos.repository.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import { AppError } from '../utils/AppError.js';

/** `de`/`ate` em `AAAA-MM` → datas com `ate` EXCLUSIVO e a lista dos meses (máx. 5 anos). */
function periodoDaConsulta(query: Record<string, unknown>): { de: string; ate: string; meses: string[] } {
  const de = typeof query.de === 'string' ? query.de : '';
  const ate = typeof query.ate === 'string' ? query.ate : '';

  const mes = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const a = mes.exec(de);
  if (!a || !mes.test(ate)) throw AppError.unprocessable('Período inválido: use AAAA-MM em "de" e "ate".');
  if (de > ate) throw AppError.unprocessable('O início do período precisa ser antes do fim.');

  const meses: string[] = [];
  let ano = Number(a[1]);
  let m = Number(a[2]);
  while (`${ano}-${String(m).padStart(2, '0')}` <= ate) {
    meses.push(`${ano}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      ano++;
    }
    if (meses.length > 60) throw AppError.unprocessable('Período longo demais: no máximo 5 anos.');
  }

  return { de: `${de}-01`, ate: `${ano}-${String(m).padStart(2, '0')}-01`, meses };
}

/** Estornos e comissão perdida por cancelamento; exige `comissoes.todas` (o demonstrativo não se recorta). */
export const listar: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    if (!escopo.comissoesTodas) throw AppError.forbidden('Estornos da corretora exigem comissoes.todas.');

    const periodo = periodoDaConsulta(req.query);
    const dados = await repo.estornosNoPeriodo(periodo.de, periodo.ate, escopo);

    res.json({ meses: periodo.meses, ...dados });
  } catch (erro) {
    next(erro);
  }
};
