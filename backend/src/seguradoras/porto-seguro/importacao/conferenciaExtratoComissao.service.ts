import { AppError } from '../../../utils/AppError.js';
import * as conciliacaoRepo from '../../../repositories/conciliacao.repository.js';
import * as financeiroRepo from '../../../repositories/financeiro.repository.js';
import * as seguradoraRepo from '../../../repositories/seguradora.repository.js';
import { repararMojibake } from '../../../utils/texto.js';

/**
 * Confere o extrato de pagamentos da Porto (uma linha por ordem, sem apólice) contra os analíticos
 * importados — acusa a ordem cujo analítico não foi baixado. Não grava em `comissoes`: guarda as
 * ordens em `extratos_comissao` para a Conciliação.
 */

export interface LinhaExtrato {
  ordem: string;
  pagoEm: string | null;
  bruto: number;
  liquido: number;
}

interface LinhaLida extends LinhaExtrato {
  inss: number | null;
  irrf: number | null;
  iss: number | null;
}

export interface OpcoesConferencia {
  simular: boolean;
  lote: string;
  arquivo: string;
}

export interface ResultadoConferencia {
  layout: string;
  competencias: string[];

  ordensNoExtrato: number;
  conferidas: number;

  /** No extrato e não no sistema: faltam importar. */
  faltando: LinhaExtrato[];
  divergentes: { ordem: string; extrato: number; sistema: number; diferenca: number }[];
  /** No sistema e não no extrato: normal quando o extrato é de um mês só. */
  sobrando: { ordem: string; competencia: string; bruto: number }[];

  totalExtrato: { bruto: number; liquido: number };
  totalSistema: { bruto: number; liquido: number };
  diferencaBruta: number;

  lote: string | null;
  simulacao: boolean;
  /** Nulo em simulação ou sem a companhia cadastrada. */
  gravacao: { seguradora: string; inseridas: number; atualizadas: number } | null;
  avisoGravacao: string | null;
}

/** Por NOME: os botões do portal viram colunas de lixo no meio da exportação. */
const COLUNAS = {
  ordem: /ordem\s*de\s*pagamento/i,
  pagoEm: /data\s*(de\s*)?pagamento/i,
  bruto: /^bruto$/i,
  liquido: /^l[ií]quido$/i,
  // Retenções opcionais: sem elas a Conciliação usa bruto − líquido.
  inss: /^inss$/i,
  irrf: /^irr?f$/i,
  iss: /^iss(qn)?$/i,
} satisfies Record<string, RegExp>;

const texto = (v: string | undefined): string => repararMojibake((v ?? '').trim());

