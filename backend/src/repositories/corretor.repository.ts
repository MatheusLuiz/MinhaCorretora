import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { uuidParaBinario } from '../utils/uuid.js';

// O cadastro guarda o PRODUTOR (é por ele o recorte de carteira); o usuário VIRA produtor na 1ª vez que é corretor.

export interface Corretor {
  /** uuid do usuário — o que a API expõe. */
  id: string;
  nome: string;
}

/** Quem pode ser corretor: usuário ativo que cadastra cliente (`clientes.gerenciar`). */
export async function listar(): Promise<Corretor[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT BIN_TO_UUID(u.uuid, 1) AS id, u.nome
       FROM usuarios u
      WHERE u.ativo = 1
        AND EXISTS (SELECT 1 FROM vw_permissoes_efetivas v
                     WHERE v.usuario_id = u.id AND v.permissao = 'clientes.gerenciar')
      ORDER BY u.nome`,
  );
  return linhas.map((l) => ({ id: String(l.id), nome: String(l.nome) }));
}

/** O produtor do usuário, criado e ligado se faltar; reaproveita produtor sem dono de mesmo nome (não parte a carteira). */
export async function produtorDoUsuario(usuarioUuid: string): Promise<{ produtorId: number; nome: string } | null> {
  const [[usuario]] = await pool.execute<RowDataPacket[]>(
    'SELECT id, nome FROM usuarios WHERE uuid = ? AND ativo = 1',
    [uuidParaBinario(usuarioUuid)],
  );
  if (!usuario) return null;

  const [[ligado]] = await pool.execute<RowDataPacket[]>(
    `SELECT up.produtor_id, p.nome
       FROM usuario_produtores up
       JOIN produtores p ON p.id = up.produtor_id
      WHERE up.usuario_id = ?
      ORDER BY up.criado_em, up.produtor_id
      LIMIT 1`,
    [usuario.id],
  );
  if (ligado) return { produtorId: Number(ligado.produtor_id), nome: String(ligado.nome) };

  const nome = String(usuario.nome).trim();
  await pool.execute(
    'INSERT INTO produtores (nome) VALUES (?) ON DUPLICATE KEY UPDATE id = id',
    [nome],
  );
  const [[produtor]] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM produtores WHERE nome = ?',
    [nome],
  );
  await pool.execute(
    'INSERT IGNORE INTO usuario_produtores (usuario_id, produtor_id) VALUES (?, ?)',
    [usuario.id, produtor!.id],
  );

  return { produtorId: Number(produtor!.id), nome };
}
