import { writeFileSync } from 'node:fs';

import { logger } from '../config/logger.js';
import { pool } from '../database/pool.js';
import { gerarXlsx } from '../utils/xlsxEscrita.js';

/**
 * Exporta os clientes cujo nome ainda está mascarado pelo portal.
 *
 *   npm run db:exportar-mascarados [-- --saida "C:/caminho/arquivo.xlsx"]
 *
 * `.xlsx` com células de texto: em CSV o Excel comeria o zero da frente do CPF.
 */

const MASCARA_SQL = "c.nome COLLATE utf8mb4_bin REGEXP '(^|[^[:alpha:]])X{2,}[a-z]'";

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [linhas] = await pool.query<any[]>(`
    SELECT
      c.nome,
      c.cpf_cnpj,
      CASE c.tipo_pessoa WHEN 'J' THEN 'Jurídica' ELSE 'Física' END AS tipo_pessoa,
      COALESCE(s.nome, '')  AS situacao,
      COALESCE(pr.nome, '') AS corretor,
      COALESCE((SELECT t.completo FROM telefones t
                 WHERE t.cliente_id = c.id ORDER BY t.principal DESC, t.id LIMIT 1), '') AS telefone,
      COALESCE((SELECT e.endereco FROM emails e
                 WHERE e.cliente_id = c.id ORDER BY e.principal DESC, e.id LIMIT 1), '') AS email,
      COUNT(a.id) AS apolices,
      COALESCE(GROUP_CONCAT(DISTINCT a.numero ORDER BY a.numero SEPARATOR ', '), '') AS numeros,
      COALESCE(GROUP_CONCAT(DISTINCT p.nome  ORDER BY p.nome  SEPARATOR ', '), '') AS produtos,
      COALESCE(DATE_FORMAT(MAX(a.vigencia_fim), '%d/%m/%Y'), '') AS ultima_vigencia,
      -- Agregada como as outras: um cliente pode ter apólice de mais de uma
      -- companhia, e escolher uma delas esconderia as demais.
      COALESCE(GROUP_CONCAT(DISTINCT seg.nome ORDER BY seg.nome SEPARATOR ', '), '') AS seguradora
    FROM clientes c
    LEFT JOIN situacoes_cliente s ON s.id = c.situacao_id
    LEFT JOIN produtores pr       ON pr.id = c.produtor_id
    LEFT JOIN apolices a          ON a.cliente_id = c.id
    LEFT JOIN produtos p          ON p.id = a.produto_id
    LEFT JOIN seguradoras seg     ON seg.id = a.seguradora_id
    WHERE ${MASCARA_SQL}
    GROUP BY c.id
    ORDER BY c.nome`);

  if (linhas.length === 0) {
    logger.info('Nenhum cliente com nome mascarado — nada a exportar.');
    return;
  }

  const cabecalho = [
    'Nome no sistema (mascarado)',
    'CPF/CNPJ',
    'Tipo de pessoa',
    'Situação',
    'Corretor',
    'Telefone',
    'E-mail',
    'Apólices',
    'Números das apólices',
    'Produtos',
    'Última vigência',
    'Seguradora',
  ];

  const grade = [
    cabecalho,
    ...linhas.map((l) => [
      String(l.nome ?? ''),
      String(l.cpf_cnpj ?? ''),
      String(l.tipo_pessoa ?? ''),
      String(l.situacao ?? ''),
      String(l.corretor ?? ''),
      String(l.telefone ?? ''),
      String(l.email ?? ''),
      String(l.apolices ?? 0),
      String(l.numeros ?? ''),
      String(l.produtos ?? ''),
      String(l.ultima_vigencia ?? ''),
      String(l.seguradora ?? ''),
    ]),
  ];

  const saida =
    argumento('saida') ??
    `C:/Users/usuario/Documents/Relatorios/clientes-nome-mascarado-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

  writeFileSync(saida, gerarXlsx(grade, 'Nomes mascarados'));

  logger.info({ clientes: linhas.length, arquivo: saida }, 'Exportado');
}

main()
  .then(() => pool.end())
  .catch(async (erro: unknown) => {
    logger.error({ erro }, 'Falha ao exportar');
    await pool.end();
    process.exitCode = 1;
  });
