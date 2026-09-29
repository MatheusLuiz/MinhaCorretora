-- Seed 004 — Permissão que recebe TODO aviso de primeiro atraso, dada ao setor de Parcelas
-- (além do corretor do cadastro).

USE `minhacorretora_bi`;

INSERT INTO `permissoes` (`chave`, `descricao`) VALUES
  ('notificacoes.atrasos',
   'Receber o aviso de todo primeiro atraso de parcela, de qualquer carteira')
ON DUPLICATE KEY UPDATE `descricao` = VALUES(`descricao`);

INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe ON pe.`chave` = 'notificacoes.atrasos'
 WHERE p.`chave` = 'parcelas';
