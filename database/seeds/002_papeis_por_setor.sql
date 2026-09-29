-- Seed 002 — Papéis por setor: Corretor — Corretora/Loja/Renovação (Renovação vê a base inteira),
-- Parcelas (sem comissão); Operador e Consulta saem. Seed, não migration: depende do seed 001.
-- Ids preservados onde só muda o nome, para manter ajustes feitos na tela.

USE `minhacorretora_bi`;

-- ─── Corretor vira Corretor — Corretora ───
UPDATE `papeis`
   SET `chave` = 'corretor_corretora',
       `nome` = 'Corretor — Corretora',
       `descricao` = 'Balcão da corretora. Vê só a própria carteira e a própria comissão.'
 WHERE `chave` = 'corretor';

-- ─── Loja e Renovação nascem com as permissões do corretor ───
INSERT INTO `papeis` (`chave`, `nome`, `descricao`) VALUES
  ('corretor_loja', 'Corretor — Loja',
   'Vendas nas concessionárias. Vê só a própria carteira e a própria comissão.'),
  ('corretor_renovacao', 'Corretor — Renovação',
   'Fila de renovação da corretora inteira: vê a base toda, e só a própria comissão.')
ON DUPLICATE KEY UPDATE `nome` = VALUES(`nome`), `descricao` = VALUES(`descricao`);

INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT novo.`id`, pp.`permissao_id`
  FROM `papeis` novo
  JOIN `papeis` base ON base.`chave` = 'corretor_corretora'
  JOIN `papel_permissoes` pp ON pp.`papel_id` = base.`id`
 WHERE novo.`chave` IN ('corretor_loja', 'corretor_renovacao');

-- Renovação liga para o vencimento de qualquer carteira.
INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe ON pe.`chave` = 'clientes.todos'
 WHERE p.`chave` = 'corretor_renovacao';

-- ─── Financeiro / Cobrança vira Parcelas, sem comissão ───
UPDATE `papeis`
   SET `chave` = 'parcelas',
       `nome` = 'Parcelas',
       `descricao` = 'Cobrança: todas as parcelas em atraso, clientes e apólices. Sem comissão.'
 WHERE `chave` = 'financeiro';

DELETE pp
  FROM `papel_permissoes` pp
  JOIN `papeis` p      ON p.`id` = pp.`papel_id`
  JOIN `permissoes` pe ON pe.`id` = pp.`permissao_id`
 WHERE p.`chave` = 'parcelas'
   AND pe.`chave` IN ('comissoes.ler', 'comissoes.todas');

-- ─── Operador e Consulta saem ───
-- `sessao_versao` sobe para a sessão aberta cair na hora (o token carrega o papel).
UPDATE `usuarios` u
  JOIN `papeis` antigo ON antigo.`id` = u.`papel_id`
  JOIN `papeis` novo   ON novo.`chave` = 'corretor_corretora'
   SET u.`papel_id` = novo.`id`,
       u.`sessao_versao` = u.`sessao_versao` + 1
 WHERE antigo.`chave` IN ('operador', 'somente_leitura');

DELETE FROM `papeis` WHERE `chave` IN ('operador', 'somente_leitura');
