-- Seed 007 — Visão geral padrão de cada papel (coluna da 047): listas curtas, só cartões com dado.
-- Ids de `frontend/src/widgets/catalogo.ts`; id inexistente é ignorado pela tela.

USE `minhacorretora_bi`;

UPDATE `papeis` SET `visao_geral` = JSON_ARRAY(
  'prod.resumo', 'rec.comissao', 'fin.inadimplencia', 'renov.resumo', 'cli.resumo', 'prod.seguradora'
) WHERE `chave` = 'admin';

UPDATE `papeis` SET `visao_geral` = JSON_ARRAY(
  'prod.resumo', 'prod.vendedor', 'renov.resumo', 'rec.comissao', 'fin.inadimplencia'
) WHERE `chave` = 'gestor';

UPDATE `papeis` SET `visao_geral` = JSON_ARRAY(
  'renov.resumo', 'renov.carteira', 'cli.resumo'
) WHERE `chave` IN ('corretor_corretora', 'corretor_loja');

UPDATE `papeis` SET `visao_geral` = JSON_ARRAY(
  'renov.resumo', 'renov.carteira', 'renov.seguradora', 'renov.encerradas'
) WHERE `chave` = 'corretor_renovacao';

UPDATE `papeis` SET `visao_geral` = JSON_ARRAY(
  'fin.inadimplencia', 'cli.resumo'
) WHERE `chave` = 'parcelas';
