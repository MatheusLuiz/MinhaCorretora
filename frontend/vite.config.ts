import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:3333';

  /**
   * Expor na rede local.
   *
   * `host: true` faz o Vite escutar em 0.0.0.0 em vez de só em 127.0.0.1, o que
   * é o que permite outra máquina da rede abrir o sistema. O `--host` na linha
   * de comando faz o mesmo e continua funcionando.
   *
   * Fica ligado por padrão em desenvolvimento a pedido, mas é controlável por
   * `VITE_EXPOR_NA_REDE=false` — numa rede pública (cafeteria, aeroporto),
   * escutar em 0.0.0.0 entrega o servidor a quem estiver no mesmo Wi-Fi.
   */
  const exporNaRede = env.VITE_EXPOR_NA_REDE !== 'false';

  return {
    plugins: [react()],

    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },

    server: {
      host: exporNaRede,
      port: 5173,
      strictPort: true,

      /**
       * O proxy faz o navegador enxergar front e API na mesma origem. Em rede,
       * isso deixa de ser só conveniência e passa a ser o que faz tudo
       * funcionar: quem abre em http://10.x.x.x:5173 chama /api no MESMO
       * endereço, e é o Vite — rodando nesta máquina — que repassa ao backend.
       *
       * Sem o proxy, o navegador do colega tentaria falar com "localhost:3333",
       * que na máquina DELE não existe.
       */
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,

          /**
           * Repassa o IP de origem em `X-Forwarded-For`.
           *
           * Sem isto, TODA requisição chega ao backend como 127.0.0.1 — é o
           * proxy que abre a conexão, não o navegador do colega. Na máquina do
           * desenvolvedor isso é indiferente; em rede quebra duas coisas:
           *
           *  • o rate limit de login por IP passa a contar todo mundo junto:
           *    dez senhas erradas somadas entre as pessoas e a equipe inteira
           *    fica trancada por 15 minutos;
           *  • a auditoria grava 127.0.0.1 em cada acesso, e a trilha perde
           *    justamente a informação de onde a ação partiu.
           *
           * O backend tem `trust proxy: 1` e lê exatamente este cabeçalho.
           */
          xfwd: true,
        },
      },
    },

    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      target: 'es2022',
    },
  };
});
