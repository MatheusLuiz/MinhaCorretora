-- 001 — Schema de autenticação e autorização (MySQL 8.4, InnoDB, utf8mb4_0900_ai_ci).
-- `id` BIGINT interno; `uuid` é o identificador público (o id sequencial nunca sai na API).

CREATE DATABASE IF NOT EXISTS `minhacorretora_bi`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE `minhacorretora_bi`;

-- Papéis (perfis de acesso)
CREATE TABLE IF NOT EXISTS `papeis` (
  `id`            SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chave`         VARCHAR(50)  NOT NULL COMMENT 'Identificador estável usado no código',
  `nome`          VARCHAR(100) NOT NULL,
  `descricao`     VARCHAR(255) NULL,
  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_papeis_chave` (`chave`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Perfis de acesso do BI';

-- Permissões granulares
CREATE TABLE IF NOT EXISTS `permissoes` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chave`     VARCHAR(80)  NOT NULL COMMENT 'Ex.: relatorios.ler, usuarios.gerenciar',
  `descricao` VARCHAR(255) NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permissoes_chave` (`chave`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `papel_permissoes` (
  `papel_id`     SMALLINT UNSIGNED NOT NULL,
  `permissao_id` SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (`papel_id`, `permissao_id`),
  KEY `ix_papel_permissoes_permissao` (`permissao_id`),
  CONSTRAINT `fk_pp_papel`     FOREIGN KEY (`papel_id`)     REFERENCES `papeis` (`id`)     ON DELETE CASCADE,
  CONSTRAINT `fk_pp_permissao` FOREIGN KEY (`permissao_id`) REFERENCES `permissoes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Usuários do BI (pessoas). Credencial de integração fica cifrada no cadastro da seguradora.
CREATE TABLE IF NOT EXISTS `usuarios` (
  `id`   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` BINARY(16) NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1))
         COMMENT 'Identificador público. A flag 1 reordena o UUIDv1 para ficar sequencial e não fragmentar o índice',

  `nome`  VARCHAR(150) NOT NULL,
  `email` VARCHAR(254) NOT NULL COMMENT 'Limite do RFC 5321',

  -- Argon2id gera ~97 caracteres; 255 dá folga para aumentar o custo.
  `senha_hash`           VARCHAR(255) NOT NULL,
  `senha_algoritmo`      VARCHAR(20)  NOT NULL DEFAULT 'argon2id'
                         COMMENT 'Permite rehash transparente quando o padrão mudar',
  `senha_alterada_em`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `precisa_trocar_senha` TINYINT(1)   NOT NULL DEFAULT 0,

  `papel_id` SMALLINT UNSIGNED NOT NULL,
  `ativo`    TINYINT(1) NOT NULL DEFAULT 1,

  `email_verificado_em` DATETIME(3) NULL,

  -- Contador aqui para o bloqueio por força bruta ser a leitura de uma linha.
  `tentativas_falhas` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `bloqueado_ate`     DATETIME(3) NULL,
  `ultimo_login_em`   DATETIME(3) NULL,
  `ultimo_login_ip`   VARBINARY(16) NULL COMMENT 'INET6_ATON: cobre IPv4 e IPv6',

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuarios_uuid`  (`uuid`),
  UNIQUE KEY `uq_usuarios_email` (`email`),
  KEY `ix_usuarios_papel` (`papel_id`),
  KEY `ix_usuarios_ativo` (`ativo`),
  CONSTRAINT `fk_usuarios_papel` FOREIGN KEY (`papel_id`) REFERENCES `papeis` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Pessoas com acesso ao painel de BI';

-- Sessões / refresh tokens: guarda só o SHA-256 do token. `familia` liga os tokens de um
-- login; token já usado que reaparece revoga a família inteira.
CREATE TABLE IF NOT EXISTS `sessoes` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario_id` BIGINT UNSIGNED NOT NULL,

  `token_hash` BINARY(32) NOT NULL COMMENT 'SHA-256 do refresh token',
  `familia`    BINARY(16) NOT NULL COMMENT 'Agrupa a cadeia de rotação de um login',

  `expira_em`        DATETIME(3) NOT NULL,
  `usado_em`         DATETIME(3) NULL COMMENT 'Preenchido na rotação; reuso depois disso = roubo',
  `revogado_em`      DATETIME(3) NULL,
  `motivo_revogacao` ENUM('logout','rotacao','reuso_detectado','senha_alterada','admin','expirado') NULL,

  `ip`         VARBINARY(16) NULL,
  `user_agent` VARCHAR(255) NULL,

  `criado_em`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessoes_token_hash` (`token_hash`),
  KEY `ix_sessoes_usuario` (`usuario_id`),
  KEY `ix_sessoes_familia` (`familia`),
  KEY `ix_sessoes_expira`  (`expira_em`),
  CONSTRAINT `fk_sessoes_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Refresh tokens com rotação e detecção de reuso';

-- Tentativas de login (força bruta, inclusive distribuída)
CREATE TABLE IF NOT EXISTS `tentativas_login` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email_tentado` VARCHAR(254) NOT NULL COMMENT 'Registrado mesmo quando o usuário não existe',
  `usuario_id`    BIGINT UNSIGNED NULL,
  `sucesso`       TINYINT(1) NOT NULL,
  `motivo`        VARCHAR(60) NULL COMMENT 'senha_invalida, usuario_inativo, bloqueado...',
  `ip`            VARBINARY(16) NULL,
  `user_agent`    VARCHAR(255) NULL,
  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `ix_tentativas_email_data` (`email_tentado`, `criado_em`),
  KEY `ix_tentativas_ip_data`    (`ip`, `criado_em`),
  CONSTRAINT `fk_tentativas_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Auditoria
CREATE TABLE IF NOT EXISTS `auditoria` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario_id`  BIGINT UNSIGNED NULL COMMENT 'NULL quando a ação é anônima ou do sistema',
  `acao`        VARCHAR(60) NOT NULL COMMENT 'login, logout, senha.alterada, usuario.criado...',
  `entidade`    VARCHAR(60) NULL,
  `entidade_id` VARCHAR(64) NULL,
  `detalhes`    JSON NULL COMMENT 'Jamais conter senha, token ou credencial de integração',
  `ip`          VARBINARY(16) NULL,
  `user_agent`  VARCHAR(255) NULL,
  `criado_em`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  KEY `ix_auditoria_usuario_data` (`usuario_id`, `criado_em`),
  KEY `ix_auditoria_acao_data`    (`acao`, `criado_em`),
  CONSTRAINT `fk_auditoria_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Trilha de auditoria de ações sensíveis';
