-- 037 — Integração com credenciais nomeadas (`credenciais_cifradas`, AES-256-GCM; `credenciais_resumo`
-- só com a dica em claro) e documentação da API (em claro, de propósito).

USE `minhacorretora_bi`;

ALTER TABLE `seguradora_integracoes`
  ADD COLUMN `documentacao_url` VARCHAR(255) NULL
    COMMENT 'Link da documentação da API (https)'
    AFTER `observacoes`,
  ADD COLUMN `documentacao` TEXT NULL
    COMMENT 'Como a API funciona — em claro, sem segredo'
    AFTER `documentacao_url`,
  ADD COLUMN `credenciais_cifradas` VARBINARY(4096) NULL
    COMMENT 'AES-256-GCM de JSON [{nome, valor}]'
    AFTER `segredo_dica`,
  ADD COLUMN `credenciais_resumo` VARCHAR(1000) NULL
    COMMENT 'JSON [{nome, dica}] em claro, para a tela'
    AFTER `credenciais_cifradas`;
