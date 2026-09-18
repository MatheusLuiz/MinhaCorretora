/*
 * UUID textual ↔ BINARY(16), com a mesma troca de campos de `UUID_TO_BIN(x, 1)`
 * (time_high | time_mid | time_low, para o índice crescer em ordem).
 */

const REGEX_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidEhValido(valor: string): boolean {
  return REGEX_UUID.test(valor);
}

/** Texto → BINARY(16) na mesma ordem de bytes que `UUID_TO_BIN(?, 1)` produz. */
export function uuidParaBinario(uuid: string): Buffer {
  if (!uuidEhValido(uuid)) {
    throw new Error('UUID em formato inválido.');
  }

  const hex = uuid.replace(/-/g, '');

  const timeLow = hex.slice(0, 8);
  const timeMid = hex.slice(8, 12);
  const timeHigh = hex.slice(12, 16);
  const resto = hex.slice(16);

  return Buffer.from(`${timeHigh}${timeMid}${timeLow}${resto}`, 'hex');
}

/** BINARY(16) → texto, desfazendo o swap. Equivale a `BIN_TO_UUID(?, 1)`. */
export function binarioParaUuid(binario: Buffer): string {
  if (binario.length !== 16) {
    throw new Error('UUID binário precisa ter exatamente 16 bytes.');
  }

  const hex = binario.toString('hex');

  const timeHigh = hex.slice(0, 4);
  const timeMid = hex.slice(4, 8);
  const timeLow = hex.slice(8, 16);
  const grupo4 = hex.slice(16, 20);
  const grupo5 = hex.slice(20);

  return `${timeLow}-${timeMid}-${timeHigh}-${grupo4}-${grupo5}`;
}
