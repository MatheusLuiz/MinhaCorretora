import type { RequestHandler } from 'express';

import * as repo from '../repositories/painelSeguradoras.repository.js';
import * as modeloRepo from '../repositories/modeloRelatorio.repository.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import { LAYOUTS_APOLICES } from '../services/modelosApolices.js';
import { LAYOUTS_CARTEIRA } from '../services/modelosCarteira.js';
import { LAYOUTS_FINANCEIRO } from '../services/modelosFinanceiro.js';

/**
 * Cartões do dashboard de Seguradoras, com o selo de "última carga": o mês de
 * relatório que não chegou não falha em validação nenhuma, só some.
 */

/** 35 e não 30: o portal publica o mês fechado nos primeiros dias do seguinte. */
export const PRAZO_DIAS = 35;

/** Layouts que só conferem: nunca terão carga, não contam como "nunca importado". */
const SO_CONFERENCIA = new Set(['porto-comissao-extrato']);

type Situacao = 'atrasada' | 'nunca' | 'em_dia';

interface LayoutConhecido {
  seguradoraChave: string;
  chave: string;
  nome: string;
  /** Como `arquivos_importados.entidade` grava a carga deste layout. */
  entidade: string;
}

/**
 * Os layouts que cada companhia TEM (para acusar o que nunca subiu). A carteira
 * de portal grava `entidade = 'clientes'`, como em `arquivos_importados`.
 */
async function layoutsConhecidos(): Promise<LayoutConhecido[]> {
  const deCodigo: LayoutConhecido[] = [
    ...LAYOUTS_FINANCEIRO.filter((l) => !l.interno && !SO_CONFERENCIA.has(l.chave)).map((l) => ({
      seguradoraChave: l.seguradoraChave,
      chave: l.chave,
      nome: l.nome,
      entidade: l.entidade,
    })),
    ...LAYOUTS_CARTEIRA.filter((l) => l.seguradoraChave).map((l) => ({
      seguradoraChave: l.seguradoraChave!,
      chave: l.chave,
      nome: l.nome,
      entidade: 'clientes',
    })),
    ...LAYOUTS_APOLICES.map((l) => ({
      seguradoraChave: l.seguradoraChave,
      chave: l.chave,
      nome: l.nome,
      entidade: 'apolices',
    })),
  ];

  // Modelos cadastrados pela tela apontam a companhia por id, não por chave.
  const cadastrados = (await modeloRepo.listar())
    .filter((m) => m.seguradoraId !== null)
    .map((m) => ({
      seguradoraChave: `#${m.seguradoraId}`,
      chave: m.chave,
      nome: m.nome,
      entidade: m.familia === 'financeiro' ? (m.entidade ?? 'financeiro') : m.familia === 'carteira' ? 'clientes' : m.familia,
    }));

  return [...deCodigo, ...cadastrados];
}

interface LinhaFila {
  seguradora: string | null;
  layout: string | null;
  layoutNome: string;
  entidade: string;
  cargas: number;
  desfeitas: number;
  ultima: { em: string; por: string | null; arquivo: string; desfeitaEm: string | null } | null;
  ultimaValida: { em: string; por: string | null } | null;
  diasDesdeValida: number | null;
  situacao: Situacao;
}

const ORDEM_SITUACAO: Record<Situacao, number> = { atrasada: 0, nunca: 1, em_dia: 2 };

/**
 * Cruza o importado com os layouts de cada companhia. "Nunca importado" só para
 * companhia cadastrada e ativa; carga de companhia fora do cadastro continua na lista.
 */
async function montarFila(): Promise<LinhaFila[]> {
  const [cargas, seguradoras, conhecidos] = await Promise.all([
    repo.cargasPorLayout(),
    repo.seguradorasCadastradas(),
    layoutsConhecidos(),
  ]);

  const nomePorChave = new Map<string, string>();
  for (const s of seguradoras) {
    if (!s.ativa) continue;
    if (s.chave) nomePorChave.set(s.chave, s.nome);
    nomePorChave.set(`#${s.id}`, s.nome);
  }
  const nomeDoLayout = new Map(conhecidos.map((l) => [l.chave, l.nome]));

  const situacaoDe = (dias: number | null): Situacao =>
    dias === null ? 'nunca' : dias > PRAZO_DIAS ? 'atrasada' : 'em_dia';

  const linhas: LinhaFila[] = cargas.map((c) => ({
    seguradora: c.seguradora,
    layout: c.layout,
    layoutNome: (c.layout && nomeDoLayout.get(c.layout)) ?? c.layout ?? 'Sem layout (planilha de cadastro)',
    entidade: c.entidade,
    cargas: c.cargas,
    desfeitas: c.desfeitas,
    ultima: { em: c.ultimaEm, por: c.ultimaPor, arquivo: c.ultimaArquivo, desfeitaEm: c.ultimaDesfeitaEm },
    ultimaValida: c.ultimaValidaEm ? { em: c.ultimaValidaEm, por: c.ultimaValidaPor } : null,
    diasDesdeValida: c.diasDesdeValida,
    // Só cargas desfeitas = nada do relatório ficou na base: "nunca", na prática.
    situacao: situacaoDe(c.diasDesdeValida),
  }));

  const jaVistos = new Set(linhas.map((l) => `${l.seguradora ?? ''}|${l.layout ?? ''}`));
  for (const l of conhecidos) {
    const seguradora = nomePorChave.get(l.seguradoraChave);
    if (!seguradora || jaVistos.has(`${seguradora}|${l.chave}`)) continue;
    jaVistos.add(`${seguradora}|${l.chave}`);
    linhas.push({
      seguradora,
      layout: l.chave,
      layoutNome: l.nome,
      entidade: l.entidade,
      cargas: 0,
      desfeitas: 0,
      ultima: null,
      ultimaValida: null,
      diasDesdeValida: null,
      situacao: 'nunca',
    });
  }

  // Atrasadas primeiro, a mais velha no topo; depois as nunca importadas.
  return linhas.sort(
    (a, b) =>
      ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao] ||
      (b.diasDesdeValida ?? 0) - (a.diasDesdeValida ?? 0) ||
      (a.seguradora ?? '').localeCompare(b.seguradora ?? '', 'pt-BR') ||
      a.layoutNome.localeCompare(b.layoutNome, 'pt-BR'),
  );
}

