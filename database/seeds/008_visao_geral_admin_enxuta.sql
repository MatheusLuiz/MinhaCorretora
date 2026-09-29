-- Seed 008 — Visão geral do Administrador: só "Hoje na corretora" (`geral.hoje`).

USE `minhacorretora_bi`;

UPDATE `papeis` SET `visao_geral` = JSON_ARRAY('geral.hoje') WHERE `chave` = 'admin';
