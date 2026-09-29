-- 011 — Cópia do arquivo ORIGINAL de cada importação: em disco (não BLOB), com caminho
-- e SHA-256 no banco. O hash prova a cópia e detecta reimportação idêntica.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `arquivos_importados` (
  `id`   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- O mesmo lote das linhas importadas: liga o dado ao arquivo de origem.
  `lote` CHAR(36) NOT NULL,

  `nome_original` VARCHAR(255) NOT NULL,
  `extensao`      VARCHAR(10)  NULL,
  `tamanho_bytes` INT UNSIGNED NOT NULL,
  `sha256`        CHAR(64)     NOT NULL COMMENT 'Prova de integridade da cópia',
  `caminho`       VARCHAR(255) NOT NULL COMMENT 'Relativo ao diretório de armazenamento',

  `entidade` ENUM('clientes','apolices','parcelas','comissoes') NOT NULL,
  `layout`   VARCHAR(60) NULL COMMENT 'Modelo/layout usado na leitura',
  `origem_sistema` ENUM('seguradora','manual') NOT NULL,

  -- NULL quando veio da linha de comando (sem sessão).
  `importado_por` BIGINT UNSIGNED NULL,
  `importado_em`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- O relatório da importação (lidas, recusadas, colunas ignoradas).
  `resultado` JSON NULL,

  -- Marcada, não apagada: o desfazer é informação de auditoria.
  `desfeito_em`  DATETIME(3) NULL,
  `desfeito_por` BIGINT UNSIGNED NULL,
  `motivo_desfazimento` VARCHAR(255) NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_arquivos_lote` (`lote`),
  KEY `ix_arquivos_sha` (`sha256`),
  KEY `ix_arquivos_entidade_data` (`entidade`, `importado_em`),
  CONSTRAINT `fk_arquivos_usuario` FOREIGN KEY (`importado_por`)
    REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_arquivos_desfeito_por` FOREIGN KEY (`desfeito_por`)
    REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Cópia auditável de cada arquivo importado';
