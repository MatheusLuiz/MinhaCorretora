-- 026 — Remove a Allianz semeada por engano na 025 (só se nada apontar para ela).

USE `minhacorretora_bi`;

DELETE FROM `seguradoras`
 WHERE `chave` = 'allianz'
   AND NOT EXISTS (SELECT 1 FROM `apolices` a WHERE a.`seguradora_id` = `seguradoras`.`id`)
   AND NOT EXISTS (
     SELECT 1 FROM `seguradoras_clientes` sc WHERE sc.`seguradora_id` = `seguradoras`.`id`
   );
