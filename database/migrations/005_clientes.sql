-- 005 — Clientes da corretora, modelo normalizado: valores repetidos viram dimensão,
-- blocos com várias ocorrências viram satélite 1:N. `origem_sistema` marca a procedência.

USE `minhacorretora_bi`;

-- ===========================================================================
-- DIMENSÕES — o importador resolve "texto → id" e insere o que falta (sem seed).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `seguradoras` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome`      VARCHAR(60) NOT NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_seguradoras_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `ramos` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome`      VARCHAR(60) NOT NULL COMMENT 'Automóvel, Residencial, Vida...',
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ramos_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- `ramo_id` na chave única: dois ramos podem ter modalidades de mesmo nome.
CREATE TABLE IF NOT EXISTS `modalidades` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ramo_id`   SMALLINT UNSIGNED NULL,
  `nome`      VARCHAR(60) NOT NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_modalidades_ramo_nome` (`ramo_id`, `nome`),
  CONSTRAINT `fk_modalidades_ramo` FOREIGN KEY (`ramo_id`)
    REFERENCES `ramos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Vendedor dono da conta.
CREATE TABLE IF NOT EXISTS `produtores` (
  `id`        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome`      VARCHAR(120) NOT NULL,
  `ativo`     TINYINT(1)   NOT NULL DEFAULT 1,
  `criado_em` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_produtores_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Filial / equipe. O código é o identificador estável; o nome fantasia muda.
