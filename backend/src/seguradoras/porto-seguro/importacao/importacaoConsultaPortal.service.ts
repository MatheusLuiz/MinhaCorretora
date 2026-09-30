import * as apoliceRepo from '../../../repositories/apolice.repository.js';
import * as seguradoraRepo from '../../../repositories/seguradora.repository.js';
import { normalizarNomeColuna } from '../../../services/colunasImportacao.js';
import { importarCarteira, type ResultadoCarteira } from '../../../services/importacaoCarteira.service.js';
import { AppError } from '../../../utils/AppError.js';
import { emailFalso, telefoneFalso } from '../../../utils/contatoFalso.js';
import { gravarApolicesSemCliente, situacaoDoTexto, type ApoliceSemCliente } from '../../comum/apolicesSemCliente.js';
import { apolicesAb123cGuardadas, mesmoSegurado } from './referenciaAb123c.js';

/**
 * Consulta de apólices do portal da Porto com TODOS os SUSEP (novos/canceladas/vencidas, `download.xls` HTML).
 * Não traz CPF: vem da base ou do Apólices_AB123C guardado (só se o nome limpo preencher a máscara);
 * sem CPF, entra como apólice SEM cliente.
 */

export const LAYOUT_CONSULTA_PORTAL = 'porto-consulta-portal';

/** "114-7-4403079-1" → "114-7-4403079": o sufixo é o endosso, a apólice é a mesma. */
export const numeroDaApolice = (bruto: string): string => {
  const partes = bruto.trim().split('-');
  return partes.length > 3 ? partes.slice(0, 3).join('-') : bruto.trim();
};

const dataBr = (bruto: string | undefined): string => {
  const v = (bruto ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return /^\d{2}\/\d{2}\/\d{4}/.test(v) ? v.slice(0, 10) : '';
};

export interface ResultadoConsultaPortal extends ResultadoCarteira {
  consulta: {
    linhasDoArquivo: number;
    apolices: number;
    cpfDaBase: number;
    cpfDoAb123c: number;
    semCpf: number;
    /** Lida pela conciliação de CPF. */
    semCpfLista: string[];
    gravadasSemCliente: number;
    porSusep: Record<string, number>;
  };
}

export async function importarConsultaPortalPorto(
  grade: string[][],
  opcoes: { arquivo: string; simular: boolean; lote?: string },
): Promise<ResultadoConsultaPortal> {
  const cab = (grade[0] ?? []).map(normalizarNomeColuna);
  const i = (re: RegExp): number => cab.findIndex((c) => re.test(c));
  const col = {
    numero: i(/^apolice_contrato$/),
    nome: i(/^nome$/),
    produto: i(/^produto$/),
    susep: i(/^susep$/),
    emitido: i(/^emitido_em$/),
    status: i(/^status$/),
    fim: i(/^fim_vigencia$/),
    email: i(/^email$/),
    telefone: i(/^telefone$/),
  };
  if (col.numero < 0 || col.status < 0) {
    throw AppError.unprocessable(
      'Não reconheci a consulta do portal da Porto: faltam as colunas "Apólice/Contrato" e "Status".',
    );
  }

  // Uma linha por apólice: a do endosso ("-1") só vale quando a original não veio.
  const porNumero = new Map<string, string[]>();
  for (const l of grade.slice(1)) {
    const bruto = (l[col.numero] ?? '').trim();
    if (!bruto) continue;
    const numero = numeroDaApolice(bruto);
    if (!porNumero.has(numero) || bruto === numero) porNumero.set(numero, l);
  }

  const seguradora = await seguradoraRepo.porChave('porto-seguro');
  if (!seguradora) throw AppError.unprocessable('A Porto Seguro não está no cadastro de seguradoras.');
  const [base, ab123c] = await Promise.all([
    apoliceRepo.donosPorNumero(seguradora.id, [...porNumero.keys()]),
    apolicesAb123cGuardadas(),
  ]);

  const saida: string[][] = [
    ['numero_apolice', 'nome_civil', 'cpf_cnpj', 'produto', 'emitida_em', 'vigencia_fim', 'situacao_cia', 'email', 'celular'],
  ];
  const r = { cpfDaBase: 0, cpfDoAb123c: 0, semCpf: 0 };
  const semCpfLista: string[] = [];
  const semCliente: ApoliceSemCliente[] = [];
  const porSusep: Record<string, number> = {};

  for (const [numero, l] of porNumero) {
    const v = (c: number): string => (c >= 0 ? (l[c] ?? '').trim() : '');
    porSusep[v(col.susep) || '?'] = (porSusep[v(col.susep) || '?'] ?? 0) + 1;

    const dono = base.get(numero)?.[0];
    const jm = ab123c.porNumero.get(numero);
    const doJm = !dono && jm && mesmoSegurado(v(col.nome), jm.nomeMascarado) ? jm.documento : null;
    const documento = dono?.documento ?? doJm;
    if (!documento) {
      r.semCpf++;
      semCpfLista.push(`${numero} · ${v(col.nome)} · ${v(col.susep)} · ${v(col.status)}`);
      semCliente.push({
        numero,
        nomeSegurado: v(col.nome),
        produto: v(col.produto) || null,
        emitidaEm: dataBr(v(col.emitido)),
        vigenciaFim: dataBr(v(col.fim)),
        situacaoCia: situacaoDoTexto(v(col.status)),
      });
      continue;
    }
    if (dono) r.cpfDaBase++;
    else r.cpfDoAb123c++;

    const email = v(col.email);
    const telefone = v(col.telefone).replace(/\D/g, '');
    saida.push([
      numero,
      v(col.nome),
      documento,
      v(col.produto),
      dataBr(v(col.emitido)),
      dataBr(v(col.fim)),
      v(col.status),
      email.includes('@') && !emailFalso(email) ? email : '',
      telefone.length >= 10 && !telefoneFalso(telefone) ? telefone : '',
    ]);
  }

  if (saida.length < 2) {
    throw AppError.unprocessable(
      `Nenhuma das ${porNumero.size} apólices tem CPF: nem na base, nem nas cópias guardadas do Apólices_AB123C.`,
    );
  }

  const resultado = await importarCarteira(saida, {
    layout: LAYOUT_CONSULTA_PORTAL,
    arquivo: opcoes.arquivo,
    simular: opcoes.simular,
    ...(opcoes.lote ? { lote: opcoes.lote } : {}),
  });
  const gravadasSemCliente = opcoes.simular
    ? 0
    : await gravarApolicesSemCliente(seguradora.id, semCliente, { lote: resultado.lote, arquivo: opcoes.arquivo });

  return {
    ...resultado,
    consulta: {
      gravadasSemCliente,
      linhasDoArquivo: grade.length - 1,
      apolices: porNumero.size,
      ...r,
      semCpfLista,
      porSusep,
    },
  };
}
