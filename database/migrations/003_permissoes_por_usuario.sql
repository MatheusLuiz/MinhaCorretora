-- 003 — Permissões individuais por cima do papel (exceções concedidas ou revogadas).

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `usuario_permissoes` (
  `usuario_id`   BIGINT UNSIGNED   NOT NULL,
  `permissao_id` SMALLINT UNSIGNED NOT NULL,

  -- 1 = concede além do papel; 0 = retira uma que o papel dá.
  `concedida` TINYINT(1) NOT NULL,

  `motivo`     VARCHAR(255) NULL COMMENT 'Por que a exceção existe — some com o tempo se não for escrito',
  `concedida_por` BIGINT UNSIGNED NULL,
  `criado_em`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`usuario_id`, `permissao_id`),
  KEY `ix_up_permissao` (`permissao_id`),
  KEY `ix_up_concedida_por` (`concedida_por`),

  CONSTRAINT `fk_up_usuario`   FOREIGN KEY (`usuario_id`)   REFERENCES `usuarios`   (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_up_permissao` FOREIGN KEY (`permissao_id`) REFERENCES `permissoes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_up_autor`     FOREIGN KEY (`concedida_por`) REFERENCES `usuarios`  (`id`) ON DELETE SET NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  COMMENT='Excecoes de permissao por usuario, somadas ou subtraidas do papel';

-- Permissão efetiva = (permissões do papel − revogações) ∪ concessões. A regra vive só nesta view.
CREATE OR REPLACE VIEW `vw_permissoes_efetivas` AS
  SELECT u.id AS usuario_id, pe.chave AS permissao
    FROM usuarios         u
    JOIN papel_permissoes pp ON pp.papel_id = u.papel_id
    JOIN permissoes       pe ON pe.id = pp.permissao_id
    LEFT JOIN usuario_permissoes up
           ON up.usuario_id = u.id AND up.permissao_id = pe.id
   WHERE up.permissao_id IS NULL OR up.concedida = 1

  UNION

  SELECT u.id AS usuario_id, pe.chave AS permissao
    FROM usuarios           u
    JOIN usuario_permissoes up ON up.usuario_id = u.id AND up.concedida = 1
    JOIN permissoes         pe ON pe.id = up.permissao_id;
