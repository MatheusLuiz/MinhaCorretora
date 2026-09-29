import * as repo from '../repositories/conciliacao.repository.js';
import type { OrdemGravada, ReciboConciliacao } from '../repositories/conciliacao.repository.js';

// Recibos × extrato da companhia, por seguradora e mês de pagamento.
// Compara pelo BRUTO: o líquido depende de retenção, que nem todo extrato separa.
// `sem_recebimento` = mês sem recibo ENTRE meses que tiveram (relatório não importado).

export type SituacaoCelula = 'conferido' | 'divergente' | 'sem_extrato' | 'sem_recebimento';
export type SituacaoOrdem = 'conferida' | 'faltando' | 'sobrando' | 'divergente' | 'sem_extrato';

export interface LinhaOrdem {
  ordem: string;
  situacao: SituacaoOrdem;
  recibo: {
    numero: string;
    mes: string;
    pagoEm: string | null;
    bruto: number;
    impostos: number;
    liquido: number;
    itens: number;
    somaItens: number;
  } | null;
  extrato: {
    pagoEm: string | null;
    bruto: number;
    liquido: number | null;
    inss: number | null;
    irrf: number | null;
    iss: number | null;
  } | null;
  /** Extrato − recibo, no bruto. Só quando há os dois. */
  diferenca: number | null;
}

export interface CelulaConciliacao {
  seguradoraId: number;
  seguradora: string;
  mes: string;
  situacao: SituacaoCelula;
  recibos: { qtde: number; bruto: number; impostos: number; desconto: number; liquido: number };
  /** Nulo quando a companhia não tem relatório de detalhe nenhum (não é "zero itens"). */
  detalhe: { itens: number; somaItens: number; creditosComDetalhe: number } | null;
  /** Nulo quando não há extrato gravado no mês. */
  extrato: { ordens: number; bruto: number; liquido: number } | null;
  pendencias: { faltando: string[]; sobrando: string[]; divergentes: string[] };
}

const centavos = (n: number): number => Math.round(n * 100) / 100;

/** Só dígitos, como a conferência grava a ordem; sem dígito nenhum, não casa. */
const chave = (numero: string): string => numero.replace(/\D/g, '') || `#${numero}`;

/** Meses `AAAA-MM` de `de` a `ate`, inclusivo. */
export function mesesEntre(de: string, ate: string): string[] {
  const meses: string[] = [];
  let [ano, mes] = de.split('-').map(Number) as [number, number];
  for (let m = `${de}`; m <= ate; ) {
    meses.push(m);
    if (++mes > 12) {
      mes = 1;
      ano++;
    }
    m = `${ano}-${String(mes).padStart(2, '0')}`;
  }
  return meses;
}

// Usado pela grade E pela gaveta. Recibos/ordens de outros meses entram na busca:
// a ordem de setembro pode ter recibo datado de 31/08.
function compararMes(
  recibosDoMes: ReciboConciliacao[],
  ordensDoMes: OrdemGravada[],
  recibosDaCia: ReciboConciliacao[],
  ordensDaCia: OrdemGravada[],
): LinhaOrdem[] {
  const paraRecibo = (r: ReciboConciliacao): LinhaOrdem['recibo'] => ({
    numero: r.numero,
    mes: r.mes,
    pagoEm: r.pagoEm,
    bruto: r.bruto,
    impostos: r.impostos,
    liquido: r.liquido,
    itens: r.itens,
    somaItens: centavos(r.somaItens),
  });

  if (ordensDoMes.length === 0) {
    return recibosDoMes.map((r) => ({
      ordem: r.numero,
      situacao: 'sem_extrato',
      recibo: paraRecibo(r),
      extrato: null,
      diferenca: null,
    }));
  }

  const reciboPorChave = new Map(recibosDaCia.map((r) => [chave(r.numero), r]));
  const ordensConhecidas = new Set(ordensDaCia.map((o) => chave(o.numero)));
  const linhas: LinhaOrdem[] = [];

  for (const o of ordensDoMes) {
    const r = reciboPorChave.get(chave(o.numero));
    const extrato = { pagoEm: o.pagoEm, bruto: o.bruto, liquido: o.liquido, inss: o.inss, irrf: o.irrf, iss: o.iss };
    if (!r) {
      linhas.push({ ordem: o.numero, situacao: 'faltando', recibo: null, extrato, diferenca: null });
      continue;
    }
    const diferenca = centavos(o.bruto - r.bruto);
    linhas.push({
      ordem: o.numero,
      situacao: Math.abs(diferenca) > 0.005 ? 'divergente' : 'conferida',
      recibo: paraRecibo(r),
      extrato,
      diferenca,
    });
  }

  // Ordem no extrato de outro mês fecha a conta lá — não é sobra.
  for (const r of recibosDoMes) {
    if (!ordensConhecidas.has(chave(r.numero))) {
      linhas.push({ ordem: r.numero, situacao: 'sobrando', recibo: paraRecibo(r), extrato: null, diferenca: null });
    }
  }

  return linhas;
}

