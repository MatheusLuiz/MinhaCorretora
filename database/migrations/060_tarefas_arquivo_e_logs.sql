-- 060 — Tarefa aponta o ARQUIVO de rotina (`executor` vira `arquivo`) e cada execução
-- guarda log linha a linha (tabela, para a tela acompanhar ao vivo).

USE `minhacorretora_bi`;

ALTER TABLE `tarefas`
  CHANGE COLUMN `executor` `arquivo` VARCHAR(120) NOT NULL
    COMMENT 'Rotina em src/integrations/seguradoras, relativa e sem extensão';

CREATE TABLE IF NOT EXISTS `tarefas_logs` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `execucao_id`   BIGINT UNSIGNED NOT NULL,
  `em`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `nivel`         ENUM('info','aviso','erro') NOT NULL DEFAULT 'info',
  `mensagem`      VARCHAR(2000) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_tarefas_logs_execucao` (`execucao_id`, `id`),
  CONSTRAINT `fk_tarefas_logs_execucao` FOREIGN KEY (`execucao_id`)
    REFERENCES `tarefas_execucoes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Log linha a linha de cada execução de tarefa';
