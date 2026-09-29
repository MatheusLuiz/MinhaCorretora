-- 010 — Parcelas (cobrança parcela a parcela) e comissões (demonstrativo pago pela seguradora,
-- agregado por filial e data de crédito — NÃO é comissão por apólice).

USE `minhacorretora_bi`;

-- Parcelas
CREATE TABLE IF NOT EXISTS `parcelas` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `apolice_id` BIGINT UNSIGNED NOT NULL,

  -- Um endosso gera a própria cobrança: a "parcela 1" pode existir em duas emissões.
  `sequencia_emissao` INT UNSIGNED NOT NULL DEFAULT 1,
  `numero`            SMALLINT UNSIGNED NOT NULL COMMENT 'Número da parcela',

  `vencimento`          DATE NULL,
  -- Separado do vencimento atual: a diferença mostra o reagendamento.
  `vencimento_original` DATE NULL,

  `valor` DECIMAL(15,2) NULL,
  `iof`   DECIMAL(15,2) NULL,

  `forma_pagamento` VARCHAR(40) NULL COMMENT 'Débito em conta, boleto, cartão...',

  -- `outro`: status desconhecido não faz perder a linha.
  `status`        ENUM('atrasado','pago','aberto','cancelado','outro') NOT NULL DEFAULT 'outro',
  `status_origem` VARCHAR(40) NULL COMMENT 'Como a seguradora chamou este status',

  `motivo_rejeicao` VARCHAR(120) NULL,
  `data_rejeicao`   DATE NULL,

  `origem_sistema` ENUM('seguradora','manual') NOT NULL DEFAULT 'seguradora',
  `origem_arquivo` VARCHAR(120) NULL,
  `origem_lote`    CHAR(36) NULL,
  `importado_em`   DATETIME(3) NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- Chave natural: reimportar atualiza em vez de duplicar.
  UNIQUE KEY `uq_parcela` (`apolice_id`, `sequencia_emissao`, `numero`),
  KEY `ix_parcelas_status` (`status`),
  KEY `ix_parcelas_vencimento` (`vencimento`),
  CONSTRAINT `fk_parcelas_apolice` FOREIGN KEY (`apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Cobrança das apólices, parcela a parcela';

-- Comissões: uma linha por crédito do demonstrativo, com as colunas do arquivo.
CREATE TABLE IF NOT EXISTS `comissoes` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `seguradora_id` SMALLINT UNSIGNED NOT NULL,

  `competencia` CHAR(7) NOT NULL COMMENT 'AAAA-MM do demonstrativo',

  `corretora`          VARCHAR(120) NULL,
  `filial`             VARCHAR(80)  NULL COMMENT 'Como no demonstrativo: CURITIBA, Batel...',
  `codigo_cliente`     VARCHAR(20)  NULL COMMENT 'Código da corretora na seguradora',
  `codigo_estabelecimento` VARCHAR(20) NULL,

  -- O "Nr." do demonstrativo; com filial e competência, forma a chave natural.
  `numero` VARCHAR(20) NOT NULL,
  `tipo`   VARCHAR(40) NULL COMMENT 'Corretagem, agenciamento...',

  `total_bruto`   DECIMAL(15,2) NULL,
  `desconto`      DECIMAL(15,2) NULL,
  `impostos`      DECIMAL(15,2) NULL,
  `total_liquido` DECIMAL(15,2) NULL,

  `pago_em`         DATE NULL,
  `forma_pagamento` VARCHAR(40) NULL,

  `origem_arquivo` VARCHAR(120) NULL,
  `origem_lote`    CHAR(36) NULL,
  `importado_em`   DATETIME(3) NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comissao` (`seguradora_id`, `competencia`, `codigo_estabelecimento`, `numero`),
  KEY `ix_comissoes_competencia` (`competencia`),
  KEY `ix_comissoes_pago` (`pago_em`),
  CONSTRAINT `fk_comissoes_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Demonstrativos de comissão pagos pelas seguradoras';

-- Parcelas atrasadas com o cliente, quando há. Apólice sem dono aparece com `cliente_id` nulo.
CREATE OR REPLACE VIEW `vw_inadimplencia` AS
SELECT
  a.`cliente_id`,
  a.`id`   AS `apolice_id`,
  a.`numero` AS `apolice`,
  a.`nome_segurado`,
  s.`nome` AS `seguradora`,
  p.`nome` AS `produto`,
  pa.`numero` AS `parcela`,
  pa.`vencimento`,
  pa.`valor`,
  pa.`forma_pagamento`,
  pa.`motivo_rejeicao`,
  DATEDIFF(CURDATE(), pa.`vencimento`) AS `dias_em_atraso`
FROM `parcelas` pa
JOIN `apolices` a    ON a.`id` = pa.`apolice_id`
JOIN `seguradoras` s ON s.`id` = a.`seguradora_id`
LEFT JOIN `produtos` p ON p.`id` = a.`produto_id`
WHERE pa.`status` = 'atrasado';
