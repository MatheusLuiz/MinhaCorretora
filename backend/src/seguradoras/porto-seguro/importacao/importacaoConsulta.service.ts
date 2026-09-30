import { randomUUID } from 'node:crypto';

import { logger } from '../../../config/logger.js';
import { pool } from '../../../database/pool.js';
import * as apoliceRepo from '../../../repositories/apolice.repository.js';
import * as clienteRepo from '../../../repositories/cliente.repository.js';
import * as seguradoraRepo from '../../../repositories/seguradora.repository.js';
import { AppError } from '../../../utils/AppError.js';
import { desenhoDaMascara, semAcentoMaiusculo } from '../../../utils/texto.js';
import { normalizarNomeColuna } from '../../../services/colunasImportacao.js';

/**
 * Consulta de apólices da Porto (`download.xls`, HTML): troca o nome mascarado do AB123C pelo verdadeiro
 * só se ele preencher o molde da máscara (nome de terceiro é pior que mascarado); completa e-mail/telefone
 * do tipo que falta. Sem CPF, não cria nada.
 */

export interface ResultadoConsultaPorto {
  lote: string;
  arquivo: string;
  layout: string;
  simulacao: boolean;
  entidade: 'clientes';
  linhas: number;
  apolices: number;
  semApoliceNaBase: number;
  nomesTrocados: number;
  nomesJaLimpos: number;
  nomesQueNaoPreenchemAMascara: { numero: string; base: string; consulta: string }[];
  emails: number;
  telefones: number;
  recusadas: number;
  motivosDeRecusa: Record<string, number>;
  mapeamento: [];
  colunasIgnoradas: string[];
}

const texto = (v: string | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim();

/** `114-7-4414026-1` → `114-7-4414026`: o quarto pedaço é o endosso. */
function numeroDaApolice(bruto: string): string {
  const partes = texto(bruto).split('-');
  return partes.length >= 3 ? partes.slice(0, 3).join('-') : texto(bruto);
}

export async function importarConsultaPorto(
  grade: string[][],
  opcoes: { layout: string; arquivo: string; simular: boolean },
): Promise<ResultadoConsultaPorto> {
  const cab = (grade[0] ?? []).map((c) => normalizarNomeColuna(c));
  const col = { numero: cab.indexOf('apolice_contrato'), nome: cab.indexOf('nome'), email: cab.indexOf('email'), telefone: cab.indexOf('telefone') };
  if (col.numero < 0 || col.nome < 0) {
    throw AppError.unprocessable(
      'Não encontrei as colunas "Apólice/Contrato" e "Nome". Confira se é a consulta de apólices do portal da Porto.',
    );
  }
  const seguradora = await seguradoraRepo.porChave('porto-seguro');
  if (!seguradora) throw AppError.unprocessable('A Porto Seguro não está cadastrada.');

  const lote = randomUUID();
  const dados = grade.slice(1).filter((l) => texto(l[col.numero]));
  // A consulta repete a apólice por endosso.
  const porNumero = new Map<string, { nome: string; email: string; telefone: string }>();
  for (const l of dados) {
    const n = numeroDaApolice(l[col.numero]!);
    const atual = porNumero.get(n);
    porNumero.set(n, {
      nome: atual?.nome || texto(l[col.nome]),
      email: atual?.email || (col.email >= 0 ? texto(l[col.email]) : ''),
      telefone: atual?.telefone || (col.telefone >= 0 ? texto(l[col.telefone]).replace(/\D/g, '') : ''),
    });
  }

  const donos = await apoliceRepo.donosPorNumero(seguradora.id, [...porNumero.keys()]);
  const r: ResultadoConsultaPorto = {
    lote, arquivo: opcoes.arquivo, layout: opcoes.layout, simulacao: opcoes.simular, entidade: 'clientes',
    linhas: dados.length, apolices: porNumero.size, semApoliceNaBase: 0, nomesTrocados: 0, nomesJaLimpos: 0,
    nomesQueNaoPreenchemAMascara: [], emails: 0, telefones: 0, recusadas: 0, motivosDeRecusa: {}, mapeamento: [], colunasIgnoradas: [],
  };

  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    const clientesVistos = new Set<number>();
    for (const [numero, linha] of porNumero) {
      const lista = donos.get(numero);
      if (!lista || lista.length === 0) {
        r.semApoliceNaBase++;
        continue;
      }
      const dono = lista[0]!;
      const molde = desenhoDaMascara(dono.nome);
      if (!molde) r.nomesJaLimpos++;
      else if (linha.nome && molde.test(semAcentoMaiusculo(linha.nome))) {
        if (!opcoes.simular) {
          await clienteRepo.trocarNomeMascarado(dono.clienteId, linha.nome, conexao);
          await apoliceRepo.trocarSeguradoMascarado(lista.map((d) => d.apoliceId), linha.nome, conexao);
        }
        r.nomesTrocados++;
      } else if (linha.nome) {
        r.nomesQueNaoPreenchemAMascara.push({ numero, base: dono.nome, consulta: linha.nome });
      }

      if (clientesVistos.has(dono.clienteId)) continue;
      clientesVistos.add(dono.clienteId);
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(linha.email)) {
        r.emails += opcoes.simular
          ? 1
          : await clienteRepo.inserirEmails([{ clienteId: dono.clienteId, tipo: 'pessoal', endereco: linha.email, principal: true }], conexao);
      }
      const d = linha.telefone;
      if (d.length === 10 || d.length === 11) {
        const tipo = d.length === 11 && d[2] === '9' ? 'celular' : 'residencial';
        r.telefones += opcoes.simular
          ? 1
          : await clienteRepo.inserirTelefones(
              [{ clienteId: dono.clienteId, tipo, ddd: d.slice(0, 2), numero: d.slice(2), completo: d, principal: true }],
              conexao,
            );
      }
    }
    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }

  if (!opcoes.simular) {
    logger.info({ lote, arquivo: opcoes.arquivo, nomes: r.nomesTrocados, emails: r.emails, telefones: r.telefones }, 'Consulta de apólices da Porto aplicada');
  }
  return r;
}
