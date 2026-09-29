-- 027 — Modelos de relatório como cadastro: companhia, família e o de-para das colunas.
-- `assinatura` = SHA-256 dos nomes de coluna normalizados e ORDENADOS: reconhece o arquivo.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `modelos_relatorio` (
  `id`            SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid`          BINARY(16) NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1)),

  /* NULL para arquivo que não é de companhia: o relatório sai do sistema da
     corretora e cobre várias seguradoras, com a de cada apólice numa coluna. */
  `seguradora_id` SMALLINT UNSIGNED NULL,

  `chave`         VARCHAR(60)  NOT NULL COMMENT 'Slug estável, gerado do nome',
  `nome`          VARCHAR(120) NOT NULL COMMENT 'Como a seguradora chama o relatório',
  `descricao`     VARCHAR(300) NULL,

  /* Decide qual importador roda. Não dá para inferir do arquivo: um relatório
     com CPF e apólice na mesma linha é carteira; um só com apólices é
     `apolices`. Quem sabe é quem cadastra. */
  `familia`       ENUM('carteira', 'apolices', 'financeiro', 'clientes') NOT NULL,
  `entidade`      ENUM('parcelas', 'comissoes') NULL
                  COMMENT 'Só para a família financeiro',

  `assinatura`    CHAR(64) NULL
                  COMMENT 'SHA-256 do cabeçalho normalizado e ordenado; reconhece o arquivo sozinho',

  `ativo`         TINYINT(1) NOT NULL DEFAULT 1,
  `criado_por`    BIGINT UNSIGNED NULL,
  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_modelos_uuid` (`uuid`),
  UNIQUE KEY `uq_modelos_chave` (`chave`),

  /* Não é único: o mesmo cabeçalho pode servir a duas companhias que usam o
     mesmo sistema de gestão. A busca por assinatura devolve candidatos, e o
     desempate é a companhia escolhida na tela. */
  KEY `ix_modelos_assinatura` (`assinatura`),
  KEY `ix_modelos_seguradora` (`seguradora_id`, `ativo`),

  CONSTRAINT `fk_modelos_seguradora`
    FOREIGN KEY (`seguradora_id`) REFERENCES `seguradoras` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_modelos_criado_por`
    FOREIGN KEY (`criado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC
  COMMENT='Formatos de relatório cadastrados pela tela, em vez de escritos no código';

-- De-para das colunas. `origem` já normalizada (como `mapearCabecalho` compara);
-- coluna ignorada não tem linha.
CREATE TABLE IF NOT EXISTS `modelos_relatorio_colunas` (
  `modelo_id` SMALLINT UNSIGNED NOT NULL,
  `origem`    VARCHAR(120) NOT NULL COMMENT 'Nome da coluna no arquivo, normalizado',
  `canonica`  VARCHAR(80)  NOT NULL COMMENT 'Campo do sistema que ela alimenta',

  PRIMARY KEY (`modelo_id`, `origem`),
  KEY `ix_modelos_colunas_canonica` (`canonica`),

  CONSTRAINT `fk_modelos_colunas_modelo`
    FOREIGN KEY (`modelo_id`) REFERENCES `modelos_relatorio` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC
  COMMENT='De-para de coluna do arquivo para campo do sistema';
