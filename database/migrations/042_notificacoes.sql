-- 042 — Notificações (sino): aviso ao corretor no PRIMEIRO atraso do cliente. `chave` impede
-- repetir o aviso; CASCADE na parcela apaga o aviso quando a carga é desfeita.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `notificacoes` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`       BINARY(16) NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1)),
  `usuario_id` BIGINT UNSIGNED NOT NULL,

  `tipo`     VARCHAR(40)  NOT NULL COMMENT 'primeira_parcela_atrasada, …',
  `chave`    VARCHAR(120) NOT NULL COMMENT 'Deduplicação: o mesmo aviso não se repete',
  `titulo`   VARCHAR(150) NOT NULL,
  `mensagem` VARCHAR(500) NOT NULL,

  `cliente_id` BIGINT UNSIGNED NULL,
  `parcela_id` BIGINT UNSIGNED NULL,

  `criada_em`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lida_em`          DATETIME(3) NULL,
  `email_enviado_em` DATETIME(3) NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notificacoes_uuid` (`uuid`),
  UNIQUE KEY `uq_notificacoes_usuario_chave` (`usuario_id`, `chave`),
  KEY `ix_notificacoes_caixa` (`usuario_id`, `lida_em`, `criada_em`),
  CONSTRAINT `fk_notificacoes_usuario` FOREIGN KEY (`usuario_id`)
    REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notificacoes_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notificacoes_parcela` FOREIGN KEY (`parcela_id`)
    REFERENCES `parcelas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Avisos para o usuário: sino do topo e, com SMTP, e-mail';
