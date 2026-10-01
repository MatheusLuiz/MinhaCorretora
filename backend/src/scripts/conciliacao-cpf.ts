/**
 * Planilha de CONCILIAÇÃO: as apólices que não entraram por não terem dono
 * (CPF) conhecido — refeita do zero a cada execução.
 *
 *   npm run db:conciliacao-cpf -- --saida "C:\...\Relatorios\Apolices_sem_CPF.xlsx"
 *        [--clientes-sem-dono "C:\...\Relatorios\Clientes_sem_dono.xlsx"]
 *
 * Relê a cópia guardada de cada carga sem CPF e refaz a busca do dono em
 * simulação, com a base de hoje. Só leitura.
 */
import { writeFileSync } from 'node:fs';
import type { RowDataPacket } from 'mysql2/promise';

import { lerGrade } from '../controllers/importacaoArquivos.controller.js';
import { encerrarPool, pool } from '../database/pool.js';
import { importarReBradesco, LAYOUT_AUTO_ATIVAS, LAYOUT_RE_ATIVAS, LAYOUT_RE_ENCERRADAS } from '../seguradoras/bradesco/importacao/importacaoRe.service.js';
import { importarConsultaPortalPorto, LAYOUT_CONSULTA_PORTAL } from '../seguradoras/porto-seguro/importacao/importacaoConsultaPortal.service.js';
import { importarCanceladasTokio, LAYOUT_CANCELADAS } from '../seguradoras/tokio-marine/importacao/importacaoTokio.service.js';
import { recuperar } from '../services/arquivoAuditoria.service.js';
import { LAYOUTS_CARTEIRA_POR_CHAVE } from '../services/modelosCarteira.js';
import { gerarXlsx } from '../utils/xlsxEscrita.js';

const LAYOUTS = [LAYOUT_CONSULTA_PORTAL, LAYOUT_CANCELADAS, LAYOUT_RE_ATIVAS, LAYOUT_RE_ENCERRADAS, LAYOUT_AUTO_ATIVAS];

/** Roda o leitor da carga em simulação e devolve as linhas sem dono ("apólice · nome · …"). */
async function semDono(layout: string, grade: string[][], arquivo: string): Promise<string[]> {
  const r =
    layout === LAYOUT_CONSULTA_PORTAL
      ? await importarConsultaPortalPorto(grade, { arquivo, simular: true })
      : layout === LAYOUT_CANCELADAS
        ? await importarCanceladasTokio(grade, { arquivo, simular: true })
        : await importarReBradesco(grade, { layout: layout as typeof LAYOUT_RE_ATIVAS, arquivo, simular: true });
  const semCpf = 'consulta' in r ? r.consulta.semCpfLista : 'tokio' in r ? r.tokio.semCpf : r.re.semCpf;
  // Documento que não fecha o dígito é recusado e não está em lista nenhuma.
  const invalidos = r.pendencias
    .filter((p) => p.tipo === 'documento_invalido')
    .map((p) => `${p.apolice ?? ''} · ${p.nome ?? ''} · CPF/CNPJ inválido (${p.documento ?? ''})`);
  return [...semCpf, ...invalidos];
}

async function main(): Promise<void> {
  const i = process.argv.indexOf('--saida');
  const saida = i >= 0 ? process.argv[i + 1] : undefined;
  if (!saida) {
    console.error('\nUso: npm run db:conciliacao-cpf -- --saida <Apolices_sem_CPF.xlsx>\n');
    process.exitCode = 1;
    return;
  }

  const [cargas] = await pool.query<RowDataPacket[]>(
    `SELECT lote, nome_original, layout, seguradora, sha256, importado_em
       FROM arquivos_importados
      WHERE layout IN (?) AND desfeito_em IS NULL
      ORDER BY importado_em`,
    [LAYOUTS],
  );

  const grade: string[][] = [['Seguradora', 'Relatório', 'Arquivo', 'Importado em', 'Apólice', 'Segurado', 'Detalhe', 'Situação']];
  const vistos = new Set<string>();
  const porRelatorio = new Map<string, number>();
  for (const c of cargas) {
    if (vistos.has(String(c.sha256))) continue;
    vistos.add(String(c.sha256));
    const { conteudo } = await recuperar(String(c.lote));
    let pendentes: string[];
    try {
      pendentes = await semDono(String(c.layout), lerGrade(conteudo), String(c.nome_original));
    } catch (erro) {
      // "Nenhuma tem dono" chega como erro, sem a lista.
      grade.push([String(c.seguradora ?? ''), String(c.layout), String(c.nome_original), '', '', '', (erro as Error).message, 'carga inteira sem dono']);
      continue;
    }
    const relatorio = LAYOUTS_CARTEIRA_POR_CHAVE.get(String(c.layout))?.nome ?? String(c.layout);
    const quando = c.importado_em instanceof Date ? c.importado_em.toISOString().slice(0, 10).split('-').reverse().join('/') : '';
    for (const p of pendentes) {
      const [apolice = '', segurado = '', ...resto] = p.split(' · ');
      const situacao = /CPF\/CNPJ inválido/.test(p) ? 'CPF inválido — não entrou' : 'sem CPF — cadastrada sem cliente';
      grade.push([String(c.seguradora ?? ''), relatorio, String(c.nome_original), quando, apolice, segurado, resto.join(' · '), situacao]);
    }
    porRelatorio.set(relatorio, (porRelatorio.get(relatorio) ?? 0) + pendentes.length);
  }

  writeFileSync(saida, gerarXlsx(grade, 'Sem CPF'));
  console.log(`\n${grade.length - 1} apólices sem dono → ${saida}`);
  for (const [r, n] of porRelatorio) console.log(`  ${String(n).padStart(5)}  ${r}`);

  const j = process.argv.indexOf('--clientes-sem-dono');
  if (j >= 0 && process.argv[j + 1]) await clientesSemDono(process.argv[j + 1]!);
  console.log('');
}

/** Clientes sem dono de carteira (`produtor_id` vazio): nenhum corretor os enxerga. */
async function clientesSemDono(destino: string): Promise<void> {
  const [clientes] = await pool.query<RowDataPacket[]>(
    `SELECT c.nome, c.cpf_cnpj_numeros AS documento, st.nome AS situacao,
            GROUP_CONCAT(DISTINCT s.nome ORDER BY s.nome SEPARATOR ', ') AS seguradoras,
            GROUP_CONCAT(DISTINCT a.numero ORDER BY a.numero SEPARATOR ', ') AS apolices
       FROM clientes c
       JOIN situacoes_cliente st ON st.id = c.situacao_id
       LEFT JOIN apolices a ON a.cliente_id = c.id
       LEFT JOIN seguradoras s ON s.id = a.seguradora_id
      WHERE c.produtor_id IS NULL
      GROUP BY c.id
      ORDER BY c.nome`,
  );
  const grade: string[][] = [['Cliente', 'CPF/CNPJ', 'Situação', 'Seguradoras', 'Apólices']];
  for (const c of clientes) {
    grade.push([String(c.nome), String(c.documento), String(c.situacao), String(c.seguradoras ?? ''), String(c.apolices ?? '')]);
  }
  writeFileSync(destino, gerarXlsx(grade, 'Sem dono'));
  console.log(`\n${grade.length - 1} clientes sem dono de carteira → ${destino}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void encerrarPool());
