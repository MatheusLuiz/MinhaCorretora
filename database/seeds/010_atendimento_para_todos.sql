-- Seed 010 — Remove a permissão da seed 009: qualquer pessoa que abre a ficha registra
-- atendimento. O CASCADE limpa as concessões.

USE `minhacorretora_bi`;

DELETE FROM `permissoes` WHERE `chave` = 'atendimentos.registrar';
