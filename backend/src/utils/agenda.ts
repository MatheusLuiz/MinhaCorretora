/*
 * Agenda das tarefas em hora de Brasília. As datas são o relógio de parede de
 * Brasília nos campos UTC do Date (como o pool lê DATETIME): use só getters UTC.
 */

/** Bits dos dias: 1 = domingo … 64 = sábado (a ordem do `getUTCDay`). */
export const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'] as const;

const FORMATO_BRASILIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Agora, como relógio de parede de Brasília nos campos UTC. */
export function agoraEmBrasilia(instante = new Date()): Date {
  const p = Object.fromEntries(FORMATO_BRASILIA.formatToParts(instante).map((x) => [x.type, x.value]));
  return new Date(
    Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)),
  );
}

/** "08:30" ou "08:30:00" → [8, 30]; `null` se não for um horário. */
export function lerHorario(horario: string): [number, number] | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.exec(horario.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Próximo disparo estritamente depois de `depoisDe`; `null` sem dia marcado ou com horário inválido. */
export function proximaExecucao(diasSemana: number, horario: string, depoisDe: Date): Date | null {
  const hm = lerHorario(horario);
  if (!hm || (diasSemana & 127) === 0) return null;
  const [h, min] = hm;

  // Oito dias: de hoje até o mesmo dia da semana que vem.
  for (let i = 0; i <= 7; i++) {
    const candidato = new Date(
      Date.UTC(depoisDe.getUTCFullYear(), depoisDe.getUTCMonth(), depoisDe.getUTCDate() + i, h, min),
    );
    if (diasSemana & (1 << candidato.getUTCDay()) && candidato.getTime() > depoisDe.getTime()) {
      return candidato;
    }
  }
  return null;
}

/** "seg a sex", "todo dia", "seg, qua, sex" — para a tela e os logs. */
export function descreverDias(diasSemana: number): string {
  const d = diasSemana & 127;
  if (d === 127) return 'todo dia';
  if (d === 62) return 'seg a sex';
  if (d === 65) return 'fim de semana';
  return DIAS_DA_SEMANA.filter((_, i) => d & (1 << i)).join(', ') || 'nenhum dia';
}