const redondo = (n: number): number => Math.round(n * 100) / 100;

/**
 * Um cartão por seguradora. A comissão (da corretora, sem cliente por linha) só vai
 * para `comissoes.todas`; para os outros a chave some, porque zero se leria como "nada".
 */
export const resumo: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    const [seguradoras, carteira, fila, comissoes] = await Promise.all([
      repo.seguradorasCadastradas(),
      repo.carteiraPorSeguradora(escopo),
      montarFila(),
      escopo.comissoesTodas ? repo.comissaoRecebidaPorSeguradora() : Promise.resolve(null),
    ]);

    const carteiraPorId = new Map(carteira.map((c) => [c.seguradoraId, c]));
    const comissaoPorId = new Map((comissoes ?? []).map((c) => [c.seguradoraId, c]));

    const premioTotal = redondo(carteira.reduce((t, c) => t + (c.premioEmVigor ?? 0), 0));
    const emVigorTotal = carteira.reduce((t, c) => t + c.emVigor, 0);
    // Fatia por prêmio quando há prêmio; senão por apólice (relatório sem prêmio daria 0%).
    const basePercentual: 'premio' | 'apolices' = premioTotal > 0 ? 'premio' : 'apolices';

    const cartoes = seguradoras
      .filter((s) => s.ativa || carteiraPorId.has(s.id))
      .map((s) => {
        const c = carteiraPorId.get(s.id);
        const doFila = fila.filter((l) => l.seguradora === s.nome);
        const validas = doFila.filter((l) => l.diasDesdeValida !== null);
        const diasUltima = validas.length ? Math.min(...validas.map((l) => l.diasDesdeValida!)) : null;
        const ultimaEm = validas.map((l) => l.ultimaValida!.em).sort().at(-1) ?? null;
        const atrasados = doFila.filter((l) => l.situacao === 'atrasada').length;
        const nunca = doFila.filter((l) => l.situacao === 'nunca').length;
        const premio = c?.premioEmVigor ?? null;
        const emVigor = c?.emVigor ?? 0;
        const percentual =
          basePercentual === 'premio'
            ? premioTotal > 0 ? redondo(((premio ?? 0) / premioTotal) * 100) : 0
            : emVigorTotal > 0 ? redondo((emVigor / emVigorTotal) * 100) : 0;
        const com = comissaoPorId.get(s.id);

        return {
          nome: s.nome,
          chave: s.chave,
          ativa: s.ativa,
          apolices: c?.apolices ?? 0,
          emVigor,
          clientesEmVigor: c?.clientesEmVigor ?? 0,
          premioEmVigor: premio === null ? null : redondo(premio),
          percentualCarteira: percentual,
          ...(comissoes
            ? { comissao: { mes: redondo(com?.liquidoMes ?? 0), ano: redondo(com?.liquidoAno ?? 0) } }
            : {}),
          ultimaCarga: ultimaEm ? { em: ultimaEm, dias: diasUltima! } : null,
          // "Em dia" só quando NENHUM relatório da companhia passou do prazo.
          situacaoCargas: (validas.length === 0 ? 'nunca' : atrasados > 0 ? 'atrasada' : 'em_dia') as Situacao,
          relatoriosAtrasados: atrasados,
          relatoriosNuncaImportados: nunca,
          relatorios: doFila.length,
        };
      })
      .sort((a, b) => (b.premioEmVigor ?? 0) - (a.premioEmVigor ?? 0) || b.emVigor - a.emVigor);

    res.json({
      prazoDias: PRAZO_DIAS,
      basePercentual,
      premioEmVigorTotal: premioTotal,
      emVigorTotal,
      comissaoVisivel: comissoes !== null,
      seguradoras: cartoes,
    });
  } catch (erro) {
    next(erro);
  }
};
