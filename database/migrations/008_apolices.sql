-- 008 — Apólices e seus movimentos. O relatório da seguradora é de MOVIMENTOS (apólice,
-- endosso, fatura): `apolices` guarda a identidade, `apolice_movimentos` cada emissão.
-- `cliente_id` é nulo quando não há documento: casar por nome penduraria na pessoa errada.

USE `minhacorretora_bi`;

-- Produtos: únicos por (seguradora, nome).
CREATE TABLE IF NOT EXISTS `produtos` (
  `id`            SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `seguradora_id` SMALLINT UNSIGNED NULL,
  `nome`          VARCHAR(120) NOT NULL,
  -- O arquivo traz o nome comercial, não o ramo SUSEP: preenchido depois.
  `ramo_id`       SMALLINT UNSIGNED NULL,
  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_produtos_seguradora_nome` (`seguradora_id`, `nome`),
  KEY `ix_produtos_nome` (`nome`),
  CONSTRAINT `fk_produtos_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_produtos_ramo` FOREIGN KEY (`ramo_id`)
    REFERENCES `ramos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Produtos comerciais das seguradoras';

-- Apólices
CREATE TABLE IF NOT EXISTS `apolices` (
  `id`   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` BINARY(16) NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1))
         COMMENT 'Identificador público, como em usuários e clientes',

  `seguradora_id` SMALLINT UNSIGNED NOT NULL,
  `numero`        VARCHAR(40) NOT NULL,
  `produto_id`    SMALLINT UNSIGNED NULL,

  -- --- Quem é o segurado ---------------------------------------------------
  `cliente_id`    BIGINT UNSIGNED NULL
                  COMMENT 'NULO enquanto não houver vínculo confiável',
  `nome_segurado` VARCHAR(150) NOT NULL
                  COMMENT 'Como veio na origem — a única identificação quando não há CPF',
  `documento_segurado` VARCHAR(14) NULL
                  COMMENT 'Só dígitos, quando a seguradora exportar',

  -- Como o vínculo com o cliente foi feito (para revisar os feitos por nome).
  `vinculo_origem` ENUM('documento','nome','manual') NULL,
  `vinculo_em`     DATETIME(3) NULL,

  -- --- Cabeçalho, DERIVADO dos movimentos ----------------------------------
  -- Do movimento `apolice`; sem ele, do endosso. FATURA NUNCA (sua vigência é o mês cobrado).
  `emitida_em`      DATE NULL,
  `vigencia_inicio` DATE NULL,
  `vigencia_fim`    DATE NULL,

  `premio_total`   DECIMAL(15,2) NULL COMMENT 'Só do movimento tipo apolice; nulo se ele não veio',
  `premio_liquido` DECIMAL(15,2) NULL,

  -- --- Procedência ---------------------------------------------------------
  `origem_sistema` ENUM('seguradora','manual') NOT NULL,
  `origem_arquivo` VARCHAR(120) NULL,
  `origem_lote`    CHAR(36) NULL,
  `importado_em`   DATETIME(3) NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_apolices_uuid` (`uuid`),
  -- O número só é único DENTRO da seguradora.
  UNIQUE KEY `uq_apolices_seguradora_numero` (`seguradora_id`, `numero`),
  KEY `ix_apolices_cliente`   (`cliente_id`),
  KEY `ix_apolices_segurado`  (`nome_segurado`),
  KEY `ix_apolices_documento` (`documento_segurado`),
  KEY `ix_apolices_vigencia`  (`vigencia_fim`),
  KEY `ix_apolices_produto`   (`produto_id`),
  KEY `ix_apolices_lote`      (`origem_lote`),
  CONSTRAINT `fk_apolices_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_apolices_produto` FOREIGN KEY (`produto_id`)
    REFERENCES `produtos` (`id`) ON DELETE SET NULL,
  -- SET NULL: apagar o cliente não apaga a apólice.
  CONSTRAINT `fk_apolices_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Apólices, com ou sem cliente vinculado';

-- Movimentos: uma linha por emissão do relatório.
CREATE TABLE IF NOT EXISTS `apolice_movimentos` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `apolice_id` BIGINT UNSIGNED NOT NULL,

  -- O campo "Emissão" do relatório (fatura mensal chega 51, 52, 53).
  `sequencia` INT UNSIGNED NOT NULL,

  -- `outro`: tipo desconhecido, com o texto original ao lado, em vez de recusar a linha.
  `tipo`        ENUM('apolice','endosso','fatura','cancelamento','outro') NOT NULL,
  `tipo_origem` VARCHAR(40) NULL COMMENT 'Como a seguradora chamou este movimento',

  `emitida_em`      DATE NULL,
  `vigencia_inicio` DATE NULL COMMENT 'Na fatura, é a competência cobrada — não a vigência da apólice',
  `vigencia_fim`    DATE NULL,

  `premio_total`   DECIMAL(15,2) NULL,
  `premio_liquido` DECIMAL(15,2) NULL,

  `origem_lote`  CHAR(36) NULL,
  `importado_em` DATETIME(3) NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- `tipo` na chave: numeração de endosso e de fatura podem se cruzar.
  UNIQUE KEY `uq_movimento_apolice_seq_tipo` (`apolice_id`, `sequencia`, `tipo`),
  KEY `ix_movimentos_tipo` (`tipo`),
  KEY `ix_movimentos_emissao` (`emitida_em`),
  CONSTRAINT `fk_movimentos_apolice` FOREIGN KEY (`apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Cada emissão informada pela seguradora';

-- Apólices sem cliente, com quantos clientes têm aquele nome
-- (0 = cadastrar; 1 = provável, confirmar; > 1 = homônimos, só o documento resolve).
CREATE OR REPLACE VIEW `vw_apolices_sem_cliente` AS
SELECT
  a.`id`,
  a.`uuid`,
  a.`numero`,
  a.`nome_segurado`,
  s.`nome` AS `seguradora`,
  p.`nome` AS `produto`,
  a.`vigencia_inicio`,
  a.`vigencia_fim`,
  a.`premio_total`,
  (SELECT COUNT(*) FROM `clientes` c WHERE c.`nome` = a.`nome_segurado`) AS `candidatos`
FROM `apolices` a
JOIN `seguradoras` s ON s.`id` = a.`seguradora_id`
LEFT JOIN `produtos` p ON p.`id` = a.`produto_id`
WHERE a.`cliente_id` IS NULL;
