-- 057 — Grupos de cliente viram cadastro (Corretora; Seguradora = encaminhado pela companhia).
-- `clientes.carteira_comercial` guarda a CHAVE (estável); a tela mostra o NOME.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `grupos_cliente` (
  `id`                SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chave`             VARCHAR(40)  NOT NULL COMMENT 'Estável: é o valor de clientes.carteira_comercial',
  `nome`              VARCHAR(60)  NOT NULL,
  `descricao`         VARCHAR(200) NULL,
  `ativo`             TINYINT(1)   NOT NULL DEFAULT 1,
  `ordem`             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `criado_em`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grupos_cliente_chave` (`chave`),
  UNIQUE KEY `uq_grupos_cliente_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Grupos de cliente (carteira comercial)';

INSERT IGNORE INTO `grupos_cliente` (`chave`, `nome`, `ordem`, `descricao`) VALUES
  ('corretora',  'Corretora',  10, 'Cliente da corretora'),
  ('seguradora', 'Seguradora', 20, 'Encaminhado pela seguradora à corretora');

-- Grupo que não existe é recusado pelo banco.
ALTER TABLE `clientes`
  MODIFY COLUMN `carteira_comercial` VARCHAR(40) NOT NULL DEFAULT 'corretora'
    COMMENT 'Grupo de cliente: chave de grupos_cliente',
  ADD CONSTRAINT `fk_clientes_grupo_cliente` FOREIGN KEY (`carteira_comercial`)
    REFERENCES `grupos_cliente` (`chave`) ON UPDATE RESTRICT ON DELETE RESTRICT;
