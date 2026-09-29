-- Seed 005 — Remove o papel Corretor — Prospecto e `importacao.prospectos` (nunca usados).
-- O CASCADE limpa as concessões.

USE `minhacorretora_bi`;

DELETE FROM `papeis` WHERE `chave` = 'corretor_prospecto';

DELETE FROM `permissoes` WHERE `chave` = 'importacao.prospectos';
