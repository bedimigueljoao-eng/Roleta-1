import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Crosshair,
  ExternalLink,
  Eye,
  Globe,
  RotateCw,
  X,
} from 'lucide-react';
import {
  CasinoLayoutPreset,
  CurrencyCode,
  OCRFrameResult,
  ROIRect,
} from '../types/roulette';
import { EmbeddedLiveCasinoTable } from './EmbeddedLiveCasinoTable';

export const BUILTIN_TABLE_URL = 'mesa://europeia-ao-vivo';

type SplitHeightPct = 45 | 56 | 66;
type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

interface SplitScreenBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  activePreset: CasinoLayoutPreset;
  currency: CurrencyCode;
  isOcrActive: boolean;
  onToggleOcr: () => void;
  onStartExternalScreenCapture: () => Promise<void>;
  onUpdatePreset: (updated: CasinoLayoutPreset) => void;
  lastFrameResult: OCRFrameResult | null;
  embeddedCasinoCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  screenVideoRef: React.RefObject<HTMLVideoElement | null>;
  hasScreenStream: boolean;
  onUrlModeChange: (isBuiltIn: boolean) => void;
  onBetSettled?: (stake: number, payout: number, outcomeNum: number) => void;
}

function sanitizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === BUILTIN_TABLE_URL) return BUILTIN_TABLE_URL;

  const candidate =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export const SplitScreenBrowser: React.FC<SplitScreenBrowserProps> = ({
  isOpen,
  onClose,
  activePreset,
  currency,
  isOcrActive,
  onToggleOcr,
  onStartExternalScreenCapture,
  onUpdatePreset,
  lastFrameResult,
  embeddedCasinoCanvasRef,
  screenVideoRef,
  hasScreenStream,
  onUrlModeChange,
  onBetSettled,
}) => {
  const [splitHeightPct, setSplitHeightPct] = useState<SplitHeightPct>(56);
  const [historyStack, setHistoryStack] = useState<string[]>([BUILTIN_TABLE_URL]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [addressInput, setAddressInput] = useState<string>(BUILTIN_TABLE_URL);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [isLoadingExternal, setIsLoadingExternal] = useState<boolean>(false);
  const [externalErrorMsg, setExternalErrorMsg] = useState<string | null>(null);
  const [showMira, setShowMira] = useState<boolean>(true);
  const [showDebugBoxes, setShowDebugBoxes] = useState<boolean>(true);
  const [recentBookmarks, setRecentBookmarks] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('roletalab_browser_bookmarks_v1');
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    handle: DragHandle;
    startX: number;
    startY: number;
    startRoi: ROIRect;
  } | null>(null);

  const currentUrl = historyStack[historyIndex] ?? BUILTIN_TABLE_URL;
  const isBuiltInTable = currentUrl === BUILTIN_TABLE_URL;

  useEffect(() => {
    onUrlModeChange(isBuiltInTable);
  }, [isBuiltInTable, onUrlModeChange]);

  // Adjust default ROI to cleanly frame the top strip inside the built-in table
  useEffect(() => {
    if (isBuiltInTable && activePreset.roi.topRatio > 0.1) {
      // Only auto-adjust if user hasn't moved it onto the top strip bar
    }
  }, [isBuiltInTable, activePreset.roi.topRatio]);

  const navigateToUrl = (rawUrl: string) => {
    const safe = sanitizeBrowserUrl(rawUrl);
    if (!safe) {
      setExternalErrorMsg('URL inválido. Utilize apenas endereços https://, http:// ou mesa://europeia-ao-vivo.');
      return;
    }

    setExternalErrorMsg(null);
    setAddressInput(safe);

    const nextStack = [...historyStack.slice(0, historyIndex + 1), safe];
    setHistoryStack(nextStack);
    setHistoryIndex(nextStack.length - 1);

    if (safe !== BUILTIN_TABLE_URL) {
      setIsLoadingExternal(true);
      setRecentBookmarks((prev) => {
        const next = [safe, ...prev.filter((u) => u !== safe)].slice(0, 5);
        try {
          localStorage.setItem('roletalab_browser_bookmarks_v1', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    } else {
      setIsLoadingExternal(false);
    }
  };

  const handleBack = () => {
    if (historyIndex <= 0) return;
    const prevIdx = historyIndex - 1;
    setHistoryIndex(prevIdx);
    const target = historyStack[prevIdx];
    setAddressInput(target);
    setExternalErrorMsg(null);
    setIsLoadingExternal(target !== BUILTIN_TABLE_URL);
  };

  const handleReload = () => {
    setExternalErrorMsg(null);
    setReloadNonce((n) => n + 1);
    if (!isBuiltInTable) {
      setIsLoadingExternal(true);
    }
  };

  // Interactive ROI Dragging over the Embedded Browser Viewport
  const startRoiDrag = (e: React.PointerEvent, handle: DragHandle) => {
    if (!showMira) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRoi: { ...activePreset.roi },
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragStateRef.current;
    const vp = viewportRef.current;
    if (!drag || !vp) return;

    const rect = vp.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const s = drag.startRoi;
    const next: ROIRect = { ...s };

    if (drag.handle === 'move') {
      next.leftRatio = Math.max(0, Math.min(1 - s.widthRatio, s.leftRatio + dx));
      next.topRatio = Math.max(0, Math.min(1 - s.heightRatio, s.topRatio + dy));
    } else if (drag.handle === 'nw') {
      const newL = Math.max(0, Math.min(s.leftRatio + s.widthRatio - 0.1, s.leftRatio + dx));
      const newT = Math.max(0, Math.min(s.topRatio + s.heightRatio - 0.05, s.topRatio + dy));
      next.widthRatio = s.widthRatio + (s.leftRatio - newL);
      next.heightRatio = s.heightRatio + (s.topRatio - newT);
      next.leftRatio = newL;
      next.topRatio = newT;
    } else if (drag.handle === 'ne') {
      const newT = Math.max(0, Math.min(s.topRatio + s.heightRatio - 0.05, s.topRatio + dy));
      next.widthRatio = Math.max(0.1, Math.min(1 - s.leftRatio, s.widthRatio + dx));
      next.heightRatio = s.heightRatio + (s.topRatio - newT);
      next.topRatio = newT;
    } else if (drag.handle === 'sw') {
      const newL = Math.max(0, Math.min(s.leftRatio + s.widthRatio - 0.1, s.leftRatio + dx));
      next.widthRatio = s.widthRatio + (s.leftRatio - newL);
      next.leftRatio = newL;
      next.heightRatio = Math.max(0.05, Math.min(1 - s.topRatio, s.heightRatio + dy));
    } else if (drag.handle === 'se') {
      next.widthRatio = Math.max(0.1, Math.min(1 - s.leftRatio, s.widthRatio + dx));
      next.heightRatio = Math.max(0.05, Math.min(1 - s.topRatio, s.heightRatio + dy));
    }

    onUpdatePreset({
      ...activePreset,
      roi: {
        leftRatio: Number(next.leftRatio.toFixed(4)),
        topRatio: Number(next.topRatio.toFixed(4)),
        widthRatio: Number(next.widthRatio.toFixed(4)),
        heightRatio: Number(next.heightRatio.toFixed(4)),
      },
    });
  };

  const endRoiDrag = () => {
    dragStateRef.current = null;
  };

  // For built-in table, the strip canvas sits in the top ~112px (~26% of browser height)
  // Keep ROI overlay relative to the full viewport (or strip canvas in built-in mode)
  const overlayRoi: ROIRect = isBuiltInTable
    ? {
        leftRatio: 0.015,
        topRatio: 0.06,
        widthRatio: 0.97,
        heightRatio: 0.2,
      }
    : activePreset.roi;

  if (!isOpen) return null;

  const viewportHeightClass =
    splitHeightPct === 45
      ? 'h-[360px]'
      : splitHeightPct === 56
      ? 'h-[450px]'
      : 'h-[540px]';

  return (
    <section
      aria-label="Navegador Embutido Split-Screen"
      className="bg-[#0B0F17] border border-slate-700/90 rounded-xl overflow-hidden shadow-lg"
    >
      {/* Embedded Browser Address & Action Bar */}
      <div className="bg-[#111827] border-b border-slate-800 px-3 py-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleBack}
            disabled={historyIndex <= 0}
            title="Voltar"
            className="p-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-200 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleReload}
            title="Recarregar"
            className="p-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoadingExternal ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Address Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigateToUrl(addressInput);
          }}
          className="flex-1 min-w-[220px] flex items-center gap-1.5"
        >
          <div className="flex-1 flex items-center gap-2 bg-[#0B0F17] border border-slate-700 rounded-lg px-2.5 py-1.5">
            <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Digite https://... da casa de apostas ou mesa://europeia-ao-vivo"
              className="w-full bg-transparent text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-100 cursor-pointer shrink-0"
          >
            Ir
          </button>
        </form>

        {/* Browser Controls: OCR ON/OFF, Mira, Debug, Split %, External, Close */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleOcr}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              isOcrActive
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            OCR {isOcrActive ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() => setShowMira((m) => !m)}
            title="Calibração Visual da ROI (Mira)"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer whitespace-nowrap ${
              showMira
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-700 bg-slate-900 text-slate-300'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            Mira
          </button>

          <button
            type="button"
            onClick={() => setShowDebugBoxes((d) => !d)}
            title="Caixas de Debug OCR"
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium cursor-pointer whitespace-nowrap ${
              showDebugBoxes
                ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Debug
          </button>

          {/* 45% / 56% / 66% Split Height */}
          <div className="hidden sm:flex items-center border border-slate-700 rounded-lg overflow-hidden bg-slate-900">
            {([45, 56, 66] as SplitHeightPct[]).map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setSplitHeightPct(pct)}
                className={`px-2 py-1 text-[11px] font-mono cursor-pointer ${
                  splitHeightPct === pct
                    ? 'bg-slate-700 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>

          {!isBuiltInTable && (
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir site externo em nova aba (fallback Cloudflare)"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Externo
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            title="Fechar navegador embutido"
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Bookmarks Strip */}
      <div className="bg-[#0D131F] border-b border-slate-800/80 px-3 py-1.5 flex items-center gap-2 overflow-x-auto text-[11px]">
        <button
          type="button"
          onClick={() => navigateToUrl(BUILTIN_TABLE_URL)}
          className={`px-2 py-0.5 rounded border whitespace-nowrap cursor-pointer ${
            isBuiltInTable
              ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300 font-medium'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
          }`}
        >
          Mesa Integrada (Apostas &amp; Leitura Direta)
        </button>

        {recentBookmarks.map((bm) => (
          <button
            key={bm}
            type="button"
            onClick={() => navigateToUrl(bm)}
            className={`px-2 py-0.5 rounded border whitespace-nowrap max-w-[200px] truncate cursor-pointer ${
              currentUrl === bm
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            {bm.replace(/^https?:\/\//, '')}
          </button>
        ))}

        {!isBuiltInTable && (
          <button
            type="button"
            onClick={() => void onStartExternalScreenCapture()}
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-sky-600/60 bg-sky-500/10 text-sky-300 whitespace-nowrap cursor-pointer"
          >
            <Camera className="w-3 h-3" />
            {hasScreenStream ? 'Captura de Aba/Janela Ativa' : 'Capturar Pixels desta Aba/Janela'}
          </button>
        )}
      </div>

      {/* FrameLayout Viewport (Browser Content + ProgressBar + Error Bar + ROI Overlay + DebugBoxesView) */}
      <div
        ref={viewportRef}
        onPointerMove={handlePointerMove}
        onPointerUp={endRoiDrag}
        className={`relative w-full ${viewportHeightClass} bg-[#0B0F17] overflow-hidden`}
      >
        {/* Thin ProgressBar */}
        {isLoadingExternal && (
          <div className="absolute top-0 left-0 right-0 z-30 h-0.5 bg-slate-800 overflow-hidden">
            <div className="h-full w-1/2 bg-emerald-400 animate-pulse" />
          </div>
        )}

        {/* Friendly Error / Fallback Bar for External Sites */}
        {!isBuiltInTable && externalErrorMsg && (
          <div className="absolute top-2 left-2 right-2 z-30 bg-slate-950/95 border border-amber-700/70 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
            <span>{externalErrorMsg}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReload}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 cursor-pointer"
              >
                Recarregar
              </button>
              <a
                href={currentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Abrir Externo
              </a>
              <button
                type="button"
                onClick={() => void onStartExternalScreenCapture()}
                className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
              >
                Capturar Janela (OCR)
              </button>
            </div>
          </div>
        )}

        {/* Content Layer: Built-in Interactive Casino Table OR External Iframe */}
        {isBuiltInTable ? (
          <EmbeddedLiveCasinoTable
            activePreset={activePreset}
            currency={currency}
            casinoCanvasRef={embeddedCasinoCanvasRef}
            onBetSettled={onBetSettled}
          />
        ) : (
          <div className="w-full h-full relative bg-[#0B0F17]">
            <iframe
              key={`${currentUrl}_${reloadNonce}`}
              src={currentUrl}
              title="Navegador Embutido RoletaLab"
              referrerPolicy="no-referrer"
              onLoad={() => setIsLoadingExternal(false)}
              onError={() => {
                setIsLoadingExternal(false);
                setExternalErrorMsg(
                  'Este site bloqueou incorporação direta (X-Frame-Options / Cloudflare). Abra em aba externa e ative a Captura OCR.'
                );
              }}
              className="w-full h-full border-0 bg-[#0B0F17]"
            />

            {/* Subtle info strip at bottom of external iframe explaining Screen Capture fallback */}
            <div className="absolute bottom-2 right-2 z-20 flex items-center gap-2 bg-slate-950/90 border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] text-slate-300">
              <span>Se o site ficar branco (Cloudflare/X-Frame), abra em</span>
              <a
                href={currentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline font-medium"
              >
                Nova Aba
              </a>
              <span>e clique em</span>
              <button
                type="button"
                onClick={() => void onStartExternalScreenCapture()}
                className="text-sky-400 underline font-medium cursor-pointer"
              >
                Capturar Janela
              </button>
            </div>

            {/* Info indicator when capturing external window/tab */}
            {hasScreenStream && (
              <div className="absolute top-2 right-2 z-20 px-2.5 py-1 rounded bg-emerald-600/90 text-[11px] font-mono text-white">
                OCR Externo Ativo
              </div>
            )}
          </div>
        )}

        {/* ROI Overlay (Green Dashed Box with 4 draggable corners) */}
        {showMira && (
          <div
            onPointerDown={isBuiltInTable ? undefined : (e) => startRoiDrag(e, 'move')}
            style={{
              left: `${overlayRoi.leftRatio * 100}%`,
              top: `${overlayRoi.topRatio * 100}%`,
              width: `${overlayRoi.widthRatio * 100}%`,
              height: `${overlayRoi.heightRatio * 100}%`,
            }}
            className={`absolute z-20 border-2 border-dashed border-emerald-400 bg-emerald-500/5 pointer-events-auto ${
              isBuiltInTable ? 'pointer-events-none' : 'cursor-move'
            }`}
          >
            <div className="absolute -top-5 left-0 px-1.5 py-0.5 bg-emerald-600 text-[10px] font-mono text-white rounded-t whitespace-nowrap">
              ROI {isOcrActive ? '· OCR ATIVO' : '· MIRA'}
            </div>

            {!isBuiltInTable && (
              <>
                <div
                  onPointerDown={(e) => startRoiDrag(e, 'nw')}
                  className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-emerald-400 border border-slate-950 rounded-sm cursor-nwse-resize"
                />
                <div
                  onPointerDown={(e) => startRoiDrag(e, 'ne')}
                  className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-emerald-400 border border-slate-950 rounded-sm cursor-nesw-resize"
                />
                <div
                  onPointerDown={(e) => startRoiDrag(e, 'sw')}
                  className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-emerald-400 border border-slate-950 rounded-sm cursor-nesw-resize"
                />
                <div
                  onPointerDown={(e) => startRoiDrag(e, 'se')}
                  className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-emerald-400 border border-slate-950 rounded-sm cursor-nwse-resize"
                />
              </>
            )}
          </div>
        )}

        {/* DebugBoxesView Overlay */}
        {showDebugBoxes && lastFrameResult && lastFrameResult.allBoxes.length > 0 && (
          <div
            style={{
              left: `${overlayRoi.leftRatio * 100}%`,
              top: `${overlayRoi.topRatio * 100}%`,
              width: `${overlayRoi.widthRatio * 100}%`,
              height: `${overlayRoi.heightRatio * 100}%`,
            }}
            className="absolute z-25 pointer-events-none"
          >
            {lastFrameResult.allBoxes.map((box) => {
              const leftPct =
                lastFrameResult.roiWidth > 0
                  ? (box.x / lastFrameResult.roiWidth) * 100
                  : 0;
              const widthPct =
                lastFrameResult.roiWidth > 0
                  ? (box.width / lastFrameResult.roiWidth) * 100
                  : 8;
              return (
                <div
                  key={box.index}
                  style={{
                    left: `${leftPct}%`,
                    top: '8%',
                    width: `${widthPct}%`,
                    height: '84%',
                  }}
                  className={`absolute border ${
                    box.number !== null
                      ? 'border-sky-400/90'
                      : 'border-red-500/80'
                  }`}
                >
                  <span className="absolute -bottom-4 left-0 px-1 rounded bg-slate-950/90 font-mono text-[9px] text-sky-300 whitespace-nowrap">
                    {box.number !== null ? `${box.number}` : '×'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
