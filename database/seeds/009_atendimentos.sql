-- Seed 009 — Permissão de registrar atendimento (≠ `clientes.gerenciar`).
-- Sem subir `sessao_versao`: só acrescenta; chega no próximo refresh.

USE `minhacorretora_bi`;

INSERT INTO `permissoes` (`chave`, `descricao`) VALUES
  ('atendimentos.registrar', 'Registrar contatos no histórico de atendimento do cliente')
ON DUPLICATE KEY UPDATE `descricao` = VALUES(`descricao`);

INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, nova.`id`
  FROM `papeis` p
  JOIN `permissoes` nova ON nova.`chave` = 'atendimentos.registrar'
 WHERE p.`chave` IN ('admin', 'gestor', 'corretor_corretora', 'corretor_loja',
                     'corretor_renovacao', 'parcelas');
