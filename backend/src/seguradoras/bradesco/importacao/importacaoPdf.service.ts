import { randomUUID } from 'node:crypto';

import * as veiculoRepo from '../../../repositories/apoliceVeiculo.repository.js';
import * as encerradaRepo from '../../../repositories/encerrada.repository.js';
import * as renovacaoRepo from '../../../repositories/renovacao.repository.js';
import * as tipoRepo from '../../../repositories/tipoSeguro.repository.js';
import { AppError } from '../../../utils/AppError.js';
import { importarCarteira, type ResultadoCarteira } from '../../../services/importacaoCarteira.service.js';
import { importarFinanceiro } from '../../../services/importacaoFinanceiro.service.js';
import { lerHistoricoBradesco, type ApoliceBradesco } from './leitorPdf.js';

/**
 * PDF "Histórico da Apólice" do Bradesco → uma linha de carteira + N de parcela, pelos importadores
 * comuns (para não duplicar suas regras). As duas cargas usam o MESMO lote, para desfazer juntas.
 */

export interface ResultadoPdfBradesco extends ResultadoCarteira {
  pdf: {
    apolice: string;
    parcelas: number;
    parcelasGravadas: number;
    somaConfere: boolean;
    veiculoGravado: boolean;
    avisos: string[];
  };
}

function situacao(texto: string | null): string {
  const t = (texto ?? '').toUpperCase();
  if (t.startsWith('ATIVA')) return 'ATIVA';
  if (t.startsWith('CANCEL')) return 'CANCELADA';
  // "ENCERRADA - ENC.POR ENDOSSO" não diz o motivo: não afirmar "cancelada".
  if (t.startsWith('ENCERRAD')) return 'NAO VIGENTE';
  return t;
}

const br = (iso: string | null): string => (iso ? iso.split('-').reverse().join('/') : '');

/** "Aberto" com vencimento passado é atraso: o portal não distingue. */
function statusDaParcela(p: ApoliceBradesco['parcelas'][number], hoje: string): string {
  const s = p.status.toLowerCase();
  if (s.startsWith('compensad')) return 'pago';
  if (s.startsWith('parcela cancel') || s.startsWith('cancel')) return 'cancelado';
  if (s.startsWith('aberto') || s.startsWith('agendad')) {
    return p.vencimento && p.vencimento < hoje ? 'atrasado' : 'aberto';
  }
  return p.status;
}

/** Número da apólice na base (`numero/item` em frota); `null` = item 0, o resumo da frota. */
export function identificacaoNaBase(a: ApoliceBradesco): { frota: boolean; numero: string | null } {
  // A regra pelo item só vale para PDF sem "Descrição do Seguro".
  const frota = a.frota ?? (a.item !== null && a.item !== '1' && a.item !== '0');
  if (frota && (a.item === null || a.item === '0')) return { frota, numero: null };
  return { frota, numero: frota ? `${a.apolice}/${a.item}` : a.apolice };
}

/** Grava o veículo e o tipo na apólice já gravada; `false` se a apólice não existe. */
export async function gravarVeiculoDoPdf(a: ApoliceBradesco): Promise<boolean> {
  const { frota, numero } = identificacaoNaBase(a);
  const v = a.veiculo;
  if (!v || !numero) return false;

  const apoliceId = await veiculoRepo.apoliceIdPorNumero('bradesco', numero, a.segurado.documento);
  if (!apoliceId) return false;

  await veiculoRepo.gravar(
    apoliceId,
    {
      placa: v.placa, chassi: v.chassi, fabricante: v.fabricante, modelo: v.modelo,
      anoFabricacao: v.anoFabricacao, anoModelo: v.anoModelo, codigoFipe: v.codigoFipe,
      combustivel: v.combustivel, tipoVeiculo: v.tipoVeiculo, uso: v.uso,
      // Sem a cláusula não se conclui "usado": fica em branco.
      zeroKm: v.zeroKm ? true : null,
      antifurto: v.antifurto, kitGas: null,
      cepPernoite: v.cepPernoite, pernoiteGaragem: v.pernoiteGaragem,
      condutorNome: v.condutor.nome, condutorDocumento: v.condutor.documento,
      condutorNascimento: v.condutor.nascimento, observacoes: null,
    },
    'importacao',
  );

  // Não sobrescreve tipo escolhido à mão (Carta Verde, por exemplo).
  const tipoId = await tipoRepo.idPorChave(frota ? 'frota' : 'auto');
  if (tipoId) await veiculoRepo.definirTipoDaApolice(apoliceId, tipoId, false);
  return true;
}

