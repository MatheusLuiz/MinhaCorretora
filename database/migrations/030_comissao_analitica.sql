-- 030 — Linhas do demonstrativo de comissão (analítico da Porto: apólice, segurado, valor pago).
-- Não vai em `apolices.comissao` (o que a apólice GERA); aqui é o que foi PAGO, por parcela.
-- Cancelamento e restituição entram NEGATIVOS: a soma bate com o rodapé ao centavo.

CREATE TABLE `comissoes_itens` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `comissao_id`   BIGINT UNSIGNED NOT NULL
                  COMMENT 'A ordem de pagamento a que esta linha pertence.',
  /*
   * A posição da linha dentro do arquivo.
   *
   * É o que torna a reimportação idempotente sem inventar chave de negócio: o
   * mesmo arquivo produz a mesma sequência, e duas linhas legitimamente
   * idênticas (mesma apólice, mesma parcela, mesmo valor) continuam sendo duas.
   */
  `sequencia`     SMALLINT UNSIGNED NOT NULL,

  /*
   * `apolice_id` é NULO quando o número não está na base.
   *
   * Acontece com apólices emitidas antes do período já importado, que os
   * relatórios de emissão dos últimos 30 dias nunca cobriram. A comissão delas
   * é real e entra; o que falta é o outro lado do vínculo.
   */
  `apolice_id`     BIGINT UNSIGNED NULL,
  `numero_apolice` VARCHAR(30) NOT NULL,
  `nome_segurado`  VARCHAR(150) NULL,

  `marca`          VARCHAR(30) NULL COMMENT 'Porto, Azul ou Itaú — marcas do grupo.',
  `sucursal`       VARCHAR(10) NULL,
  `ramo_codigo`    VARCHAR(10) NULL COMMENT 'Código SUSEP como vem no arquivo.',
  `susep_producao` VARCHAR(20) NULL COMMENT 'Susep que produziu; o arquivo tem várias por ordem.',

  `fatura_endosso` VARCHAR(20) NULL,
  `parcela`        SMALLINT UNSIGNED NULL,
  `carne`          VARCHAR(20) NULL,
  `data`           DATE NULL,

  `premio_liquido`      DECIMAL(15,2) NULL
                        COMMENT 'Da PARCELA quando fracionada, da apólice quando total. Não é prêmio da apólice.',
  `percentual_comissao` DECIMAL(6,2) NULL,
  `comissao`            DECIMAL(15,2) NOT NULL COMMENT 'Negativo em cancelamento e restituição.',

  `tipo_codigo`    VARCHAR(10) NULL,
  `tipo_descricao` VARCHAR(60) NULL,

  `origem_lote`    CHAR(36) NULL,
  `importado_em`   DATETIME(3) NULL,
  `criado_em`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comissao_item` (`comissao_id`, `sequencia`),
  KEY `ix_itens_apolice` (`apolice_id`),
  KEY `ix_itens_numero` (`numero_apolice`),
  KEY `ix_itens_ramo` (`ramo_codigo`),

  CONSTRAINT `fk_itens_comissao` FOREIGN KEY (`comissao_id`)
    REFERENCES `comissoes` (`id`) ON DELETE CASCADE,
  /*
   * `SET NULL` e não `CASCADE`: desfazer uma importação de apólices não pode
   * apagar o registro de um pagamento que a companhia fez. O vínculo se perde,
   * o dinheiro não.
   */
  CONSTRAINT `fk_itens_apolice` FOREIGN KEY (`apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Data da ordem de pagamento (não é a competência).

ALTER TABLE `comissoes`
  ADD COLUMN `susep_favorecida` VARCHAR(20) NULL
    COMMENT 'Susep que recebe o pagamento — a corretora.'
    AFTER `codigo_estabelecimento`;
