-- Seed 012 — Visão geral padrão do papel Sinistros com os widgets `sin.*` (mesmo resumo do
-- dashboard). Quem já personalizou mantém a sua.

UPDATE `papeis`
   SET `visao_geral` = JSON_ARRAY('sin.resumo', 'sin.mes', 'sin.seguradoras', 'ramo.sinistralidade')
 WHERE `chave` = 'sinistros';
