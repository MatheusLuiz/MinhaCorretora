import * as apoliceRepo from '../../../repositories/apolice.repository.js';
import * as clienteRepo from '../../../repositories/cliente.repository.js';
import * as seguradoraRepo from '../../../repositories/seguradora.repository.js';
import { normalizarNomeColuna } from '../../../services/colunasImportacao.js';
import { importarCarteira, type ResultadoCarteira } from '../../../services/importacaoCarteira.service.js';
import { AppError } from '../../../utils/AppError.js';
import { chaveDoNome } from '../../../utils/texto.js';
import { gravarApolicesSemCliente, type ApoliceSemCliente } from '../../comum/apolicesSemCliente.js';

/**
 * "Apólices RE" do Bradesco (ativas/encerradas) e auto ativas: sem CPF nem prêmio. Dono pela base (número)
 * ou pelo NOME na base com UM documento; senão apólice SEM cliente.
 * Encerradas: "Cancelamento … no dia DD/MM/AAAA" (data dentro do motivo) ≠ "Encerramento … fim da vigência" (só venceu).
 */

export const LAYOUT_RE_ATIVAS = 'bradesco-re-ativas';
export const LAYOUT_RE_ENCERRADAS = 'bradesco-re-encerradas';
/** Mesmo formato, sem coluna de produto (vira "AUTO"). */
export const LAYOUT_AUTO_ATIVAS = 'bradesco-auto-ativas';

/** "639-0/654321" (sucursal-agência/apólice) → "654321". */
const numeroDaApolice = (bruto: string | undefined): string =>
  ((bruto ?? '').split('/').pop() ?? '').replace(/\D/g, '').replace(/^0+/, '');

function separarData(motivo: string): { data: string; motivo: string } {
  const m = /\s+no dia\s+(\d{2}\/\d{2}\/\d{4})\s*$/i.exec(motivo);
  return m ? { data: m[1]!, motivo: motivo.slice(0, m.index).trim() } : { data: '', motivo };
}

export interface ResultadoReBradesco extends ResultadoCarteira {
  re: {
    linhasDoArquivo: number;
    cpfDaBase: number;
    cpfPeloNomeNaBase: number;
    semCpf: string[];
    gravadasSemCliente: number;
    canceladas: number;
    vencidas: number;
  };
}

