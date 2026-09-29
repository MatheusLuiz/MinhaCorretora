import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { uuidParaBinario } from '../utils/uuid.js';

// Primeiro atraso = EXATAMENTE uma parcela em atraso no cliente (régua da vw_inadimplencia); com duas é da cobrança.

/** Condição de "esta é a única parcela em atraso do cliente". */
const UNICO_ATRASO_DO_CLIENTE = `(
  SELECT COUNT(*)
    FROM parcelas p2
    JOIN apolices a2 ON a2.id = p2.apolice_id
   WHERE a2.cliente_id = a.cliente_id
     AND p2.status = 'atrasado'
) = 1`;

/** Aviso de primeiro atraso ao corretor do cadastro e a quem tem `notificacoes.atrasos`; `INSERT IGNORE` não duplica. */
export async function gerarPrimeiroAtraso(): Promise<number> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO notificacoes
            (usuario_id, tipo, chave, titulo, mensagem, cliente_id, parcela_id)
     SELECT u.id,
            'primeira_parcela_atrasada',
            CONCAT('primeira_parcela:', p.id),
            LEFT(CONCAT('Primeiro atraso: ', c.nome), 150),
            LEFT(CONCAT(
              'Parcela ', p.numero, ' da apólice ', a.numero, ' (', s.nome, ')',
              IF(p.valor IS NULL, '', CONCAT(', R$ ', FORMAT(p.valor, 2, 'pt_BR'))),
              IF(p.vencimento IS NULL, '', CONCAT(', venceu em ', DATE_FORMAT(p.vencimento, '%d/%m/%Y'))),
              '. É o primeiro atraso do cliente — ligue antes que vire cobrança.'
            ), 500),
            c.id,
            p.id
       FROM parcelas p
       JOIN apolices a            ON a.id = p.apolice_id
       JOIN seguradoras s         ON s.id = a.seguradora_id
       JOIN clientes c            ON c.id = a.cliente_id
       JOIN usuarios u
         ON u.ativo = 1
        AND (
              EXISTS (SELECT 1 FROM usuario_produtores up
                       WHERE up.usuario_id = u.id AND up.produtor_id = c.produtor_id)
           OR EXISTS (SELECT 1 FROM vw_permissoes_efetivas pe
                       WHERE pe.usuario_id = u.id AND pe.permissao = 'notificacoes.atrasos')
            )
      WHERE p.status = 'atrasado'
        AND ${UNICO_ATRASO_DO_CLIENTE}`,
  );

  return r.affectedRows;
}

/** Primeiro atraso sem nenhum usuário ativo destinatário — sai no resultado da importação para não sumir. */
export async function primeiroAtrasoSemDestinatario(): Promise<number> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT a.cliente_id) AS n
       FROM parcelas p
       JOIN apolices a ON a.id = p.apolice_id
       JOIN clientes c ON c.id = a.cliente_id
      WHERE p.status = 'atrasado'
        AND ${UNICO_ATRASO_DO_CLIENTE}
        AND NOT EXISTS (
              SELECT 1
                FROM usuario_produtores up
                JOIN usuarios u ON u.id = up.usuario_id AND u.ativo = 1
               WHERE up.produtor_id = c.produtor_id
            )`,
  );

  return Number(linhas[0]?.n ?? 0);
}

export interface NotificacaoParaEmail extends RowDataPacket {
  id: number;
  email: string;
  nome: string;
  titulo: string;
  mensagem: string;
}

/** Avisos ainda não enviados por e-mail, das últimas 24 horas. */
export async function pendentesDeEmail(): Promise<NotificacaoParaEmail[]> {
  const [linhas] = await pool.query<NotificacaoParaEmail[]>(
    `SELECT n.id, u.email, u.nome, n.titulo, n.mensagem
       FROM notificacoes n
       JOIN usuarios u ON u.id = n.usuario_id AND u.ativo = 1
      WHERE n.email_enviado_em IS NULL
        AND n.criada_em >= NOW() - INTERVAL 1 DAY
      ORDER BY n.id
      LIMIT 500`,
  );
  return linhas;
}

export async function marcarEmailEnviado(id: number): Promise<void> {
  await pool.execute('UPDATE notificacoes SET email_enviado_em = CURRENT_TIMESTAMP(3) WHERE id = ?', [id]);
}

export interface NotificacaoLinha extends RowDataPacket {
  uuid: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  criada_em: Date;
  lida_em: Date | null;
  cliente_uuid: string | null;
}

/** A caixa do usuário: as mais recentes primeiro, e quantas faltam ler. */
export async function listarDoUsuario(
  usuarioUuid: string,
  limite: number,
): Promise<{ notificacoes: NotificacaoLinha[]; naoLidas: number }> {
  const usuario = uuidParaBinario(usuarioUuid);

  const [[notificacoes], [contagem]] = await Promise.all([
    pool.query<NotificacaoLinha[]>(
      `SELECT BIN_TO_UUID(n.uuid, 1) AS uuid, n.tipo, n.titulo, n.mensagem,
              n.criada_em, n.lida_em,
              BIN_TO_UUID(c.uuid, 1) AS cliente_uuid
         FROM notificacoes n
         JOIN usuarios u      ON u.id = n.usuario_id
         LEFT JOIN clientes c ON c.id = n.cliente_id
        WHERE u.uuid = ?
        ORDER BY n.criada_em DESC, n.id DESC
        LIMIT ?`,
      [usuario, limite],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n
         FROM notificacoes n
         JOIN usuarios u ON u.id = n.usuario_id
        WHERE u.uuid = ? AND n.lida_em IS NULL`,
      [usuario],
    ),
  ]);

  return { notificacoes, naoLidas: Number(contagem[0]?.n ?? 0) };
}

/** Marca como lida — só se a notificação for DESTE usuário. */
export async function marcarLida(usuarioUuid: string, notificacaoUuid: string): Promise<void> {
  await pool.execute(
    `UPDATE notificacoes n
       JOIN usuarios u ON u.id = n.usuario_id
        SET n.lida_em = COALESCE(n.lida_em, CURRENT_TIMESTAMP(3))
      WHERE u.uuid = ? AND n.uuid = ?`,
    [uuidParaBinario(usuarioUuid), uuidParaBinario(notificacaoUuid)],
  );
}

export async function marcarTodasLidas(usuarioUuid: string): Promise<void> {
  await pool.execute(
    `UPDATE notificacoes n
       JOIN usuarios u ON u.id = n.usuario_id
        SET n.lida_em = CURRENT_TIMESTAMP(3)
      WHERE u.uuid = ? AND n.lida_em IS NULL`,
    [uuidParaBinario(usuarioUuid)],
  );
}
