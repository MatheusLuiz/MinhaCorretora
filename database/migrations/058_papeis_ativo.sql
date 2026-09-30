-- 058 — Papel ativo/inativo (papel não se apaga: a auditoria o cita).
-- Papel com usuário ativo não se inativa (o serviço recusa).

USE `minhacorretora_bi`;

ALTER TABLE `papeis`
  ADD COLUMN `ativo` TINYINT(1) NOT NULL DEFAULT 1 AFTER `descricao`;