function resumirCelula(
  seguradoraId: number,
  seguradora: string,
  mes: string,
  recibosDoMes: ReciboConciliacao[],
  ordensDoMes: OrdemGravada[],
  linhas: LinhaOrdem[],
  temDetalhe: boolean,
): CelulaConciliacao {
  const soma = (xs: ReciboConciliacao[], campo: 'bruto' | 'impostos' | 'desconto' | 'liquido'): number =>
    centavos(xs.reduce((t, r) => t + r[campo], 0));

  const pendencias = {
    faltando: linhas.filter((l) => l.situacao === 'faltando').map((l) => l.ordem),
    sobrando: linhas.filter((l) => l.situacao === 'sobrando').map((l) => l.ordem),
    divergentes: linhas.filter((l) => l.situacao === 'divergente').map((l) => l.ordem),
  };
  const algoNaoBate = pendencias.faltando.length + pendencias.sobrando.length + pendencias.divergentes.length > 0;

  return {
    seguradoraId,
    seguradora,
    mes,
    situacao:
      ordensDoMes.length > 0
        ? algoNaoBate
          ? 'divergente'
          : 'conferido'
        : recibosDoMes.length > 0
          ? 'sem_extrato'
          : 'sem_recebimento',
    recibos: {
      qtde: recibosDoMes.length,
      bruto: soma(recibosDoMes, 'bruto'),
      impostos: soma(recibosDoMes, 'impostos'),
      desconto: soma(recibosDoMes, 'desconto'),
      liquido: soma(recibosDoMes, 'liquido'),
    },
    detalhe: temDetalhe
      ? {
          itens: recibosDoMes.reduce((t, r) => t + r.itens, 0),
          somaItens: centavos(recibosDoMes.reduce((t, r) => t + r.somaItens, 0)),
          creditosComDetalhe: recibosDoMes.filter((r) => r.itens > 0).length,
        }
      : null,
    extrato:
      ordensDoMes.length > 0
        ? {
            ordens: ordensDoMes.length,
            bruto: centavos(ordensDoMes.reduce((t, o) => t + o.bruto, 0)),
            liquido: centavos(ordensDoMes.reduce((t, o) => t + (o.liquido ?? 0), 0)),
          }
        : null,
    pendencias,
  };
}

interface Companhia {
  id: number;
  nome: string;
  temDetalhe: boolean;
  temExtrato: boolean;
  primeiro: string | null;
  ultimo: string | null;
}

/** Quem entra na grade: toda companhia com recibo OU com extrato gravado. */
async function companhias(ordens: OrdemGravada[]): Promise<Companhia[]> {
  const faixa = await repo.faixaDeRecebimento();
  const lista = new Map<number, Companhia>();
  for (const f of faixa) {
    lista.set(f.seguradoraId, {
      id: f.seguradoraId,
      nome: f.seguradora,
      temDetalhe: f.temDetalhe,
      temExtrato: false,
      primeiro: f.primeiro,
      ultimo: f.ultimo,
    });
  }
  for (const o of ordens) {
    const c = lista.get(o.seguradoraId);
    if (c) c.temExtrato = true;
    else
      lista.set(o.seguradoraId, {
        id: o.seguradoraId,
        nome: o.seguradora,
        temDetalhe: false,
        temExtrato: true,
        primeiro: null,
        ultimo: null,
      });
  }
  return [...lista.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export async function conciliar(de: string, ate: string): Promise<{
  meses: string[];
  seguradoras: { id: number; nome: string; temDetalhe: boolean; temExtrato: boolean }[];
  celulas: CelulaConciliacao[];
  contagem: Record<SituacaoCelula, number>;
}> {
  const [recibos, ordens] = await Promise.all([repo.recibosNoPeriodo(de, ate), repo.ordensGravadas()]);
  const cias = await companhias(ordens);
  const meses = mesesEntre(de, ate);

  const recibosDaCia = new Map<number, ReciboConciliacao[]>();
  for (const c of cias.filter((x) => x.temExtrato)) recibosDaCia.set(c.id, await repo.recibosDaSeguradora(c.id));

  const celulas: CelulaConciliacao[] = [];
  for (const c of cias) {
    const ordensDaCia = ordens.filter((o) => o.seguradoraId === c.id);
    for (const mes of meses) {
      const rMes = recibos.filter((r) => r.seguradoraId === c.id && r.mes === mes);
      const oMes = ordensDaCia.filter((o) => o.mes === mes);
      const noMeio = c.primeiro !== null && c.ultimo !== null && mes > c.primeiro && mes < c.ultimo;
      // Fora da faixa de recibos, a ausência não diz nada.
      if (rMes.length === 0 && oMes.length === 0 && !noMeio) continue;

      const linhas = compararMes(rMes, oMes, recibosDaCia.get(c.id) ?? rMes, ordensDaCia);
      celulas.push(resumirCelula(c.id, c.nome, mes, rMes, oMes, linhas, c.temDetalhe));
    }
  }

  const contagem: Record<SituacaoCelula, number> = { conferido: 0, divergente: 0, sem_extrato: 0, sem_recebimento: 0 };
  for (const cel of celulas) contagem[cel.situacao]++;

  return {
    meses,
    seguradoras: cias.map(({ id, nome, temDetalhe, temExtrato }) => ({ id, nome, temDetalhe, temExtrato })),
    celulas,
    contagem,
  };
}

/** A gaveta: ordem a ordem, recibo × extrato, com o mesmo núcleo da grade. */
export async function ordensDoMes(
  seguradoraId: number,
  mes: string,
): Promise<{ celula: CelulaConciliacao | null; linhas: LinhaOrdem[] }> {
  const [recibosDaCia, ordensDaCia] = await Promise.all([
    repo.recibosDaSeguradora(seguradoraId),
    repo.ordensGravadas(seguradoraId),
  ]);
  const rMes = recibosDaCia.filter((r) => r.mes === mes);
  const oMes = ordensDaCia.filter((o) => o.mes === mes);
  const linhas = compararMes(rMes, oMes, recibosDaCia, ordensDaCia);

  const nome = rMes[0]?.seguradora ?? oMes[0]?.seguradora ?? recibosDaCia[0]?.seguradora ?? ordensDaCia[0]?.seguradora;
  if (!nome) return { celula: null, linhas };

  const temDetalhe = recibosDaCia.some((r) => r.itens > 0);
  return { celula: resumirCelula(seguradoraId, nome, mes, rMes, oMes, linhas, temDetalhe), linhas };
}