CREATE TABLE IF NOT EXISTS `estruturas_venda` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo`    VARCHAR(20)  NULL,
  `nome`      VARCHAR(120) NOT NULL,
  `criado_em` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_estruturas_codigo_nome` (`codigo`, `nome`),
  KEY `ix_estruturas_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Como o cliente chegou à corretora: indicação, visita, renovação...
CREATE TABLE IF NOT EXISTS `origens_clientes` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome`      VARCHAR(60) NOT NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_origens_clientes_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `profissoes` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome`      VARCHAR(120) NOT NULL,
  `criado_em` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_profissoes_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Faixa, não valor: o teto de uma faixa não é a renda de ninguém.
CREATE TABLE IF NOT EXISTS `faixas_renda` (
  `id`        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `descricao` VARCHAR(40) NOT NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_faixas_renda_descricao` (`descricao`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Tabela, não ENUM: valor novo não exige ALTER.
CREATE TABLE IF NOT EXISTS `estados_civis` (
  `id`        TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome`      VARCHAR(40) NOT NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_estados_civis_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Município + UF: o nome sozinho não identifica.
CREATE TABLE IF NOT EXISTS `municipios` (
  `id`        MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nome`      VARCHAR(80) NOT NULL,
  `uf`        CHAR(2)     NOT NULL,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_municipios_uf_nome` (`uf`, `nome`),
  KEY `ix_municipios_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- ===========================================================================
-- NÚCLEO
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `clientes` (
  `id`   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` BINARY(16) NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1))
         COMMENT 'Identificador público. Mesma regra dos usuários: o id sequencial nunca sai na API',

  -- --- Procedência ---------------------------------------------------------
  `origem_sistema` ENUM('seguradora','manual') NOT NULL,
  `origem_arquivo` VARCHAR(120) NULL,
  `origem_lote`    CHAR(36) NULL
                   COMMENT 'Agrupa tudo que entrou na mesma execução — permite desfazer uma importação inteira',
  `importado_em`   DATETIME(3) NULL,

  -- --- Identificação -------------------------------------------------------
  -- `_numeros` é a chave (só dígitos); `cpf_cnpj` guarda a máscara como veio.
  `cpf_cnpj`         VARCHAR(18) NULL,
  `cpf_cnpj_numeros` VARCHAR(14) NOT NULL COMMENT 'Só dígitos: 11 (CPF) ou 14 (CNPJ)',
  `tipo_pessoa`      ENUM('F','J') NOT NULL,

  `nome`        VARCHAR(150) NOT NULL,
  `nome_social` VARCHAR(150) NULL
                COMMENT 'Quando presente, é ELE que deve aparecer na tela — não o nome civil',

  `profissao_id`     SMALLINT UNSIGNED NULL,
  `estado_civil_id`  TINYINT  UNSIGNED NULL,
  `sexo`             ENUM('M','F') NULL,
  `data_nascimento`  DATE NULL,

  `vip` TINYINT(1) NOT NULL DEFAULT 0,
  -- Consentimento de contato (LGPD): respeitar em qualquer disparo.
  `autoriza_contato` TINYINT(1) NOT NULL DEFAULT 0,

  -- --- Relacionamento com a corretora --------------------------------------
  `produtor_id`         INT      UNSIGNED NULL,
  `estrutura_venda_id`  SMALLINT UNSIGNED NULL,
  `origem_cliente_id`   SMALLINT UNSIGNED NULL,

  `faixa_renda_id`    SMALLINT UNSIGNED NULL,
  `faturamento_anual` DECIMAL(15,2) NULL COMMENT 'Pessoa jurídica',

  `cliente_desde`    DATE NULL,
  `ultima_alteracao` DATE NULL COMMENT 'Data da última alteração NO SISTEMA DE ORIGEM',

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clientes_uuid` (`uuid`),
  -- Chave natural: reimportar atualiza em vez de duplicar.
  UNIQUE KEY `uq_clientes_documento` (`cpf_cnpj_numeros`),
  KEY `ix_clientes_nome`      (`nome`),
  KEY `ix_clientes_produtor`  (`produtor_id`),
  KEY `ix_clientes_estrutura` (`estrutura_venda_id`),
  KEY `ix_clientes_origem`    (`origem_sistema`, `origem_lote`),
  CONSTRAINT `fk_clientes_profissao` FOREIGN KEY (`profissao_id`)
    REFERENCES `profissoes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clientes_estado_civil` FOREIGN KEY (`estado_civil_id`)
    REFERENCES `estados_civis` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clientes_produtor` FOREIGN KEY (`produtor_id`)
    REFERENCES `produtores` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clientes_estrutura` FOREIGN KEY (`estrutura_venda_id`)
    REFERENCES `estruturas_venda` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clientes_origem_cliente` FOREIGN KEY (`origem_cliente_id`)
    REFERENCES `origens_clientes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_clientes_faixa_renda` FOREIGN KEY (`faixa_renda_id`)
    REFERENCES `faixas_renda` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Clientes da corretora, de qualquer procedência';

-- ===========================================================================
-- SATÉLITES 1:N
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `telefones` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,

  `tipo` ENUM('celular','residencial','comercial','opcional') NOT NULL,

  `ddd`    VARCHAR(3)  NULL,
  `numero` VARCHAR(15) NOT NULL,
  -- Guardado (não montado na consulta) para a busca usar índice.
  `completo` VARCHAR(20) NOT NULL,

  `principal` TINYINT(1) NOT NULL DEFAULT 0,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_telefones_cliente_tipo` (`cliente_id`, `tipo`),
  KEY `ix_telefones_completo` (`completo`),
  CONSTRAINT `fk_telefones_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `emails` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,

  `tipo`     ENUM('pessoal','comercial') NOT NULL,
  `endereco` VARCHAR(120) NOT NULL,

  `principal` TINYINT(1) NOT NULL DEFAULT 0,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emails_cliente_tipo` (`cliente_id`, `tipo`),
  KEY `ix_emails_endereco` (`endereco`),
  CONSTRAINT `fk_emails_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `enderecos` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,

  `tipo` ENUM('principal','comercial','cobranca') NOT NULL DEFAULT 'principal',

  `logradouro`  VARCHAR(150) NULL,
  `numero`      VARCHAR(10)  NULL,
  `complemento` VARCHAR(60)  NULL,
  `bairro`      VARCHAR(60)  NULL,
  -- Cidade e UF vêm de `municipios`, para não haver grafias diferentes da mesma cidade.
  `municipio_id` MEDIUMINT UNSIGNED NULL,
  `cep`          CHAR(8) NULL COMMENT 'Só dígitos',

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_enderecos_cliente_tipo` (`cliente_id`, `tipo`),
  KEY `ix_enderecos_municipio` (`municipio_id`),
  KEY `ix_enderecos_cep` (`cep`),
  CONSTRAINT `fk_enderecos_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_enderecos_municipio` FOREIGN KEY (`municipio_id`)
    REFERENCES `municipios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Segurados ligados ao cliente no cadastro. Contato inline: `telefones`/`emails` são do CLIENTE.
CREATE TABLE IF NOT EXISTS `segurados` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id` BIGINT UNSIGNED NOT NULL,

  -- 1, 2 ou 3 na origem: identifica a linha na reimportação.
  `ordem` TINYINT UNSIGNED NOT NULL,

  `nome` VARCHAR(120) NULL,
  `cpf`  VARCHAR(18)  NULL,
  `rg`   VARCHAR(20)  NULL,

  `logradouro`   VARCHAR(150) NULL,
  `bairro`       VARCHAR(60)  NULL,
  `municipio_id` MEDIUMINT UNSIGNED NULL,
  `cep`          CHAR(8) NULL,

  `telefone` VARCHAR(20)  NULL,
  `celular`  VARCHAR(20)  NULL,
  `email`    VARCHAR(120) NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_segurados_cliente_ordem` (`cliente_id`, `ordem`),
  KEY `ix_segurados_cpf` (`cpf`),
  CONSTRAINT `fk_segurados_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_segurados_municipio` FOREIGN KEY (`municipio_id`)
    REFERENCES `municipios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Co-titulares e segurados ligados ao cadastro do cliente';

-- Vínculo cliente ↔ seguradora (N:N). Não é a apólice: não tem número, vigência nem prêmio.
CREATE TABLE IF NOT EXISTS `seguradoras_clientes` (
  `id`            BIGINT   UNSIGNED NOT NULL AUTO_INCREMENT,
  `cliente_id`    BIGINT   UNSIGNED NOT NULL,
  `seguradora_id` SMALLINT UNSIGNED NOT NULL,
  `ramo_id`       SMALLINT UNSIGNED NULL,
  `modalidade_id` SMALLINT UNSIGNED NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_seg_cli` (`cliente_id`, `seguradora_id`, `ramo_id`, `modalidade_id`),
  KEY `ix_seg_cli_seguradora` (`seguradora_id`),
  KEY `ix_seg_cli_ramo` (`ramo_id`),
  CONSTRAINT `fk_seg_cli_cliente` FOREIGN KEY (`cliente_id`)
    REFERENCES `clientes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_seg_cli_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_seg_cli_ramo` FOREIGN KEY (`ramo_id`)
    REFERENCES `ramos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_seg_cli_modalidade` FOREIGN KEY (`modalidade_id`)
    REFERENCES `modalidades` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Em quais seguradoras o cliente tem seguro';

-- ===========================================================================
-- TRILHA DE IMPORTAÇÃO — uma linha por execução do importador.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS `importacoes` (
  `id`   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `lote` CHAR(36) NOT NULL COMMENT 'UUID que marca as linhas desta execução',

  `origem_sistema` ENUM('seguradora','manual') NOT NULL,
  `arquivo`        VARCHAR(255) NULL,
  `entidade`       VARCHAR(60)  NOT NULL DEFAULT 'clientes',

  `linhas_lidas`       INT UNSIGNED NOT NULL DEFAULT 0,
  `linhas_inseridas`   INT UNSIGNED NOT NULL DEFAULT 0,
  `linhas_atualizadas` INT UNSIGNED NOT NULL DEFAULT 0,
  `linhas_recusadas`   INT UNSIGNED NOT NULL DEFAULT 0,
  `detalhes`           JSON NULL COMMENT 'Resumo das recusas, sem dado pessoal',

  `executado_por` BIGINT UNSIGNED NULL COMMENT 'Usuário do BI, quando a importação partir da aplicação',
  `iniciado_em`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `concluido_em`  DATETIME(3) NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_importacoes_lote` (`lote`),
  KEY `ix_importacoes_origem_data` (`origem_sistema`, `iniciado_em`),
  CONSTRAINT `fk_importacoes_usuario` FOREIGN KEY (`executado_por`)
    REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Trilha das importações de base externa';

-- ===========================================================================
-- VIEW DE LEITURA — os joins da listagem num lugar só.
-- ===========================================================================

CREATE OR REPLACE VIEW `vw_clientes_listagem` AS
SELECT
  c.`id`,
  c.`uuid`,
  c.`origem_sistema`,
  c.`cpf_cnpj`,
  c.`cpf_cnpj_numeros`,
  c.`tipo_pessoa`,
  c.`nome`,
  c.`nome_social`,
  c.`vip`,
  e.`endereco`   AS `email`,
  t.`completo`   AS `celular`,
  m.`nome`       AS `cidade`,
  m.`uf`         AS `uf`,
  s.`nome`       AS `seguradora`,
  p.`nome`       AS `produtor`
FROM `clientes` c
LEFT JOIN `emails`    e ON e.`cliente_id` = c.`id` AND e.`tipo` = 'pessoal'
LEFT JOIN `telefones` t ON t.`cliente_id` = c.`id` AND t.`tipo` = 'celular'
LEFT JOIN `enderecos` en ON en.`cliente_id` = c.`id` AND en.`tipo` = 'principal'
LEFT JOIN `municipios` m ON m.`id` = en.`municipio_id`
LEFT JOIN `produtores` p ON p.`id` = c.`produtor_id`
-- Várias seguradoras por cliente: o MIN(id) torna a escolha estável.
LEFT JOIN `seguradoras_clientes` sc
       ON sc.`id` = (
            SELECT MIN(sc2.`id`) FROM `seguradoras_clientes` sc2
             WHERE sc2.`cliente_id` = c.`id`
          )
LEFT JOIN `seguradoras` s ON s.`id` = sc.`seguradora_id`;
