import React, { useState } from 'react';
import { Check, Copy, Download, Github, Smartphone, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

const GIT_CLONE_COMMANDS = `git clone https://github.com/<seu-usuario>/<seu-repositorio>.git
cd <seu-repositorio>
npm install
npm run build`;

const CAPACITOR_APK_COMMANDS = `npm install
npm run build
npm install -D @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug`;

export const AppInstallAndGitHubControls: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [showModal, setShowModal] = useState(false);
  const [copiedId, setCopiedId] = useState<'clone' | 'apk' | null>(null);

  const handleCopy = async (text: string, id: 'clone' | 'apk') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {!isInstalled && isInstallable && (
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Instalar App
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 whitespace-nowrap cursor-pointer"
        >
          <Github className="w-3.5 h-3.5" />
          GitHub &amp; APK
        </button>
      </div>

      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 px-3 py-1.5 rounded-lg bg-amber-600 text-xs font-medium text-white shadow-lg">
          Modo Offline — Dados em cache local ativos
        </div>
      )}

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Baixar no GitHub e Instalar Aplicação"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-2xl bg-[#111827] border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Github className="w-4 h-4 text-emerald-400" />
                <h2 className="text-base font-semibold text-slate-100">
                  Baixar pelo GitHub, Instalar PWA &amp; Gerar APK Android
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-300 max-h-[75vh] overflow-y-auto">
              <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3.5 space-y-2">
                <p className="font-semibold text-slate-100">
                  1. Publicar e Baixar via GitHub Releases (Web ZIP + Android APK)
                </p>
                <p className="text-slate-400 leading-relaxed">
                  O repositório já inclui o workflow{' '}
                  <code className="font-mono text-emerald-400">
                    .github/workflows/release.yml
                  </code>{' '}
                  e{' '}
                  <code className="font-mono text-emerald-400">
                    capacitor.config.json
                  </code>
                  . Ao enviar o projeto para o GitHub (via opção{' '}
                  <em>Export to GitHub</em> ou push) e criar uma tag{' '}
                  <code className="font-mono text-slate-200">v1.0.0</code>, o GitHub Actions compila automaticamente{' '}
                  <strong className="text-slate-100">RoletaLab-Android.apk</strong> e{' '}
                  <strong className="text-slate-100">RoletaLab-Web.zip</strong> na aba{' '}
                  <strong>Releases</strong> para download direto.
                </p>
              </div>

              {!isInstalled && (
                <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-100 flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                      2. Instalar Diretamente no Dispositivo (PWA Standalone)
                    </p>
                    {isInstallable && (
                      <button
                        type="button"
                        onClick={() => void install()}
                        className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                      >
                        Instalar Agora
                      </button>
                    )}
                  </div>
                  {isIOS ? (
                    <p className="text-slate-400">
                      No Safari (iPhone/iPad): toque no botão <strong>Partilhar</strong> e depois em{' '}
                      <strong>Adicionar ao ecrã inicial</strong>.
                    </p>
                  ) : (
                    <p className="text-slate-400">
                      No Chrome/Edge (Android ou PC): utilize o botão{' '}
                      <strong>Instalar App</strong> ou o ícone de instalação na barra de endereço do navegador.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">
                    3. Clonar do GitHub &amp; Executar Localmente
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopy(GIT_CLONE_COMMANDS, 'clone')}
                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    {copiedId === 'clone' ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copiar
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-[#070B12] border border-slate-800 font-mono text-[11px] text-slate-200 overflow-x-auto">
                  {GIT_CLONE_COMMANDS}
                </pre>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">
                    4. Compilar APK Android Localmente (Capacitor)
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopy(CAPACITOR_APK_COMMANDS, 'apk')}
                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    {copiedId === 'apk' ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copiar
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-[#070B12] border border-slate-800 font-mono text-[11px] text-slate-200 overflow-x-auto">
                  {CAPACITOR_APK_COMMANDS}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
