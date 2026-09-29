-- 049 — Histórico de atendimento do cliente (WhatsApp, e-mail, carta, ligação).
-- `resultado` separa contato tentado de feito; `proximo_contato` é o combinado;
-- `usuario_id` é quem registrou. Sem `origem_lote`: é digitação, nunca carga.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `atendimentos` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`            BINARY(16) NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1)),
  `cliente_id`      BIGINT UNSIGNED NOT NULL,
  `usuario_id`      BIGINT UNSIGNED NOT NULL COMMENT 'Quem registrou o contato',
  `canal`           ENUM('whatsapp','email','carta','ligacao') NOT NULL,
  `motivo`          ENUM('inadimplencia','novo_cliente','renovacao','outro') NOT NULL,
  `resultado`       ENUM('contato_feito','sem_resposta','retornar','recusou','enviado') NOT NULL
                    COMMENT '"enviado" = carta/e-mail/mensagem saiu, sem resposta ainda',
  `descricao`       VARCHAR(2000) NULL,
  `contato_em`      DATETIME(3) NOT NULL COMMENT 'Quando o contato aconteceu (pode ser antes do registro)',
  `proximo_contato` DATE NULL COMMENT 'O combinado: quando falar de novo',
  `apolice_id`      BIGINT UNSIGNED NULL COMMENT 'A apólice do assunto, quando houver',
  `criado_em`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_atendimentos_uuid` (`uuid`),
  KEY `ix_atendimentos_cliente` (`cliente_id`, `contato_em`),
  KEY `ix_atendimentos_proximo` (`proximo_contato`),
  KEY `ix_atendimentos_usuario` (`usuario_id`),
  KEY `ix_atendimentos_apolice` (`apolice_id`),
  CONSTRAINT `fk_atendimentos_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_atendimentos_usuario` FOREIGN KEY (`usuario_id`)
    REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_atendimentos_apolice` FOREIGN KEY (`apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Histórico de atendimento do cliente (contatos registrados à mão)';
