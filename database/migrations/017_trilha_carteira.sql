-- 017 — Histórico de quem mudou a carteira (`usuario_produtores`) de um usuário: a lista
-- COMPLETA a cada mudança, já que a tela apaga e reinsere a ligação.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `usuario_produtores_historico` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario_id` BIGINT UNSIGNED NOT NULL,

  -- Foto, não diferença: reconstruir por diferenças falha com qualquer buraco.
  `produtores` JSON NOT NULL,
  `quantidade` SMALLINT UNSIGNED NOT NULL
    COMMENT 'Tamanho da lista, para consultar sem abrir o JSON',

  `alterado_por` BIGINT UNSIGNED NULL
    COMMENT 'NULL quando veio de script de linha de comando, onde não há sessão',
  `alterado_em`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `ix_carteira_hist_usuario` (`usuario_id`, `alterado_em`),

  CONSTRAINT `fk_carteira_hist_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,

  -- SET NULL: apagar o autor não apaga o registro da mudança.
  CONSTRAINT `fk_carteira_hist_autor`
    FOREIGN KEY (`alterado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  COMMENT='Histórico das carteiras atribuídas — quem mexeu, quando, e no quê';
