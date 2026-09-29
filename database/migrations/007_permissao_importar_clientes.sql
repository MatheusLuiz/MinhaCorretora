-- 007 — Permissão própria para importar/exportar a base de clientes (`clientes.ler` só consulta).

USE `minhacorretora_bi`;

INSERT INTO `permissoes` (`chave`, `descricao`) VALUES
  ('clientes.gerenciar', 'Importar e exportar a base de clientes')
AS nova
ON DUPLICATE KEY UPDATE `descricao` = nova.`descricao`;

-- Só admin e gestor.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe ON pe.`chave` = 'clientes.gerenciar'
 WHERE p.`chave` IN ('admin', 'gestor')
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;
