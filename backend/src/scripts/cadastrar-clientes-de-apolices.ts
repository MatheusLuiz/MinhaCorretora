/**
 * Cria clientes a partir das apólices que têm CPF/CNPJ e ainda não têm cadastro.
 *
 *   npm run db:cadastrar:de-apolices -- --simular
 *   npm run db:cadastrar:de-apolices
 *
 * Cadastro mínimo (nome e documento). Só documento válido no dígito: um CPF
 * errado criaria um cadastro paralelo que ninguém encontra.
 */
import { randomUUID } from 'node:crypto';

import { logger } from '../config/logger.js';
import { encerrarPool, pool } from '../database/pool.js';
import * as apoliceRepo from '../repositories/apolice.repository.js';
import * as clienteRepo from '../repositories/cliente.repository.js';
import { documentoEhValido, formatarDocumento } from '../utils/documento.js';

import type { RowDataPacket } from 'mysql2/promise';

interface Candidato {
  documento: string;
  nome: string;
}

async function main(): Promise<void> {
  const simular = process.argv.includes('--simular');
  const lote = randomUUID();

  // MIN(nome): nome estável quando a pessoa aparece com grafias diferentes.
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT a.documento_segurado AS documento, MIN(a.nome_segurado) AS nome
       FROM apolices a
       LEFT JOIN clientes c ON c.cpf_cnpj_numeros = a.documento_segurado
      WHERE a.documento_segurado IS NOT NULL
        AND c.id IS NULL
      GROUP BY a.documento_segurado`,
  );

  const candidatos: Candidato[] = [];
  const invalidos: string[] = [];

  for (const l of linhas) {
    const documento = String(l.documento);
    const nome = String(l.nome ?? '').trim();

    if (!documentoEhValido(documento)) {
      invalidos.push(documento);
      continue;
    }

    if (!nome) continue;

    candidatos.push({ documento, nome });
  }

  const situacoes = await clienteRepo.listarSituacoes();
  const situacaoAtivo = situacoes.find((s) => s.chave === 'ativo')?.id ?? null;

  console.log('\n─────────────────────────────────────────────');
  console.log(simular ? '  SIMULAÇÃO (nada será gravado)' : '  CADASTRO A PARTIR DE APÓLICES');
  console.log('─────────────────────────────────────────────');
  console.log(`  documentos sem cadastro ...: ${linhas.length}`);
  console.log(`  a cadastrar ...............: ${candidatos.length}`);
  console.log(`  documento inválido ........: ${invalidos.length}`);

  if (invalidos.length > 0) {
    console.log(`    (recusados: dígito verificador não confere)`);
  }

  if (simular || candidatos.length === 0) {
    console.log('─────────────────────────────────────────────\n');
    return;
  }

  const TAMANHO = 500;
  let criados = 0;

  for (let i = 0; i < candidatos.length; i += TAMANHO) {
    const fatia = candidatos.slice(i, i + TAMANHO);

    criados += await clienteRepo.inserirClientes(
      fatia.map((c) => ({
        origemSistema: 'seguradora' as const,
        origemArquivo: null,
        origemLote: lote,

        cpfCnpj: formatarDocumento(c.documento),
        cpfCnpjNumeros: c.documento,
        tipoPessoa: c.documento.length === 14 ? ('J' as const) : ('F' as const),

        nome: c.nome.slice(0, 150),
        nomeSocial: null,
        profissaoId: null,
        estadoCivilId: null,
        sexo: null,
        dataNascimento: null,

        vip: false,
        // O relatório não diz nada sobre consentimento.
        autorizaContato: false,

        situacaoId: situacaoAtivo,
        situacaoEm: null,
        saidaEm: null,

        produtorId: null,
        estruturaVendaId: null,
        origemClienteId: null,
        faixaRendaId: null,
        faturamentoAnual: null,

        clienteDesde: null,
        ultimaAlteracao: null,
      })),
    );
  }

  const vinculo = await apoliceRepo.vincularPorDocumento();

  console.log(`\n  clientes criados ..........: ${candidatos.length}`);
  console.log(`  apólices vinculadas .......: ${vinculo.novos}`);
  console.log(`  vínculos por nome corrigidos: ${vinculo.corrigidos}`);
  console.log(`  lote (para desfazer) ......: ${lote}`);

  const resumo = await apoliceRepo.resumo();
  console.log(`\n  apólices sem cliente agora : ${resumo.semCliente}`);
  console.log('─────────────────────────────────────────────\n');

  logger.info({ lote, criados, vinculadas: vinculo.novos }, 'Cadastro a partir de apólices concluído');
}

main()
  .catch((erro: unknown) => {
    logger.fatal({ err: erro }, 'Falha ao cadastrar clientes a partir de apólices');
    process.exitCode = 1;
  })
  .finally(() => {
    void encerrarPool();
  });
