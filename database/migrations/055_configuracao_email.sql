-- 055 — Caixa de e-mail de disparo configurável pela tela (linha única, CHECK id = 1).
-- Sem ela ou inativa, vale o `.env`. Senha cifrada (AES-256-GCM), nunca volta à tela.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `configuracao_email` (
  `id`                TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `ativo`             TINYINT(1)       NOT NULL DEFAULT 0,
  `host`              VARCHAR(255)     NULL,
  `porta`             SMALLINT UNSIGNED NOT NULL DEFAULT 587,
  -- starttls = porta 587 (negocia TLS depois de conectar); tls = porta 465.
  `seguranca`         ENUM('starttls', 'tls') NOT NULL DEFAULT 'starttls',
  `usuario`           VARCHAR(254)     NULL,
  `senha_cifrada`     VARBINARY(1024)  NULL,
  `senha_dica`        VARCHAR(10)      NULL,
  `remetente_nome`    VARCHAR(120)     NULL,
  `remetente_email`   VARCHAR(254)     NULL,
  `responder_para`    VARCHAR(254)     NULL,
  `ultimo_teste_em`   DATETIME(3)      NULL,
  `ultimo_teste_ok`   TINYINT(1)       NULL,
  `ultimo_teste_erro` VARCHAR(500)     NULL,
  `atualizado_por`    BIGINT UNSIGNED  NULL,
  `criado_em`         DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_configuracao_email_linha_unica` CHECK (`id` = 1),
  CONSTRAINT `fk_configuracao_email_usuario`
    FOREIGN KEY (`atualizado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
