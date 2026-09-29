-- 046 — Cotações por seguradora (situação em cotação → enviada → fechada/perdida) e os tipos
-- de seguro de interesse do cliente. Fechar NÃO cria apólice. Recorte pelo `produtor_id`.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `cliente_tipos_seguro` (
  `cliente_id`     BIGINT UNSIGNED   NOT NULL,
  `tipo_seguro_id` SMALLINT UNSIGNED NOT NULL,
  `criado_em`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`cliente_id`, `tipo_seguro_id`),
  KEY `ix_cliente_tipos_tipo` (`tipo_seguro_id`),
  CONSTRAINT `fk_cliente_tipos_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cliente_tipos_tipo` FOREIGN KEY (`tipo_seguro_id`)
    REFERENCES `tipos_seguro` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Tipos de seguro de interesse do cliente';

CREATE TABLE IF NOT EXISTS `cotacoes` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`        BINARY(16) NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1)),
  `cliente_id`  BIGINT UNSIGNED NOT NULL,
  `produtor_id` INT UNSIGNED NULL COMMENT 'O corretor da cotação — recorte de carteira',
  `criado_por`  BIGINT UNSIGNED NULL,

  `situacao` ENUM('em_cotacao','enviada','fechada','perdida') NOT NULL DEFAULT 'em_cotacao',
  `motivo_perda` VARCHAR(200)  NULL,
  `observacoes`  VARCHAR(1000) NULL,
  `encerrada_em` DATETIME(3)   NULL COMMENT 'Quando virou fechada ou perdida',

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cotacoes_uuid` (`uuid`),
  KEY `ix_cotacoes_cliente` (`cliente_id`),
  KEY `ix_cotacoes_produtor_situacao` (`produtor_id`, `situacao`),
  CONSTRAINT `fk_cotacoes_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cotacoes_produtor` FOREIGN KEY (`produtor_id`)
    REFERENCES `produtores` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cotacoes_usuario` FOREIGN KEY (`criado_por`)
    REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Cotações de seguro';

CREATE TABLE IF NOT EXISTS `cotacao_tipos` (
  `cotacao_id`     BIGINT UNSIGNED   NOT NULL,
  `tipo_seguro_id` SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (`cotacao_id`, `tipo_seguro_id`),
  CONSTRAINT `fk_cotacao_tipos_cotacao` FOREIGN KEY (`cotacao_id`)
    REFERENCES `cotacoes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cotacao_tipos_tipo` FOREIGN KEY (`tipo_seguro_id`)
    REFERENCES `tipos_seguro` (`id`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Tipos de seguro cotados';

-- As mesmas colunas centrais de `apolice_veiculos`.
CREATE TABLE IF NOT EXISTS `cotacao_veiculos` (
  `cotacao_id`     BIGINT UNSIGNED NOT NULL,
  `placa`          VARCHAR(8)   NULL,
  `chassi`         VARCHAR(20)  NULL,
  `fabricante`     VARCHAR(60)  NULL,
  `modelo`         VARCHAR(120) NULL,
  `ano_fabricacao` SMALLINT UNSIGNED NULL,
  `ano_modelo`     SMALLINT UNSIGNED NULL,
  `codigo_fipe`    VARCHAR(10)  NULL,
  `uso`            VARCHAR(60)  NULL,
  `zero_km`        TINYINT(1)   NULL,
  `cep_pernoite`   CHAR(8)      NULL,
  `condutor_nome`       VARCHAR(150) NULL,
  `condutor_documento`  VARCHAR(14)  NULL,
  `condutor_nascimento` DATE         NULL,
  PRIMARY KEY (`cotacao_id`),
  KEY `ix_cotacao_veiculos_placa` (`placa`),
  CONSTRAINT `fk_cotacao_veiculos_cotacao` FOREIGN KEY (`cotacao_id`)
    REFERENCES `cotacoes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Veículo da cotação';

-- O que cada seguradora ofereceu, por tipo. `escolhida` marca a que fechou.
CREATE TABLE IF NOT EXISTS `cotacao_propostas` (
  `id`             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `cotacao_id`     BIGINT UNSIGNED   NOT NULL,
  `seguradora_id`  SMALLINT UNSIGNED NOT NULL,
  `tipo_seguro_id` SMALLINT UNSIGNED NOT NULL,
  `premio`         DECIMAL(15,2) NOT NULL,
  `franquia`       DECIMAL(15,2) NULL,
  `forma_pagamento` VARCHAR(80)  NULL,
  `observacao`     VARCHAR(300)  NULL,
  `escolhida`      TINYINT(1)    NOT NULL DEFAULT 0,
  `criado_em`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_cotacao_propostas_cotacao` (`cotacao_id`),
  CONSTRAINT `fk_cotacao_propostas_cotacao` FOREIGN KEY (`cotacao_id`)
    REFERENCES `cotacoes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cotacao_propostas_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`),
  CONSTRAINT `fk_cotacao_propostas_tipo` FOREIGN KEY (`tipo_seguro_id`)
    REFERENCES `tipos_seguro` (`id`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Proposta de cada seguradora numa cotação';