function decimal(v: string | undefined): number {
  const limpo = texto(v).replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

function data(v: string | undefined): string | null {
  const t = texto(v);
  const br = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export async function conferirExtrato(
  grade: string[][],
  opcoes: OpcoesConferencia,
): Promise<ResultadoConferencia> {
  // Há linhas de título antes da tabela, e o cabeçalho tem duas alturas ("Valores" é colspan).
  let indiceCabecalho = -1;
  for (let i = 0; i < Math.min(grade.length, 30); i++) {
    if ((grade[i] ?? []).some((c) => COLUNAS.ordem.test(texto(c)))) {
      indiceCabecalho = i;
      break;
    }
  }

  if (indiceCabecalho < 0) {
    throw AppError.unprocessable(
      'Não encontrei a coluna "Ordem de Pagamento". Confira se o arquivo é o EXTRATO de pagamentos da Porto — o que lista uma linha por ordem, e não o analítico de uma ordem só.',
    );
  }

  const cabecalho = (grade[indiceCabecalho] ?? []).map(texto);
  const col: Record<string, number> = {};
  for (const [campo, padrao] of Object.entries(COLUNAS)) {
    col[campo] = cabecalho.findIndex((c) => padrao.test(c));
  }

  const segunda = (grade[indiceCabecalho + 1] ?? []).map(texto);
  for (const campo of ['bruto', 'liquido', 'inss', 'irrf', 'iss'] as const) {
    if (col[campo]! < 0) col[campo] = segunda.findIndex((c) => COLUNAS[campo].test(c));
  }

  if (col.ordem! < 0 || col.bruto! < 0) {
    throw AppError.unprocessable(
      'O arquivo tem "Ordem de Pagamento" mas não achei as colunas de valor (Bruto/Líquido). Exporte o extrato pelo botão "Gerar planilha no formato XLS" do portal.',
    );
  }

  const linhas: LinhaLida[] = [];
  // Coluna ausente = nulo (o extrato não informa), nunca zero (informou zero).
  const opcional = (l: string[], i: number): number | null => (i >= 0 ? decimal(l[i]) : null);

  for (const l of grade.slice(indiceCabecalho + 1)) {
    const ordem = texto(l[col.ordem!]).replace(/\D/g, '');
    // A linha "Total" não tem número de ordem.
    if (!ordem) continue;

    const bruto = decimal(l[col.bruto!]);
    const liquido = col.liquido! >= 0 ? decimal(l[col.liquido!]) : 0;
    if (bruto === 0 && liquido === 0) continue;

    linhas.push({
      ordem,
      pagoEm: col.pagoEm! >= 0 ? data(l[col.pagoEm!]) : null,
      bruto,
      liquido,
      inss: opcional(l, col.inss!),
      irrf: opcional(l, col.irrf!),
      iss: opcional(l, col.iss!),
    });
  }

  if (linhas.length === 0) {
    throw AppError.unprocessable(
      'Nenhuma ordem de pagamento foi reconhecida no extrato. Nada foi conferido.',
    );
  }

  const competencias = [
    ...new Set(linhas.map((l) => l.pagoEm?.slice(0, 7)).filter((c): c is string => Boolean(c))),
  ].sort();

  const noSistema = await financeiroRepo.comissoesPorOrdem(
    linhas.map((l) => l.ordem),
    competencias,
  );

  const faltando: LinhaExtrato[] = [];
  const divergentes: ResultadoConferencia['divergentes'] = [];
  let conferidas = 0;

  for (const l of linhas) {
    const achada = noSistema.porOrdem.get(l.ordem);
    if (!achada) {
      faltando.push(l);
      continue;
    }

    const diferenca = Number((l.bruto - achada.bruto).toFixed(2));
    if (Math.abs(diferenca) > 0.01) {
      divergentes.push({ ordem: l.ordem, extrato: l.bruto, sistema: achada.bruto, diferenca });
    } else {
      conferidas++;
    }
  }

  const noExtrato = new Set(linhas.map((l) => l.ordem));
  const sobrando = noSistema.daCompetencia
    .filter((c) => !noExtrato.has(c.ordem))
    .map((c) => ({ ordem: c.ordem, competencia: c.competencia, bruto: c.bruto }));

  const totalExtrato = {
    bruto: Number(linhas.reduce((s, l) => s + l.bruto, 0).toFixed(2)),
    liquido: Number(linhas.reduce((s, l) => s + l.liquido, 0).toFixed(2)),
  };
  const totalSistema = {
    bruto: Number(noSistema.daCompetencia.reduce((s, c) => s + c.bruto, 0).toFixed(2)),
    liquido: Number(noSistema.daCompetencia.reduce((s, c) => s + c.liquido, 0).toFixed(2)),
  };

  // Sem a Porto cadastrada a conferência ainda vale; só não se guarda.
  let gravacao: ResultadoConferencia['gravacao'] = null;
  let avisoGravacao: string | null = null;

  if (!opcoes.simular) {
    const seguradora = await seguradoraRepo.porChave('porto-seguro');
    if (!seguradora) {
      avisoGravacao =
        'A Porto Seguro não está cadastrada em Seguradoras: a conferência foi feita, mas o extrato não foi guardado para a Conciliação.';
    } else {
      const r = await conciliacaoRepo.gravarExtrato(seguradora.id, linhas, opcoes.lote, opcoes.arquivo);
      gravacao = { seguradora: seguradora.nome, ...r };
    }
  }

  return {
    layout: 'porto-comissao-extrato',
    lote: gravacao ? opcoes.lote : null,
    simulacao: opcoes.simular,
    gravacao,
    avisoGravacao,
    competencias,
    ordensNoExtrato: linhas.length,
    conferidas,
    faltando,
    divergentes,
    sobrando,
    totalExtrato,
    totalSistema,
    diferencaBruta: Number((totalExtrato.bruto - totalSistema.bruto).toFixed(2)),
  };
}
