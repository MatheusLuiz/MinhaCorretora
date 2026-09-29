-- 029 — `situacao_cia`: a situação que a COMPANHIA declara (o arquivo diz QUE cancelou,
-- não QUANDO, por isso não vai em `cancelada_em`). NULL = a origem não informa — nunca
-- tratar como cancelada.

ALTER TABLE `apolices`
  ADD COLUMN `situacao_cia`
    ENUM('ativa', 'cancelada', 'nao_vigente', 'suspensa') NULL
    COMMENT 'Situação declarada pela companhia. NULL = origem não informa.'
    AFTER `motivo_cancelamento`,
  ADD COLUMN `endosso` VARCHAR(20) NULL
    COMMENT 'Número do endosso na companhia. 0/vazio = apólice sem alteração.'
    AFTER `situacao_cia`,
  ADD INDEX `ix_apolices_situacao_cia` (`situacao_cia`, `vigencia_fim`);

-- A view de renovação passa a respeitar a situação.

CREATE OR REPLACE VIEW `vw_apolices_a_renovar` AS
SELECT
  a.`id`,
  a.`uuid`,
  a.`numero`,
  a.`nome_segurado`,
  a.`cliente_id`,
  s.`nome`  AS `seguradora`,
  p.`nome`  AS `produto`,
  a.`vigencia_inicio`,
  a.`vigencia_fim`,
  a.`premio_total`,
  a.`numero_renovacao`,
  (a.`numero_renovacao` IS NOT NULL) AS `renovada`,
  a.`cancelada_em`,
  a.`situacao_cia`,
  (TO_DAYS(a.`vigencia_fim`) - TO_DAYS(CURDATE())) AS `dias_para_vencer`
FROM `apolices` a
JOIN `seguradoras` s ON s.`id` = a.`seguradora_id`
LEFT JOIN `produtos` p ON p.`id` = a.`produto_id`
WHERE a.`vigencia_fim` IS NOT NULL
  AND a.`cancelada_em` IS NULL
  -- NULL passa de propósito: é "a companhia não informa", não "cancelada".
  AND (a.`situacao_cia` IS NULL OR a.`situacao_cia` = 'ativa');

-- As duas colunas novas no modelo da Porto (NOT EXISTS: podem já ter sido cadastradas pela tela).

INSERT INTO `modelos_relatorio_colunas` (`modelo_id`, `origem`, `canonica`)
SELECT m.`id`, 'status', 'situacao_cia'
  FROM `modelos_relatorio` m
 WHERE m.`chave` = 'apolices-emitidas'
   AND NOT EXISTS (
     SELECT 1 FROM `modelos_relatorio_colunas` c
      WHERE c.`modelo_id` = m.`id` AND c.`origem` = 'status');

INSERT INTO `modelos_relatorio_colunas` (`modelo_id`, `origem`, `canonica`)
SELECT m.`id`, 'endosso', 'endosso'
  FROM `modelos_relatorio` m
 WHERE m.`chave` = 'apolices-emitidas'
   AND NOT EXISTS (
     SELECT 1 FROM `modelos_relatorio_colunas` c
      WHERE c.`modelo_id` = m.`id` AND c.`origem` = 'endosso');
