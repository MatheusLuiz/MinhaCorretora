-- 035 — Sinistros e assistências, um acionamento por linha. `tipo` separa assistência (não é
-- sinistro). `numero_apolice` em texto; o vínculo é refeito a cada carga. Dados do terceiro
-- ficam fora de propósito. Sem valor pago (o relatório só traz reserva).

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `sinistros` (
  `id`            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `seguradora_id` SMALLINT UNSIGNED NOT NULL,
  `numero`        VARCHAR(30)       NOT NULL COMMENT 'Nº do sinistro na companhia',

  `numero_apolice` VARCHAR(40)      NOT NULL,
  `apolice_id`     BIGINT UNSIGNED  NULL,
  `cliente_id`     BIGINT UNSIGNED  NULL,
  -- `apolice`: pelo número, exato. `nome`: casou com UM cliente só — revisável.
  `vinculo_origem` ENUM('apolice','nome') NULL,
  `nome_sinistrado` VARCHAR(150)    NULL,

  `tipo` ENUM('sinistro','assistencia') NOT NULL,
  `ramo`      VARCHAR(80)  NULL,
  `cobertura` VARCHAR(120) NULL,
  `causa`     VARCHAR(120) NULL,

  `ocorrido_em`   DATE NULL,
  `comunicado_em` DATE NULL,

  -- Os dois status divergem (processo "Em análise" × movimento "Liquidado").
  `status_processo`  VARCHAR(40) NULL,
  `status_movimento` VARCHAR(40) NULL,

  `reserva`    DECIMAL(15,2) NULL COMMENT 'Valor reservado para o sinistro em aberto',
  `reserva_ro` DECIMAL(15,2) NULL COMMENT 'Coluna "Reserva R.O" da Suhai; guardada como veio',

  -- Do SEGURADO, não do terceiro.
  `placa`   VARCHAR(10)  NULL,
  `veiculo` VARCHAR(150) NULL,

  `origem_arquivo` VARCHAR(120) NULL,
  `origem_lote`    CHAR(36)     NULL,
  `importado_em`   DATETIME(3)  NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- Reimportar atualiza o status, não duplica.
  UNIQUE KEY `uq_sinistro` (`seguradora_id`, `numero`),
  KEY `ix_sinistros_apolice` (`apolice_id`),
  KEY `ix_sinistros_cliente` (`cliente_id`),
  KEY `ix_sinistros_numero_apolice` (`seguradora_id`, `numero_apolice`),
  KEY `ix_sinistros_ocorrido` (`ocorrido_em`),
  KEY `ix_sinistros_lote` (`origem_lote`),
  CONSTRAINT `fk_sinistros_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`),
  CONSTRAINT `fk_sinistros_apolice` FOREIGN KEY (`apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sinistros_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Sinistros e assistências, um acionamento por linha';

-- A auditoria de importação passa a conhecer a entidade nova.
ALTER TABLE `arquivos_importados`
  MODIFY `entidade` ENUM('clientes','apolices','parcelas','comissoes','sinistros') NOT NULL;
