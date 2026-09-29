-- Seed 006 — `inadimplencia.ler`: a inadimplência deixa de exigir `comissoes.ler` (Parcelas não
-- vê comissão). Quem tinha `comissoes.ler` ganha a nova junto.

USE `minhacorretora_bi`;

INSERT INTO `permissoes` (`chave`, `descricao`) VALUES
  ('inadimplencia.ler', 'Consultar parcelas em atraso (Financeiro › Inadimplência)')
ON DUPLICATE KEY UPDATE `descricao` = VALUES(`descricao`);

INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT DISTINCT p.`id`, nova.`id`
  FROM `papeis` p
  JOIN `permissoes` nova ON nova.`chave` = 'inadimplencia.ler'
 WHERE p.`chave` = 'parcelas'
    OR EXISTS (SELECT 1
                 FROM `papel_permissoes` pp
                 JOIN `permissoes` pe ON pe.`id` = pp.`permissao_id`
                WHERE pp.`papel_id` = p.`id`
                  AND pe.`chave` = 'comissoes.ler');
