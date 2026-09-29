/**
 * Completa o cadastro dos clientes que JÁ existem — nunca cria cliente.
 *
 *   npm run db:reconciliar                # nomes mascarados, prévia
 *   npm run db:reconciliar -- --aplicar   # nomes mascarados, grava
 *
 * Sem `--aplicar`, tudo roda numa transação desfeita no fim: é a prévia.
 */
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { desenhoDaMascara, nomeEmCaixaAlta, semAcentoMaiusculo } from '../utils/texto.js';

/**
 * Nome mascarado: X no começo de um pedaço de palavra, antes de minúsculas.
 * `COLLATE utf8mb4_bin` é obrigatório (a coluna ignora caixa); a negação é do REGEXP.
 */
function mascarado(coluna: string, negado = false): string {
  return `${coluna} COLLATE utf8mb4_bin ${negado ? 'NOT ' : ''}REGEXP '(^|[^[:alpha:]])X{2,}[a-z]'`;
}

/**
 * Desmascara pelo demonstrativo de comissão (traz o nome inteiro): pelo vínculo
 * apólice → comissão, senão pelo desenho da máscara só com UM candidato.
 */
async function desmascararPelaComissao(
  conexao: import('mysql2/promise').PoolConnection,
): Promise<{ peloVinculo: number; peloDesenho: number; ambiguos: number; restantes: number }> {
  const gravar = async (id: number, nome: string): Promise<void> => {
    await conexao.execute('UPDATE clientes SET nome = ? WHERE id = ?', [nomeEmCaixaAlta(nome), id]);
  };

  const [porVinculo] = await conexao.query<any[]>(`
    SELECT c.id, GROUP_CONCAT(DISTINCT UPPER(i.nome_segurado) SEPARATOR '|') AS nomes
      FROM clientes c
      JOIN apolices a ON a.cliente_id = c.id
      JOIN comissoes_itens i ON i.apolice_id = a.id
     WHERE ${mascarado('c.nome')} AND ${mascarado('i.nome_segurado', true)}
     GROUP BY c.id`);
  const resolvidos = new Set<number>();
  for (const l of porVinculo) {
    const nomes = String(l.nomes).split('|');
    if (nomes.length !== 1) continue;
    await gravar(Number(l.id), nomes[0]!);
    resolvidos.add(Number(l.id));
  }

  const [alvos] = await conexao.query<any[]>(`SELECT id, nome FROM clientes WHERE ${mascarado('nome')}`);
  const [limpos] = await conexao.query<any[]>(
    `SELECT DISTINCT nome_segurado AS nome FROM comissoes_itens
      WHERE nome_segurado IS NOT NULL AND ${mascarado('nome_segurado', true)}`,
  );
  const chaves = [...new Set(limpos.map((l) => semAcentoMaiusculo(String(l.nome))))];

  let peloDesenho = 0;
  let ambiguos = 0;
  for (const alvo of alvos) {
    if (resolvidos.has(Number(alvo.id))) continue;
    const re = desenhoDaMascara(String(alvo.nome));
    if (!re) continue;
    const achados = chaves.filter((k) => re.test(k));
    if (achados.length > 1) ambiguos++;
    if (achados.length !== 1) continue;
    await gravar(Number(alvo.id), achados[0]!);
    peloDesenho++;
  }

  const [[resto]] = await conexao.query<any[]>(`SELECT COUNT(*) n FROM clientes WHERE ${mascarado('nome')}`);
  return { peloVinculo: resolvidos.size, peloDesenho, ambiguos, restantes: Number(resto.n) };
}

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');

  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();

    const resumo = await desmascararPelaComissao(conexao);

    if (aplicar) await conexao.commit();
    else await conexao.rollback();

    logger.info(resumo, `Nomes mascarados — ${aplicar ? 'APLICADO' : 'prévia, nada gravado'}`);
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (erro: unknown) => {
    logger.error({ erro }, 'Falha na reconciliação');
    await pool.end();
    process.exitCode = 1;
  });
