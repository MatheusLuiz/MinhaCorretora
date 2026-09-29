import type { RequestHandler } from 'express';

import * as detalheRepo from '../repositories/detalhe.repository.js';
import * as repo from '../repositories/painel.repository.js';
import * as encerradaRepo from '../repositories/encerrada.repository.js';
import * as cancelamentoRepo from '../repositories/cancelamento.repository.js';
import * as comparativoRepo from '../repositories/comparativo.repository.js';
import { AppError } from '../utils/AppError.js';
import * as financeiroRepo from '../repositories/financeiro.repository.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import { usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import * as renovacaoRepo from '../repositories/renovacao.repository.js';
import { detalheSchema } from '../schemas/detalhe.schema.js';
import { consultoresDoFiltro, escopoDaRequisicao } from '../services/escopo.js';

/** Um endpoint para todos os painéis, para que dois painéis nunca discordem do mesmo número. */
export const carregar: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    const usuario = usuarioDaRequisicao(req);
    const veAtraso = usuario.permissoes.includes('inadimplencia.ler');

    // O mês corrente, em meses inteiros (`ate` exclusivo), como na tela de Comissões.
    const hoje = new Date();
    const mes = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const inicioMes = mes(hoje);
    const inicioProximo = mes(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1));

    const [dados, renovacoesSeguradora, encerradasSeguradora, visaoGeralPadrao, atraso, comissaoDoMes] = await Promise.all([
      repo.carregar(escopo),
      // Lista de renovação da SEGURADORA: apólices que a base ainda não tem.
      renovacaoRepo.listarAVencer(escopo),
      encerradaRepo.listar(escopo),
      usuarioRepo.visaoGeralDoPapel(usuario.id),
      veAtraso ? financeiroRepo.resumo(escopo) : Promise.resolve(null),
      // A mesma consulta da tela de Comissões, para o número bater com ela.
      escopo.comissoesTodas ? financeiroRepo.comissaoNoPeriodo(inicioMes, inicioProximo, escopo) : Promise.resolve(null),
    ]);

    const soma = (xs: { valor: number }[]): number =>
      Math.round(xs.reduce((t, x) => t + x.valor, 0) * 100) / 100;

    // `receita` (demonstrativo, sem cliente) não tem recorte possível: zerada sem `comissoesTodas`.
    // `comissaoCarteira` é por apólice e já vem filtrada pela carteira.
    const receita = escopo.comissoesTodas
      ? dados.receita
      : { competencias: [], bruto: 0, impostos: 0, liquido: 0,
          porFilial: [], porCompetencia: [], porSeguradora: [] };

    res.json({
      ...dados,
      receita,
      renovacoesSeguradora,
      encerradasSeguradora,
      visaoGeralPadrao,
      comissaoMes: comissaoDoMes
        ? {
            recebido: soma(comissaoDoMes.recebido.map((r) => ({ valor: r.liquido }))),
            aReceber: soma(
              comissaoDoMes.pendente.filter((p) => p.situacao === 'aberto').map((p) => ({ valor: p.comissao })),
            ),
            emAtraso: soma(
              [...comissaoDoMes.pendente.filter((p) => p.situacao === 'atraso'), ...comissaoDoMes.atrasoAnterior].map(
                (p) => ({ valor: p.comissao }),
              ),
            ),
          }
        : null,
      inadimplencia: atraso
        ? {
            valorEmAtraso: atraso.valorEmAtraso,
            parcelasAtrasadas: atraso.parcelasAtrasadas,
            clientesInadimplentes: atraso.clientesInadimplentes,
            parcelasAtrasoGrave: atraso.parcelasAtrasoGrave,
            valorAtrasoGrave: atraso.valorAtrasoGrave,
          }
        : null,
      disponivel: {
        ...dados.disponivel,
        receita: escopo.comissoesTodas && dados.disponivel.receita,
        serieReceita: escopo.comissoesTodas && dados.disponivel.serieReceita,
        receitaPorFilial: escopo.comissoesTodas && dados.disponivel.receitaPorFilial,
      },
      recorte: {
        carteiraPropria: escopo.produtorIds !== null,
        semCarteira: escopo.produtorIds !== null && escopo.produtorIds.length === 0,
        comissoesTodas: escopo.comissoesTodas,
      },
    });
  } catch (erro) {
    next(erro);
  }
};

/** `AAAA-MM` somado de `n` meses. */
function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Último dia do mês, ou o dia pedido se o mês for mais curto (29/02). */
function diaNoMes(mes: string, dia: number): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

/**
 * Mês escolhido × mesmo mês do ano anterior (em andamento: cortado no mesmo dia).
 * Período que a base não cobre volta `null` com o motivo — nunca um zero que pareça queda.
 */
