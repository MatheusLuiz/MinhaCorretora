-- 056 — Várias caixas de saída (uma padrão) e layouts de e-mail por finalidade.
-- `caixas_email` substitui `configuracao_email`. Finalidades e variáveis são código.
-- Colunas geradas + índice único garantem um layout ativo por finalidade e uma caixa padrão.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `caixas_email` (
  `id`                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `uuid`              BINARY(16)       NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1)),
  `nome`              VARCHAR(80)      NOT NULL,
  `ativo`             TINYINT(1)       NOT NULL DEFAULT 0,
  `padrao`            TINYINT(1)       NOT NULL DEFAULT 0,
  `host`              VARCHAR(255)     NOT NULL,
  `porta`             SMALLINT UNSIGNED NOT NULL DEFAULT 587,
  `seguranca`         ENUM('starttls', 'tls') NOT NULL DEFAULT 'starttls',
  `usuario`           VARCHAR(254)     NULL,
  `senha_cifrada`     VARBINARY(1024)  NULL,
  `senha_dica`        VARCHAR(10)      NULL,
  `remetente_nome`    VARCHAR(120)     NULL,
  `remetente_email`   VARCHAR(254)     NOT NULL,
  `responder_para`    VARCHAR(254)     NULL,
  `ultimo_teste_em`   DATETIME(3)      NULL,
  `ultimo_teste_ok`   TINYINT(1)       NULL,
  `ultimo_teste_erro` VARCHAR(500)     NULL,
  `atualizado_por`    BIGINT UNSIGNED  NULL,
  `criado_em`         DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- 1 na padrão, NULL nas outras: o índice único deixa existir UMA padrão.
  `padrao_unico`      TINYINT(1) GENERATED ALWAYS AS (IF(`padrao` = 1, 1, NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_caixas_email_uuid` (`uuid`),
  UNIQUE KEY `uq_caixas_email_nome` (`nome`),
  UNIQUE KEY `uq_caixas_email_padrao` (`padrao_unico`),
  CONSTRAINT `fk_caixas_email_usuario`
    FOREIGN KEY (`atualizado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- O que a 055 guardou vira a caixa padrão (se a 055 não guardou nada, não insere nada).
INSERT INTO `caixas_email`
  (`nome`, `ativo`, `padrao`, `host`, `porta`, `seguranca`, `usuario`, `senha_cifrada`, `senha_dica`,
   `remetente_nome`, `remetente_email`, `responder_para`,
   `ultimo_teste_em`, `ultimo_teste_ok`, `ultimo_teste_erro`, `atualizado_por`)
SELECT 'Sistema', `ativo`, 1, `host`, `porta`, `seguranca`, `usuario`, `senha_cifrada`, `senha_dica`,
       `remetente_nome`, `remetente_email`, `responder_para`,
       `ultimo_teste_em`, `ultimo_teste_ok`, `ultimo_teste_erro`, `atualizado_por`
  FROM `configuracao_email`
 WHERE `host` IS NOT NULL AND `remetente_email` IS NOT NULL;

DROP TABLE IF EXISTS `configuracao_email`;

CREATE TABLE IF NOT EXISTS `modelos_email` (
  `id`               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `uuid`             BINARY(16)       NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1)),
  `nome`             VARCHAR(120)     NOT NULL,
  `finalidade`       VARCHAR(40)      NOT NULL,
  -- NULL = sai pela caixa padrão.
  `caixa_id`         BIGINT UNSIGNED  NULL,
  `assunto`          VARCHAR(255)     NOT NULL,
  `corpo_html`       MEDIUMTEXT       NOT NULL,
  -- NULL = versão texto derivada do HTML na hora do envio.
  `corpo_texto`      TEXT             NULL,
  -- 1 = o corpo entra na moldura (cabeçalho e rodapé); 0 = o corpo já é o HTML inteiro.
  `usar_moldura`     TINYINT(1)       NOT NULL DEFAULT 1,
  `ativo`            TINYINT(1)       NOT NULL DEFAULT 1,
  `atualizado_por`   BIGINT UNSIGNED  NULL,
  `criado_em`        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `finalidade_ativa` VARCHAR(40) GENERATED ALWAYS AS
                     (IF(`ativo` = 1 AND `finalidade` <> 'livre', `finalidade`, NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_modelos_email_uuid` (`uuid`),
  UNIQUE KEY `uq_modelos_email_finalidade_ativa` (`finalidade_ativa`),
  KEY `ix_modelos_email_caixa` (`caixa_id`),
  -- Caixa apagada: o layout volta a sair pela padrão, em vez de sumir.
  CONSTRAINT `fk_modelos_email_caixa`
    FOREIGN KEY (`caixa_id`) REFERENCES `caixas_email` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_modelos_email_usuario`
    FOREIGN KEY (`atualizado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