export async function importarReBradesco(
  grade: string[][],
  opcoes: { layout: typeof LAYOUT_RE_ATIVAS | typeof LAYOUT_RE_ENCERRADAS | typeof LAYOUT_AUTO_ATIVAS; arquivo: string; simular: boolean },
): Promise<ResultadoReBradesco> {
  const iCab = grade.findIndex((l) => {
    const n = l.map(normalizarNomeColuna);
    return n.includes('segurado') && n.includes('suc_ag_apolice');
  });
  if (iCab < 0) throw AppError.unprocessable('Não reconheci o relatório "Apólices RE" do Bradesco (faltam "Segurado" e "Suc-Ag / Apolice").');
  const cab = grade[iCab]!.map(normalizarNomeColuna);
  const c = (n: string): number => cab.indexOf(n);
  const col = {
    nome: c('segurado'), apolice: c('suc_ag_apolice'), produto: c('produto'), emissao: c('data_da_emissao'),
    inicio: c('inicio_da_vigencia'), fim: c('fim_da_vigencia'), motivo: c('motivo_cancelamento'),
  };
  const encerradas = opcoes.layout === LAYOUT_RE_ENCERRADAS;
  if (encerradas && col.motivo < 0) throw AppError.unprocessable('O relatório de encerradas não traz "Motivo Cancelamento".');

  const linhas = grade.slice(iCab + 1).filter((l) => numeroDaApolice(l[col.apolice]));
  const seguradora = await seguradoraRepo.porChave('bradesco');
  if (!seguradora) throw AppError.unprocessable('O Bradesco não está no cadastro de seguradoras.');
  const [base, nomesNaBase] = await Promise.all([
    apoliceRepo.donosPorNumero(seguradora.id, linhas.map((l) => numeroDaApolice(l[col.apolice]))),
    clienteRepo.documentosPorNome(linhas.map((l) => l[col.nome] ?? '')),
  ]);

  const documentosNaBase = new Map<string, Set<string>>();
  for (const [nome, docs] of nomesNaBase) {
    const k = chaveDoNome(nome);
    documentosNaBase.set(k, new Set([...(documentosNaBase.get(k) ?? []), ...docs]));
  }
  const peloNomeNaBase = (nome: string): string | null => {
    const docs = documentosNaBase.get(chaveDoNome(nome));
    return docs?.size === 1 ? [...docs][0]! : null;
  };

  const saida: string[][] = [
    [
      'numero_apolice', 'cpf_cnpj', 'nome_civil', 'produto', 'ramo_descricao', 'emitida_em',
      'vigencia_inicio', 'vigencia_fim', 'situacao_cia', 'cancelada_em', 'motivo_cancelamento',
    ],
  ];
  const r = { cpfDaBase: 0, cpfPeloNomeNaBase: 0, canceladas: 0, vencidas: 0 };
  const semCpf: string[] = [];
  const semCliente: ApoliceSemCliente[] = [];
  for (const l of linhas) {
    const v = (i: number): string => (i >= 0 ? (l[i] ?? '').trim() : '');
    const numero = numeroDaApolice(v(col.apolice));
    const dono = base.get(numero)?.[0];
    const naBase = dono ? null : peloNomeNaBase(v(col.nome));
    const documento = dono?.documento ?? naBase;
    if (!documento) {
      semCpf.push(`${v(col.apolice)} · ${v(col.nome)} · ${v(col.produto)}${encerradas ? ` · ${v(col.motivo)}` : ''}`);
      const canceladaSemDono = encerradas && /^cancelamento/i.test(v(col.motivo));
      const { data: canceladaEm, motivo } = separarData(v(col.motivo));
      semCliente.push({
        numero,
        nomeSegurado: v(col.nome),
        produto: col.produto >= 0 ? v(col.produto) : 'AUTO',
        emitidaEm: v(col.emissao),
        vigenciaInicio: v(col.inicio),
        vigenciaFim: v(col.fim),
        ...(canceladaSemDono ? { situacaoCia: 'cancelada' as const, canceladaEm, motivoCancelamento: motivo } : {}),
      });
      continue;
    }
    if (dono) r.cpfDaBase++;
    else r.cpfPeloNomeNaBase++;

    const cancelada = encerradas && /^cancelamento/i.test(v(col.motivo));
    if (encerradas) {
      if (cancelada) r.canceladas++;
      else r.vencidas++;
    }
    const { data, motivo } = separarData(v(col.motivo));
    // Apólice já na base não recebe produto: o COALESCE da carteira trocaria o produto do PDF.
    const produto = dono ? '' : col.produto >= 0 ? v(col.produto) : 'AUTO';
    saida.push([
      numero, documento, v(col.nome), produto, produto,
      v(col.emissao), v(col.inicio), v(col.fim),
      cancelada ? 'CANCELADA' : '', cancelada ? data : '', cancelada ? motivo : '',
    ]);
  }

  if (saida.length < 2) {
    throw AppError.unprocessable(`Nenhuma das ${linhas.length} apólices tem dono conhecido: nem na base (número ou nome).`);
  }
  const resultado = await importarCarteira(saida, { layout: opcoes.layout, arquivo: opcoes.arquivo, simular: opcoes.simular });
  const gravadasSemCliente = opcoes.simular
    ? 0
    : await gravarApolicesSemCliente(seguradora.id, semCliente, { lote: resultado.lote, arquivo: opcoes.arquivo });
  return { ...resultado, re: { linhasDoArquivo: linhas.length, ...r, semCpf, gravadasSemCliente } };
}
