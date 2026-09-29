-- 020 — Tipo de negócio da apólice: novo ou renovação (N/R na origem).
-- ENUM: um terceiro valor indica layout mudado e deve falhar na importação.

USE `minhacorretora_bi`;

ALTER TABLE `apolices`
  ADD COLUMN `tipo_negocio` ENUM('novo','renovacao') NULL
    COMMENT 'N/R da origem: captação ou retenção' AFTER `numero_renovacao`,
  ADD KEY `ix_apolices_tipo_vigencia` (`tipo_negocio`, `vigencia_inicio`);
