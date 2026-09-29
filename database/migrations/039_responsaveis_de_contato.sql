-- 039 — Responsáveis de contato de empresa (≠ segurados). A data de abertura de PJ
-- fica em `clientes.data_nascimento`. Telefone só com dígitos; nome e e-mail em caixa alta.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `responsaveis_contato` (
  `id`         BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED   NOT NULL,
  `ordem`      SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Ordem em que a tela mostra; o primeiro é o principal',

  `nome`     VARCHAR(150) NOT NULL,
  `cargo`    VARCHAR(80)  NULL COMMENT 'Função na empresa: financeiro, frota, sócio…',
  `telefone` VARCHAR(20)  NULL COMMENT 'Só dígitos, DDD incluso',
  `email`    VARCHAR(120) NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `ix_responsaveis_cliente` (`cliente_id`, `ordem`),
  CONSTRAINT `fk_responsaveis_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Pessoas de contato de cliente pessoa jurídica';
