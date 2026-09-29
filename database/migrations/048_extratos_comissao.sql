-- 048 — Extrato de pagamentos do portal (uma linha por ORDEM), referência da Conciliação.
-- NÃO soma com `comissoes`: é o espelho do lado da companhia. Chave: seguradora + ordem.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `extratos_comissao` (
  `id`            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `seguradora_id` SMALLINT UNSIGNED NOT NULL,
  `numero_ordem`  VARCHAR(20)       NOT NULL COMMENT 'Só dígitos, como a conferência compara com comissoes.numero',

  `pago_em`     DATE    NULL,
  `competencia` CHAR(7) NULL COMMENT 'AAAA-MM do pagamento',

  `total_bruto`   DECIMAL(15,2) NULL,
  `inss`          DECIMAL(15,2) NULL COMMENT 'Nulo quando o extrato não traz a coluna',
  `irrf`          DECIMAL(15,2) NULL,
  `iss`           DECIMAL(15,2) NULL,
  `total_liquido` DECIMAL(15,2) NULL,

  `origem_arquivo` VARCHAR(120) NULL,
  `origem_lote`    CHAR(36)     NULL,
  `importado_em`   DATETIME(3)  NULL,
  `criado_em`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_extratos_comissao` (`seguradora_id`, `numero_ordem`),
  KEY `ix_extratos_comissao_competencia` (`competencia`),
  KEY `ix_extratos_comissao_lote` (`origem_lote`),
  CONSTRAINT `fk_extratos_comissao_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Ordens de pagamento do extrato do portal, para a conciliação';