export async function importarPdfBradesco(
  pdf: Buffer,
  opcoes: { arquivo: string; simular: boolean },
): Promise<ResultadoPdfBradesco> {
  let a: ApoliceBradesco;
  try {
    a = lerHistoricoBradesco(pdf);
  } catch (erro) {
    throw AppError.unprocessable(erro instanceof Error ? erro.message : 'PDF ilegível.');
  }

  const avisos: string[] = [];

  // Frota: cada item vira apólice `numero/item`; as parcelas são da frota inteira e não entram pelo item
  // (contariam a mesma cobrança várias vezes).
  const { frota, numero: numeroNaBase } = identificacaoNaBase(a);

  if (numeroNaBase === null) {
    throw AppError.unprocessable(
      `Apólice ${a.apolice}: este PDF é o resumo da FROTA (item 0). Importe os PDFs de cada item — é por eles que os veículos entram.`,
    );
  }

  const parcelasDoItem = frota ? [] : a.parcelas;
  if (frota) {
    avisos.push(
      `Apólice ${a.apolice} é de FROTA (item ${a.item}): entrou como ${numeroNaBase}, com o prêmio do veículo. As ${a.parcelas.length} parcela(s) são da frota inteira e não foram importadas pelo item.`,
    );
  }

  const somaCentavos = parcelasDoItem.reduce((s, p) => s + Math.round(Number(p.valor ?? 0) * 100), 0);
  const brutoCentavos = Math.round(Number(a.premio.bruto ?? 0) * 100);
  const somaConfere = parcelasDoItem.length > 0 && somaCentavos === brutoCentavos;
  if (parcelasDoItem.length > 0 && !somaConfere) {
    avisos.push(
      `Apólice ${a.apolice}: as parcelas somam R$ ${(somaCentavos / 100).toFixed(2)} e o prêmio bruto é R$ ${(brutoCentavos / 100).toFixed(2)}. Entrou assim; confira no portal.`,
    );
  }
  if (a.temSinistro) {
    avisos.push(`Apólice ${a.apolice}: o PDF lista sinistro, e a leitura de sinistro do Bradesco ainda não existe.`);
  }
  if (!a.segurado.documento) {
    avisos.push(`Apólice ${a.apolice}: CPF/CNPJ do segurado não encontrado no PDF.`);
  }

  const lote = randomUUID();

  const e = a.endereco;
  const carteira: [string[], string[]] = [
    [
      'cpf_cnpj', 'nome_civil', 'numero_apolice', 'produto', 'vigencia_inicio', 'vigencia_fim',
      'emitida_em', 'premio_total', 'premio_liquido', 'situacao_cia', 'tipo_negocio',
      'email', 'data_nascimento', 'sexo',
      'logradouro', 'numero_endereco', 'complemento', 'cidade', 'uf', 'cep',
    ],
    [
      a.segurado.documento ?? '', a.segurado.nome ?? '', numeroNaBase, a.produto ?? '',
      br(a.inicio), br(a.fim), br(a.emissao),
      (a.premio.bruto ?? '').replace('.', ','), (a.premio.liquido ?? '').replace('.', ','),
      situacao(a.situacao),
      // Sem apólice anterior pode ser novo OU vindo de outra companhia: fica em branco.
      a.apoliceAnterior ? 'R' : '',
      a.segurado.email ?? '', br(a.segurado.nascimento), a.segurado.sexo ?? '',
      e?.logradouro ?? '', e?.numero ?? '', e?.complemento ?? '', e?.cidade ?? '', e?.uf ?? '', e?.cep ?? '',
    ],
  ];

  const resultado = await importarCarteira(carteira, {
    layout: 'bradesco-historico-apolice',
    arquivo: opcoes.arquivo,
    simular: opcoes.simular,
    lote,
  });

  // Depois da carteira: o veículo se pendura na apólice que ela gravou.
  let veiculoGravado = false;
  if (!opcoes.simular && a.veiculo) {
    veiculoGravado = await gravarVeiculoDoPdf(a);
    if (!veiculoGravado) {
      avisos.push(`Apólice ${numeroNaBase}: o veículo não foi gravado porque a apólice não entrou.`);
    }
  }

  // A lista a renovar e a de encerradas podem ter chegado antes deste PDF.
  if (!opcoes.simular) {
    await renovacaoRepo.vincularPorChave('bradesco');
    await encerradaRepo.vincularPorChave('bradesco');
  }

  let parcelasGravadas = 0;
  if (parcelasDoItem.length > 0) {
    const hoje = new Date().toISOString().slice(0, 10);
    const grade: string[][] = [
      ['numero_apolice', 'sequencia_emissao', 'nome_segurado', 'produto', 'numero_parcela',
        'vencimento', 'valor', 'status'],
      ...parcelasDoItem.map((p) => [
        a.apolice, p.endosso ?? '0', a.segurado.nome ?? '', a.produto ?? '', String(p.numero),
        br(p.vencimento), p.valor ?? '', statusDaParcela(p, hoje),
      ]),
    ];

    const parcelas = await importarFinanceiro(grade, {
      layout: 'bradesco-parcelas-pdf',
      arquivo: opcoes.arquivo,
      simular: opcoes.simular,
      lote,
    });
    parcelasGravadas = parcelas.gravadas;
    if (parcelas.recusadas > 0) {
      avisos.push(`Apólice ${a.apolice}: ${parcelas.recusadas} parcela(s) recusada(s) — ${JSON.stringify(parcelas.motivosDeRecusa)}.`);
    }
  }

  return {
    ...resultado,
    pdf: {
      apolice: numeroNaBase,
      parcelas: parcelasDoItem.length,
      parcelasGravadas,
      somaConfere,
      veiculoGravado,
      avisos,
    },
  };
}
