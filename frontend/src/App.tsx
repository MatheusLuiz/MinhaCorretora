import { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { ExigePermissao } from '@/components/ExigePermissao';
import { LayoutApp } from '@/components/LayoutApp';
import { RotaProtegida } from '@/components/RotaProtegida';
import { AuthProvider } from '@/contexts/AuthContext';
import { EsqueciSenhaPage } from '@/pages/EsqueciSenhaPage';
import { LoginPage } from '@/pages/LoginPage';
import { RedefinirSenhaPage } from '@/pages/RedefinirSenhaPage';
import { SemAcessoPage } from '@/pages/SemAcessoPage';
import { AREAS } from '@/widgets/catalogo';

// Telas internas carregam sob demanda; a espera fica no <Suspense> do LayoutApp.
const pagina = <T extends Record<string, React.ComponentType>>(
  carregar: () => Promise<T>,
  nome: keyof T,
): React.LazyExoticComponent<React.ComponentType> => lazy(() => carregar().then((m) => ({ default: m[nome]! })));

const ApolicesPage = pagina(() => import('@/pages/ApolicesPage'), 'ApolicesPage');
const AuditoriaImportacoesPage = pagina(() => import('@/pages/AuditoriaImportacoesPage'), 'AuditoriaImportacoesPage');
const ClientesPage = pagina(() => import('@/pages/ClientesPage'), 'ClientesPage');
const ComissoesPage = pagina(() => import('@/pages/ComissoesPage'), 'ComissoesPage');
const CotacoesPage = pagina(() => import('@/pages/CotacoesPage'), 'CotacoesPage');
const FilaComissoesPage = pagina(() => import('@/pages/FilaComissoesPage'), 'FilaComissoesPage');
const FilaRenovacaoPage = pagina(() => import('@/pages/FilaRenovacaoPage'), 'FilaRenovacaoPage');
const InadimplenciaPage = pagina(() => import('@/pages/InadimplenciaPage'), 'InadimplenciaPage');
const ImportarArquivosPage = pagina(() => import('@/pages/ImportarArquivosPage'), 'ImportarArquivosPage');
const NovoClientePage = pagina(() => import('@/pages/NovoClientePage'), 'NovoClientePage');
const VisaoGeralPage = pagina(() => import('@/pages/VisaoGeralPage'), 'VisaoGeralPage');
const PainelCarteira = pagina(() => import('@/pages/dashboards/PainelCarteira'), 'PainelCarteira');
const PainelProducao = pagina(() => import('@/pages/dashboards/PainelProducao'), 'PainelProducao');
const PainelRamos = pagina(() => import('@/pages/dashboards/PainelRamos'), 'PainelRamos');
const PainelRenovacoes = pagina(() => import('@/pages/dashboards/PainelRenovacoes'), 'PainelRenovacoes');
const PainelSinistros = pagina(() => import('@/pages/dashboards/PainelSinistros'), 'PainelSinistros');
const PainelCancelamentos = pagina(() => import('@/pages/dashboards/PainelCancelamentos'), 'PainelCancelamentos');
// Nome próprio: components/configuracoes/PainelSeguradoras é a tela de Configurações.
const DashboardSeguradoras = pagina(() => import('@/pages/dashboards/PainelSeguradoras'), 'PainelSeguradoras');
const ConciliacaoPage = pagina(() => import('@/pages/financeiro/ConciliacaoPage'), 'ConciliacaoPage');
const EstornosPage = pagina(() => import('@/pages/financeiro/EstornosPage'), 'EstornosPage');
const PrevisaoEntradaPage = pagina(() => import('@/pages/financeiro/PrevisaoEntradaPage'), 'PrevisaoEntradaPage');
const FilaCadastroPage = pagina(() => import('@/pages/filas/FilaCadastroPage'), 'FilaCadastroPage');
const FilaEmissoesPage = pagina(() => import('@/pages/filas/FilaEmissoesPage'), 'FilaEmissoesPage');
const FilaSinistrosPage = pagina(() => import('@/pages/filas/FilaSinistrosPage'), 'FilaSinistrosPage');

/** Redireciona mantendo a busca da URL: `?prazo=30` sobrevive à mudança de endereço da fila. */
function RedirecionarMantendoBusca({ para }: { para: string }): React.JSX.Element {
  const { search } = useLocation();
  return <Navigate to={`${para}${search}`} replace />;
}

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sem-acesso" element={<SemAcessoPage />} />

          <Route path="/esqueci-senha" element={<EsqueciSenhaPage />} />
          <Route path="/redefinir-senha" element={<RedefinirSenhaPage />} />

          {/* Um único RotaProtegida no pai cobre todas as rotas internas. */}
          <Route
            element={
              <RotaProtegida permissoes={['dashboard.ver']}>
                <LayoutApp />
              </RotaProtegida>
            }
          >
            <Route path="/" element={<VisaoGeralPage />} />

            {/* As rotas dos painéis saem do catálogo. */}
            {AREAS.map((area) => (
              <Route
                key={area.chave}
                path={area.rota}
                element={
                  /* A permissão da área vale na ROTA, não só no menu. */
                  <ExigePermissao permissao={area.permissao}>
                    {area.chave === 'clientes' ? (
                      <PainelCarteira />
                    ) : area.chave === 'renovacoes' ? (
                      <PainelRenovacoes />
                    ) : area.chave === 'producao' ? (
                      <PainelProducao />
                    ) : area.chave === 'ramos' ? (
                      <PainelRamos />
                    ) : area.chave === 'seguradoras' ? (
                      <DashboardSeguradoras />
                    ) : area.chave === 'sinistros' ? (
                      <PainelSinistros />
                    ) : area.chave === 'cancelamentos' ? (
                      <PainelCancelamentos />
                    ) : (
                      <Navigate to="/" replace />
                    )}
                  </ExigePermissao>
                }
              />
            ))}

            {/* A rota antiga continua respondendo para não quebrar link salvo. */}
            <Route path="/clientes" element={<ClientesPage />} />
            <Route path="/clientes/novo" element={<NovoClientePage />} />
            <Route path="/clientes/cotacoes" element={<CotacoesPage />} />
            {/* Caminho antigo redireciona MANTENDO a busca (?prazo=30). */}
            <Route
              path="/clientes/renovacoes"
              element={<RedirecionarMantendoBusca para="/filas/renovacao" />}
            />
            <Route
              path="/filas/renovacao"
              element={
                <ExigePermissao permissao="apolices.ler">
                  <FilaRenovacaoPage />
                </ExigePermissao>
              }
            />
            {/* Caminho antigo continua respondendo para não quebrar link salvo. */}
            <Route path="/clientes/importar" element={<Navigate to="/importacoes" replace />} />
            <Route path="/consultas/clientes" element={<Navigate to="/clientes" replace />} />
            <Route path="/clientes/apolices" element={<ApolicesPage />} />
            <Route path="/consultas/apolices" element={<Navigate to="/clientes/apolices" replace />} />
            <Route path="/financeiro/inadimplencia" element={<InadimplenciaPage />} />
            {/* Mesma permissão de Comissões: o recebido não se recorta por carteira. */}
            <Route
              path="/financeiro/conciliacao"
              element={
                <ExigePermissao permissao="comissoes.todas">
                  <ConciliacaoPage />
                </ExigePermissao>
              }
            />
            <Route
              path="/financeiro/previsao"
              element={
                <ExigePermissao permissao="comissoes.todas">
                  <PrevisaoEntradaPage />
                </ExigePermissao>
              }
            />
            <Route
              path="/financeiro/estornos"
              element={
                <ExigePermissao permissao="comissoes.todas">
                  <EstornosPage />
                </ExigePermissao>
              }
            />
            {/* Caminho antigo continua respondendo para não quebrar link salvo. */}
            <Route
              path="/dashboards/comissoes"
              element={
                <ExigePermissao permissao="comissoes.todas">
                  <ComissoesPage />
                </ExigePermissao>
              }
            />
            <Route path="/financeiro/comissoes" element={<Navigate to="/dashboards/comissoes" replace />} />
            <Route path="/dashboards/receita" element={<Navigate to="/dashboards/comissoes" replace />} />
            <Route
              path="/financeiro/fila-comissoes"
              element={<RedirecionarMantendoBusca para="/filas/comissoes" />}
            />
            <Route path="/dashboards/previsoes" element={<Navigate to="/" replace />} />
            <Route
              path="/filas/comissoes"
              element={
                <ExigePermissao permissao="comissoes.todas">
                  <FilaComissoesPage />
                </ExigePermissao>
              }
            />
            <Route path="/financeiro" element={<Navigate to="/financeiro/inadimplencia" replace />} />
            {/* Cada fila exige a mesma permissão da rota da API que ela lê. */}
            <Route
              path="/filas/emissoes"
              element={
                <ExigePermissao permissao="apolices.ler">
                  <FilaEmissoesPage />
                </ExigePermissao>
              }
            />
            <Route
              path="/filas/cadastro"
              element={
                <ExigePermissao permissao="clientes.ler">
                  <FilaCadastroPage />
                </ExigePermissao>
              }
            />
            <Route
              path="/filas/sinistros"
              element={
                <ExigePermissao permissao="sinistros.ler">
                  <FilaSinistrosPage />
                </ExigePermissao>
              }
            />
            <Route path="/importacoes" element={<ImportarArquivosPage />} />
            <Route path="/importacoes/auditoria" element={<AuditoriaImportacoesPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