export const comparativo: RequestHandler = async (req, res, next) => {
  try {
    const agora = new Date(Date.now() - 3 * 3600_000); // Brasília
    const mesCorrente = agora.toISOString().slice(0, 7);
    const pedido = String(req.query.mes ?? '');
    if (pedido && !/^\d{4}-(0[1-9]|1[0-2])$/.test(pedido)) throw AppError.badRequest('Mês inválido: use AAAA-MM.');
    const mes = pedido && pedido <= mesCorrente ? pedido : mesCorrente;
    const anterior = somarMeses(mes, -12);
    const emAndamento = mes === mesCorrente;
    const dia = emAndamento ? agora.getUTCDate() : 31;
    const periodo = (m: string) => ({ de: `${m}-01`, ate: diaNoMes(m, dia) });

    const escopo = await escopoDaRequisicao(req);
    const cobertura = await comparativoRepo.coberturaDesde();
    const coberto = (desdeMes: string): boolean => cobertura !== null && desdeMes >= cobertura;
    const falta = (m: string) => `a base começa em ${cobertura ?? '—'}; falta histórico de ${m}`;

    // Cobertura exigida: renovadas = o mês; vencidas = 12 meses antes; carteira ativa = 11 meses antes.
    const lado = async <T,>(precisaDesde: string, f: () => Promise<T>) =>
      coberto(precisaDesde) ? { valor: await f(), motivo: null } : { valor: null, motivo: falta(precisaDesde) };

    const montar = async (m: string) => ({
      renovadas: await lado(m, () => comparativoRepo.renovadas(escopo, periodo(m))),
      vencidas: await lado(somarMeses(m, -12), () => comparativoRepo.vencidasERenovadas(escopo, periodo(m))),
      // O cadastro tem cobertura própria (desde ago/2024), maior que a das apólices.
      novosClientes:
        m >= comparativoRepo.CADASTRO_COMPLETO_DESDE
          ? { valor: await comparativoRepo.novosClientes(escopo, periodo(m)), motivo: null }
          : { valor: null, motivo: `o cadastro completo começa em ${comparativoRepo.CADASTRO_COMPLETO_DESDE}` },
      carteiraAtiva: await lado(somarMeses(m, -11), () => comparativoRepo.carteiraAtivaEm(escopo, periodo(m).ate)),
    });

    res.json({
      mes,
      anterior,
      emAndamento,
      ateDia: emAndamento ? dia : null,
      coberturaDesde: cobertura,
      atual: await montar(mes),
      anoPassado: await montar(anterior),
    });
  } catch (erro) {
    next(erro);
  }
};

/**
 * Clientes com apólice cancelada nos últimos 1–4 meses FECHADOS (a Porto só dá o mês).
 * Cada janela é contada de novo (clientes distintos), nunca somada dos meses.
 */
export const cancelamentos: RequestHandler = async (req, res, next) => {
  try {
    const mesCorrente = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7); // Brasília
    const ultimoFechado = somarMeses(mesCorrente, -1);
    const escopo = await escopoDaRequisicao(req);

    const janelas = await Promise.all(
      [1, 2, 3, 4].map(async (meses) => {
        const de = somarMeses(ultimoFechado, -(meses - 1));
        return { meses, de, ate: ultimoFechado, ...(await cancelamentoRepo.entre(escopo, de, ultimoFechado)) };
      }),
    );
    const [mesAtual, porMes, porSeguradora, semData] = await Promise.all([
      cancelamentoRepo.entre(escopo, mesCorrente, mesCorrente),
      cancelamentoRepo.porMes(escopo, somarMeses(mesCorrente, -11), mesCorrente),
      cancelamentoRepo.porSeguradora(escopo, somarMeses(ultimoFechado, -3), ultimoFechado),
      cancelamentoRepo.semData(escopo),
    ]);

    res.json({
      mesCorrente,
      ultimoFechado,
      janelas,
      mesAtual: { mes: mesCorrente, ...mesAtual },
      porMes,
      porSeguradora,
      semData,
    });
  } catch (erro) {
    next(erro);
  }
};

/** Os consultores que o usuário pode escolher no filtro (Renovações). */
export const consultores: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      consultores: await consultoresDoFiltro(req),
      // A opção vazia não alarga nada para quem tem carteira restrita.
      baseInteira: usuarioDaRequisicao(req).permissoes.includes('clientes.todos'),
    });
  } catch (erro) {
    next(erro);
  }
};

export const detalhar: RequestHandler = async (req, res, next) => {
  try {
    const entrada = detalheSchema.parse(req.query);
    const escopo = await escopoDaRequisicao(req);

    res.json(await detalheRepo.detalhar(entrada, escopo));
  } catch (erro) {
    next(erro);
  }
};
