-- 004 — Redefinição de senha por link no e-mail. O token é gravado só como SHA-256.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `tokens_redefinicao_senha` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario_id` BIGINT UNSIGNED NOT NULL,

  `token_hash` BINARY(32) NOT NULL COMMENT 'SHA-256 do token que foi para o e-mail',

  `expira_em`  DATETIME(3) NOT NULL COMMENT 'Janela curta: o link vale minutos, não dias',

  -- Uso único.
  `usado_em`   DATETIME(3) NULL,

  -- Token descartado sem uso (pedido novo ou redefinição concluída).
  `invalidado_em`     DATETIME(3) NULL,
  `motivo_invalidacao` ENUM('substituido','senha_redefinida','admin') NULL,

  -- IP/user-agent de quem pediu e de quem usou o link.
  `ip_solicitacao`         VARBINARY(16) NULL,
  `user_agent_solicitacao` VARCHAR(255)  NULL,
  `ip_uso`                 VARBINARY(16) NULL,

  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trs_token_hash` (`token_hash`),
  -- Pendentes de um usuário e contagem por janela de tempo (limite por conta).
  KEY `ix_trs_usuario_data` (`usuario_id`, `criado_em`),
  KEY `ix_trs_expira` (`expira_em`),
  CONSTRAINT `fk_trs_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  COMMENT='Tokens de uso único do fluxo "esqueci minha senha"';
