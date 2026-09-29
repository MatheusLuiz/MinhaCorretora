-- 045 — Apólices encerradas que o Bradesco lista (sem CPF nem motivo), como lista.
-- `renovada_por_apolice_id` aponta a apólice nova do MESMO veículo (placa) começando perto do
-- fim desta; sem ela, "não renovou" e "nova ainda não importada" são indistinguíveis.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `apolices_encerradas` (
  `id`            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `seguradora_id` SMALLINT UNSIGNED NOT NULL,
  `numero_apolice` VARCHAR(40)      NOT NULL,
  `sucursal`      VARCHAR(10)  NULL,
  `nome_segurado` VARCHAR(150) NOT NULL,
  `placa`         VARCHAR(8)   NULL COMMENT 'Nula quando o portal escreve "AAVISAR" (zero km sem placa)',
  `teve_endosso`  TINYINT(1)   NULL,
  `emitida_em`      DATE NULL,
  `vigencia_inicio` DATE NULL,
  `vigencia_fim`    DATE NOT NULL,

  `apolice_id`     BIGINT UNSIGNED NULL,
  `cliente_id`     BIGINT UNSIGNED NULL,
  `vinculo_origem` ENUM('apolice','renovacao','nome') NULL
                   COMMENT 'apolice = pelo número; renovacao = pela apólice nova do mesmo veículo; nome = um cliente só com o nome',
  `renovada_por_apolice_id` BIGINT UNSIGNED NULL COMMENT 'Apólice nova do mesmo veículo, começando perto do fim desta',

  `origem_arquivo` VARCHAR(120) NULL,
  `origem_lote`    CHAR(36)     NULL,
  `importado_em`   DATETIME(3)  NULL,
  `criado_em`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_apolices_encerradas` (`seguradora_id`, `numero_apolice`, `vigencia_fim`),
  KEY `ix_apolices_encerradas_fim` (`vigencia_fim`),
  KEY `ix_apolices_encerradas_placa` (`placa`),
  KEY `ix_apolices_encerradas_apolice` (`apolice_id`),
  KEY `ix_apolices_encerradas_cliente` (`cliente_id`),
  KEY `ix_apolices_encerradas_lote` (`origem_lote`),
  CONSTRAINT `fk_apolices_encerradas_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`),
  CONSTRAINT `fk_apolices_encerradas_apolice` FOREIGN KEY (`apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_apolices_encerradas_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_apolices_encerradas_renovada` FOREIGN KEY (`renovada_por_apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Apólices encerradas, da lista da seguradora';

ALTER TABLE `arquivos_importados`
  MODIFY `entidade` ENUM('clientes','apolices','parcelas','comissoes','sinistros','renovacoes','encerradas') NOT NULL;
