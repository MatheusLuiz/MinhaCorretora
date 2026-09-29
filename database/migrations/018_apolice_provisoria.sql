-- 018 — Apólice sem número recuperável (destruído pelo Excel ou ausente) entra com `PROV-<hex>`,
-- derivado de `chave_natural` (SHA-1 de seguradora, documento, vigência, prêmio, produto).
-- Derivado mantém a carga idempotente e permite promover ao número real depois.

USE `minhacorretora_bi`;

ALTER TABLE `apolices`
  ADD COLUMN `numero_provisorio` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = o número da origem se perdeu; o atual é PROV- e não vale como referência'
    AFTER `numero`,
  ADD COLUMN `chave_natural` CHAR(40) NULL
    COMMENT 'SHA-1 do contrato (seguradora+doc+vigência+prêmio+produto), para promover a provisória'
    AFTER `numero_provisorio`;

-- A promoção procura por esta chave dentro da seguradora.
ALTER TABLE `apolices`
  ADD KEY `ix_apolices_chave_natural` (`seguradora_id`, `chave_natural`);
