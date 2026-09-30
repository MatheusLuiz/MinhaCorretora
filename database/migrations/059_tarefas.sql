-- 059 — Tarefas agendadas. A tarefa é dado; o que ela executa é código.
-- Horários em hora de Brasília; `dias_semana` é máscara de bits (1 = dom … 64 = sáb).
-- `em_execucao_desde` é a trava (UPDATE … WHERE IS NULL): uma execução por vez.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `tarefas` (
  `id`                 BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `uuid`               BINARY(16)        NOT NULL DEFAULT (UUID_TO_BIN(UUID(), 1)),
  `nome`               VARCHAR(100)      NOT NULL,
  `descricao`          VARCHAR(255)      NULL,
  `executor`           VARCHAR(60)       NOT NULL COMMENT 'Chave do executor em services/tarefas/executores.ts',
  `seguradora_id`      SMALLINT UNSIGNED NULL,
  `dias_semana`        TINYINT UNSIGNED  NOT NULL DEFAULT 62 COMMENT 'Bits: 1=dom 2=seg 4=ter 8=qua 16=qui 32=sex 64=sáb (62 = seg a sex)',
  `horario`            TIME              NOT NULL COMMENT 'Hora de Brasília',
  `ativa`              TINYINT(1)        NOT NULL DEFAULT 1,
  `parametros`         JSON              NULL COMMENT 'O que o executor precisar além da seguradora',
  `proxima_execucao`   DATETIME(3)       NULL,
  `em_execucao_desde`  DATETIME(3)       NULL COMMENT 'Trava: preenchida enquanto roda',
  `criado_em`          DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em`      DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tarefas_uuid` (`uuid`),
  UNIQUE KEY `uq_tarefas_nome` (`nome`),
  KEY `ix_tarefas_agenda` (`ativa`, `proxima_execucao`),
  CONSTRAINT `fk_tarefas_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Tarefas agendadas (relatórios das seguradoras via API)';

CREATE TABLE IF NOT EXISTS `tarefas_execucoes` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tarefa_id`      BIGINT UNSIGNED NOT NULL,
  `disparo`        ENUM('agenda','manual') NOT NULL,
  `usuario_id`     BIGINT UNSIGNED NULL COMMENT 'Quem mandou executar (disparo manual)',
  `situacao`       ENUM('executando','sucesso','erro','interrompida') NOT NULL DEFAULT 'executando',
  `iniciada_em`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finalizada_em`  DATETIME(3) NULL,
  `mensagem`       VARCHAR(1000) NULL,
  `detalhes`       JSON NULL,
  PRIMARY KEY (`id`),
  KEY `ix_tarefas_execucoes_tarefa` (`tarefa_id`, `iniciada_em`),
  CONSTRAINT `fk_tarefas_execucoes_tarefa` FOREIGN KEY (`tarefa_id`)
    REFERENCES `tarefas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tarefas_execucoes_usuario` FOREIGN KEY (`usuario_id`)
    REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Histórico de execuções das tarefas';
