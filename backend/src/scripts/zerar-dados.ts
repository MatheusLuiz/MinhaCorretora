import { logger } from '../config/logger.js';
import { pool } from '../database/pool.js';

/**
 * Zera os dados de negócio e mantém o acesso.
 *
 *   npm run db:zerar              # só mostra o que sairia
 *   npm run db:zerar -- --aplicar # zera
 *
 * Ficam login, `_migrations` (o runner compara hash) e `situacoes_cliente`
 * (a importação a consulta por chave e não cria).
 */

/** Da folha para a raiz: TRUNCATE não aceita tabela referenciada por FK. */
const TABELAS = [
  'comissoes_itens',
  'parcelas',
  'comissoes',
  'apolice_movimentos',
  'segurados',
  'apolices',
  'telefones',
  'emails',
  'enderecos',
  'seguradoras_clientes',
  'clientes',
  'produtos',
  'ramos',
  'canais_producao',
  'produtores',
  'estruturas_venda',
  'origens_clientes',
  'profissoes',
  'estados_civis',
  'faixas_renda',
  'municipios',
  'modalidades',
  'modelos_relatorio_colunas',
  'modelos_relatorio',
  'seguradora_integracoes',
  'seguradoras',
  'arquivos_importados',
  'importacoes',
  'auditoria',
] as const;

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const conexao = await pool.getConnection();

  try {
    const antes: Record<string, number> = {};
    for (const t of TABELAS) {
      const [l] = await conexao.query<any[]>(`SELECT COUNT(*) n FROM \`${t}\``);
      const n = Number(l[0]?.n ?? 0);
      if (n > 0) antes[t] = n;
    }

    const [mantidas] = await conexao.query<any[]>(`
      SELECT (SELECT COUNT(*) FROM usuarios) usuarios,
             (SELECT COUNT(*) FROM papeis) papeis,
             (SELECT COUNT(*) FROM permissoes) permissoes,
             (SELECT COUNT(*) FROM situacoes_cliente) situacoes,
             (SELECT COUNT(*) FROM _migrations) migrations`);

    logger.info({ apagaria: antes, mantem: mantidas[0] }, aplicar ? 'Zerando' : 'Prévia');

    if (!aplicar) {
      logger.info('Nada foi apagado. Rode com --aplicar para efetivar.');
      return;
    }

    await conexao.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const t of TABELAS) {
      await conexao.query(`DELETE FROM \`${t}\``);
      await conexao.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
    }

    // A conexão volta ao pool: não pode ficar com a checagem desligada.
    await conexao.query('SET FOREIGN_KEY_CHECKS = 1');

    const [depois] = await conexao.query<any[]>(`
      SELECT (SELECT COUNT(*) FROM clientes) clientes,
             (SELECT COUNT(*) FROM apolices) apolices,
             (SELECT COUNT(*) FROM comissoes) comissoes,
             (SELECT COUNT(*) FROM seguradoras) seguradoras,
             (SELECT COUNT(*) FROM usuarios) usuarios,
             (SELECT COUNT(*) FROM situacoes_cliente) situacoes`);

    logger.info(depois[0], 'Zerado');
  } finally {
    await conexao.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => undefined);
    conexao.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (erro: unknown) => {
    logger.error({ erro: (erro as Error).message }, 'Falha ao zerar');
    await pool.end();
    process.exitCode = 1;
  });
