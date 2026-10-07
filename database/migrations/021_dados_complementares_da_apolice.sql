-- 021 — Dados complementares da apólice: proposta, sinistro, célula, canal de produção e
-- códigos de origem de seguradora e produto.

USE `minhacorretora_bi`;

-- 1. Proposta: íntegra mesmo quando o Excel destruiu o número da apólice. Única por seguradora.
ALTER TABLE `apolices`
  ADD COLUMN `numero_proposta` VARCHAR(30) NULL
    COMMENT 'Nº da proposta na origem; sobrevive ao Excel quando o nº da apólice não sobrevive'
    AFTER `chave_natural`,
  ADD COLUMN `proposta_cia` VARCHAR(40) NULL
    COMMENT 'Nº da proposta na companhia, quando difere do número interno'
    AFTER `numero_proposta`,
  ADD UNIQUE KEY `uq_apolices_seguradora_proposta` (`seguradora_id`, `numero_proposta`);

-- 2. `possui_sinistro` é sim/não: dá FREQUÊNCIA, não sinistralidade.
ALTER TABLE `apolices`
  ADD COLUMN `possui_sinistro` TINYINT(1) NULL
    COMMENT 'S/N da origem. Frequência, NUNCA sinistralidade: não há valor pago'
    AFTER `tipo_negocio`,
  ADD COLUMN `celula` VARCHAR(40) NULL
    COMMENT 'Agrupamento comercial da origem: AUTOMÓVEL, PATRIMONIAL, PESSOAS INDIVIDUAL, OUTROS'
    AFTER `possui_sinistro`;

-- 3. Canal de produção ("Grupo de Produção" na origem), com código estável.
CREATE TABLE IF NOT EXISTS `canais_producao` (
  `id`             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo_origem`  VARCHAR(20) NULL COMMENT 'ID do grupo de produção na origem',
  `nome`           VARCHAR(80) NOT NULL,
  `criado_em`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_canais_nome` (`nome`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC
  COMMENT='Por onde a venda entrou — "Grupo de Produção" na origem';

ALTER TABLE `apolices`
  ADD COLUMN `canal_id` SMALLINT UNSIGNED NULL
    COMMENT 'Canal por onde a venda entrou; diferente de quem vendeu (produtor_id)'
    AFTER `produtor_id`,
  ADD CONSTRAINT `fk_apolices_canal`
    FOREIGN KEY (`canal_id`) REFERENCES `canais_producao` (`id`) ON DELETE SET NULL,
  ADD KEY `ix_apolices_canal_vigencia` (`canal_id`, `vigencia_inicio`);

-- 4. Código de origem em seguradora e produto: renomear na origem não parte a carteira.
-- Não é chave: nem toda origem traz código.
ALTER TABLE `seguradoras`
  ADD COLUMN `codigo_origem` VARCHAR(20) NULL
    COMMENT 'ID da seguradora na origem — conciliação estável a renomeação'
    AFTER `nome`,
  ADD KEY `ix_seguradoras_codigo_origem` (`codigo_origem`);

ALTER TABLE `produtos`
  ADD COLUMN `codigo_origem` VARCHAR(20) NULL
    COMMENT 'ID do produto na origem'
    AFTER `nome`,
  ADD KEY `ix_produtos_codigo_origem` (`codigo_origem`);
