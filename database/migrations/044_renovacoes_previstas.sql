-- 044 — Lista de apólices a renovar do Bradesco (única fonte do % de comissão dele). Entra como
-- renovação, não apólice (sem CPF, duplicaria). Vínculo refeito a cada carga: pela apólice,
-- senão pelo nome com UM cliente. Chave: seguradora + apólice + fim de vigência.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `renovacoes_previstas` (
  `id`            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `seguradora_id` SMALLINT UNSIGNED NOT NULL,
  `numero_apolice` VARCHAR(40)      NOT NULL COMMENT 'Como veio; o vínculo com apolices é refeito a cada carga',
  `vigencia_fim`   DATE             NOT NULL,

  `apolice_id`     BIGINT UNSIGNED NULL,
  `cliente_id`     BIGINT UNSIGNED NULL,
  `vinculo_origem` ENUM('apolice','nome') NULL,

  `nome_segurado`  VARCHAR(150) NOT NULL,
  `sucursal`       VARCHAR(10)  NULL,
  `agencia`        VARCHAR(10)  NULL,
  `percentual_comissao` DECIMAL(6,2) NULL COMMENT 'Comissão da apólice que vence, em %',
  `veiculo`        VARCHAR(120) NULL COMMENT 'Cortado pelo portal (termina em "...")',
  `placa`          VARCHAR(8)   NULL,
  `sinistros`      SMALLINT UNSIGNED NULL,
  `classe_bonus`   SMALLINT UNSIGNED NULL,
  `premio_renovacao` DECIMAL(15,2) NULL COMMENT 'Prêmio calculado pela companhia; nulo quando o portal não calculou',
  `cotado_outro_corretor` TINYINT(1) NULL COMMENT '"Ind *": segurado cotado por outro corretor nos últimos 7 dias',
  `tem_residencial` TINYINT(1) NULL COMMENT '"Resid.": tem seguro residencial junto',

  `origem_arquivo` VARCHAR(120) NULL,
  `origem_lote`    CHAR(36)     NULL,
  `importado_em`   DATETIME(3)  NULL,
  `criado_em`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_renovacoes_previstas` (`seguradora_id`, `numero_apolice`, `vigencia_fim`),
  KEY `ix_renovacoes_previstas_fim` (`vigencia_fim`),
  KEY `ix_renovacoes_previstas_apolice` (`apolice_id`),
  KEY `ix_renovacoes_previstas_cliente` (`cliente_id`),
  KEY `ix_renovacoes_previstas_lote` (`origem_lote`),
  CONSTRAINT `fk_renovacoes_previstas_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`),
  CONSTRAINT `fk_renovacoes_previstas_apolice` FOREIGN KEY (`apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_renovacoes_previstas_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Apólices a renovar, da lista da seguradora';

ALTER TABLE `arquivos_importados`
  MODIFY `entidade` ENUM('clientes','apolices','parcelas','comissoes','sinistros','renovacoes') NOT NULL;
