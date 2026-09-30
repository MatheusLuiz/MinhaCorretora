import type { LayoutsDaSeguradora } from './comum/layouts.js';
import { layouts as bradesco } from './bradesco/index.js';
import { layouts as portoSeguro } from './porto-seguro/index.js';
import { layouts as suhai } from './suhai/index.js';
import { layouts as tokioMarine } from './tokio-marine/index.js';
import { layouts as yelum } from './yelum/index.js';

/** Pastas de seguradora com layouts de importação; as listas de `services/modelos*.ts` se montam daqui. */
export const LAYOUTS_POR_SEGURADORA: readonly LayoutsDaSeguradora[] = [suhai, bradesco, portoSeguro, tokioMarine, yelum];
