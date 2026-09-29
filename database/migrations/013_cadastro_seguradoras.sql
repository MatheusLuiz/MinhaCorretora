-- 013 — Cadastro de seguradoras: `ativa` limpa a lista de escolha sem apagar o histórico.
-- Integração em tabela à parte; o segredo é cifrado (AES-256-GCM, chave fora do banco)
-- e só os últimos caracteres ficam em claro (`segredo_dica`).

USE `minhacorretora_bi`;

ALTER TABLE `seguradoras`
  ADD COLUMN `cnpj` CHAR(14) NULL
    COMMENT 'Só dígitos; NULL enquanto não se sabe' AFTER `nome`,
  ADD COLUMN `codigo_susep` VARCHAR(20) NULL
    COMMENT 'Código da companhia na SUSEP' AFTER `cnpj`,
  ADD COLUMN `site` VARCHAR(200) NULL AFTER `codigo_susep`,
  ADD COLUMN `telefone` VARCHAR(20) NULL AFTER `site`,
  ADD COLUMN `email` VARCHAR(120) NULL
    COMMENT 'Contato comercial ou de sinistro' AFTER `telefone`,
  ADD COLUMN `observacoes` VARCHAR(500) NULL AFTER `email`,
  ADD COLUMN `ativa` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '0 esconde a companhia de toda tela de escolha, sem apagar histórico'
    AFTER `observacoes`,
  ADD COLUMN `inativada_em` DATETIME(3) NULL AFTER `ativa`,
  ADD COLUMN `atualizado_em` DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER `criado_em`;

-- UNIQUE aceita vários NULL: companhias sem CNPJ convivem.
ALTER TABLE `seguradoras`
  ADD UNIQUE KEY `uq_seguradoras_cnpj` (`cnpj`),
  ADD KEY `ix_seguradoras_ativa_nome` (`ativa`, `nome`);

-- Integração por companhia (no máximo uma: PK = seguradora_id).
CREATE TABLE IF NOT EXISTS `seguradora_integracoes` (
  `seguradora_id` SMALLINT UNSIGNED NOT NULL,

  `tipo` ENUM('nenhuma','api','sftp','portal') NOT NULL DEFAULT 'nenhuma'
    COMMENT 'portal = baixa manual do site da companhia; é o estado de hoje',
  `ambiente` ENUM('producao','homologacao') NOT NULL DEFAULT 'producao',

  -- Separado de `tipo`: a configuração pode ficar cadastrada e desligada.
  `ativa` TINYINT(1) NOT NULL DEFAULT 0,

  `base_url`   VARCHAR(255) NULL,
  `usuario`    VARCHAR(120) NULL,

  `segredo_cifrado` VARBINARY(1024) NULL
    COMMENT 'AES-256-GCM: nonce(12) + tag(16) + cifra. A chave não está no banco',
  `segredo_dica` VARCHAR(8) NULL
    COMMENT 'Últimos caracteres em claro, para conferência na tela',

  `observacoes` VARCHAR(500) NULL,

  `ultima_sincronizacao_em` DATETIME(3) NULL,
  `atualizado_em` DATETIME(3) NOT NULL
    DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`seguradora_id`),
  CONSTRAINT `fk_integracao_seguradora`
    FOREIGN KEY (`seguradora_id`) REFERENCES `seguradoras` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  COMMENT='Como os dados de cada companhia chegam ao sistema';
