import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Crosshair,
  ExternalLink,
  Eye,
  Globe,
  Move,
  Pipette,
  RotateCw,
  X,
} from 'lucide-react';
import { calibrateProfileFromPixel, rgbToHsv } from '../ocr/hsvColorClassifier';
import {
  CasinoLayoutPreset,
  CurrencyCode,
  OCRFrameResult,
  ROIRect,
  RouletteColor,
} from '../types/roulette';
import { EmbeddedLiveCasinoTable } from './EmbeddedLiveCasinoTable';

export const BUILTIN_TABLE_URL = 'mesa://europeia-ao-vivo';
export const KWANZABET_URL = 'https://m.kwanzabet.ao';

type SplitHeightPct = 45 | 56 | 66;
type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | null;

interface SplitScreenBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  activePreset: CasinoLayoutPreset;
  currency: CurrencyCode;
  isOcrActive: boolean;
  onToggleOcr: () => void;
  onStartExternalScreenCapture: () => Promise<void>;
  onStopScreenCapture: () => void;
  onUpdatePreset: (updated: CasinoLayoutPreset) => void;
  roi: ROIRect;
  onChangeRoi: (roi: ROIRect) => void;
  lastFrameResult: OCRFrameResult | null;
  embeddedCasinoCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  browserVideoRef: React.RefObject<HTMLVideoElement | null>;
  mediaStream: MediaStream | null;
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
  onStopScreenCapture,
  onUpdatePreset,
  roi,
  onChangeRoi,
  lastFrameResult,
  embeddedCasinoCanvasRef,
  browserVideoRef,
  mediaStream,
  onUrlModeChange,
  onBetSettled,
}) => {
  const [splitHeightPct, setSplitHeightPct] = useState<SplitHeightPct>(56);
  const [historyStack, setHistoryStack] = useState<string[]>([BUILTIN_TABLE_URL]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [addressInput, setAddressInput] = useState<string>(BUILTIN_TABLE_URL);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [isLoadingExternal, setIsLoadingExternal] = useState<boolean>(false);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const [showMira, setShowMira] = useState<boolean>(true);
  const [showRoiPrecisionBar, setShowRoiPrecisionBar] = useState<boolean>(true);
  const [showDebugBoxes, setShowDebugBoxes] = useState<boolean>(true);
  const [eyedropperTarget, setEyedropperTarget] = useState<RouletteColor | null>(null);
  const [lastHsvSample, setLastHsvSample] = useState<string | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number>(16 / 9);
  const [proxyAvailable, setProxyAvailable] = useState<boolean>(false);

  const [recentBookmarks, setRecentBookmarks] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('roletalab_browser_bookmarks_v1');
      const parsed = saved ? (JSON.parse(saved) as string[]) : [];
      if (!parsed.includes(KWANZABET_URL)) {
        return [KWANZABET_URL, ...parsed].slice(0, 5);
      }
      return parsed;
    } catch {
      return [KWANZABET_URL];
    }
  });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    handle: DragHandle;
    startX: number;
    startY: number;
    startRoi: ROIRect;
    containerWidth: number;
    containerHeight: number;
  } | null>(null);

  const currentUrl = historyStack[historyIndex] ?? BUILTIN_TABLE_URL;
  const isBuiltInTable = currentUrl === BUILTIN_TABLE_URL;
  const hasStream = mediaStream !== null;

  useEffect(() => {
    onUrlModeChange(isBuiltInTable);
  }, [isBuiltInTable, onUrlModeChange]);

  // Attach MediaStream directly to the visible video element inside the Split-Screen Browser
  useEffect(() => {
    const videoEl = browserVideoRef.current;
    if (!videoEl) return;
    if (mediaStream) {
      videoEl.srcObject = mediaStream;
      void videoEl.play().catch(() => {
        // Autoplay handled by muted + playsInline
      });
    } else {
      videoEl.srcObject = null;
    }
  }, [mediaStream, browserVideoRef, isBuiltInTable]);

  // Detect whether the Express same-origin browser proxy (/api/proxy-status) is active
  useEffect(() => {
    let cancelled = false;
    fetch('/api/proxy-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { enabled?: boolean } | null) => {
        if (!cancelled && data?.enabled) {
          setProxyAvailable(true);
        }
      })
      .catch(() => {
        // Static/offline APK build without Express proxy
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Show helpful fallback notice when running without backend proxy on external URLs
  useEffect(() => {
    if (isBuiltInTable || hasStream) {
      setIsLoadingExternal(false);
      return;
    }
    const t = window.setTimeout(() => {
      setIsLoadingExternal(false);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [isBuiltInTable, hasStream, currentUrl, reloadNonce]);

  const navigateToUrl = (rawUrl: string) => {
    const safe = sanitizeBrowserUrl(rawUrl);
    if (!safe) {
      setExternalNotice(
        'URL inválido. Utilize apenas endereços https://, http:// ou mesa://europeia-ao-vivo.'
      );
      return;
    }

    setAddressInput(safe);

    const nextStack = [...historyStack.slice(0, historyIndex + 1), safe];
    setHistoryStack(nextStack);
    setHistoryIndex(nextStack.length - 1);

    if (safe !== BUILTIN_TABLE_URL) {
      setIsLoadingExternal(true);
      setExternalNotice(
        proxyAvailable
          ? null
          : 'Modo estático sem proxy: se o site bloquear o iframe, use os 2 passos abaixo.'
      );
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
      if (hasStream) {
        onStopScreenCapture();
      }
      setExternalNotice(null);
      setIsLoadingExternal(false);
    }
  };

  const handleBack = () => {
    if (historyIndex <= 0) return;
    const prevIdx = historyIndex - 1;
    setHistoryIndex(prevIdx);
    const target = historyStack[prevIdx];
    setAddressInput(target);
    setExternalNotice(null);
    setIsLoadingExternal(target !== BUILTIN_TABLE_URL);
  };

  const handleReload = () => {
    setExternalNotice(null);
    setReloadNonce((n) => n + 1);
    if (!isBuiltInTable) {
      setIsLoadingExternal(true);
    }
  };

  // Interactive ROI Drag & 8-handle Resize over the Browser / Video / Strip Viewport
  const startRoiDrag = (e: React.PointerEvent, handle: DragHandle) => {
    if (!showMira || eyedropperTarget !== null) return;
    e.stopPropagation();
    const targetEl = e.currentTarget as HTMLElement;
    targetEl.setPointerCapture(e.pointerId);
    const roiBoxEl = handle === 'move' ? targetEl : targetEl.parentElement;
    const containerEl = roiBoxEl?.parentElement ?? viewportRef.current;
    const rect = containerEl?.getBoundingClientRect();
    dragStateRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRoi: { ...roi },
      containerWidth: Math.max(100, rect?.width ?? 600),
      containerHeight: Math.max(40, rect?.height ?? 200),
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag) return;

    const dx = (e.clientX - drag.startX) / drag.containerWidth;
    const dy = (e.clientY - drag.startY) / drag.containerHeight;
    const s = drag.startRoi;
    const next: ROIRect = { ...s };
    const minW = 0.08;
    const minH = 0.05;

    if (drag.handle === 'move') {
      next.leftRatio = Math.max(0, Math.min(1 - s.widthRatio, s.leftRatio + dx));
      next.topRatio = Math.max(0, Math.min(1 - s.heightRatio, s.topRatio + dy));
    } else {
      if (drag.handle === 'nw' || drag.handle === 'sw' || drag.handle === 'w') {
        const newL = Math.max(0, Math.min(s.leftRatio + s.widthRatio - minW, s.leftRatio + dx));
        next.widthRatio = s.widthRatio + (s.leftRatio - newL);
        next.leftRatio = newL;
      }
      if (drag.handle === 'ne' || drag.handle === 'se' || drag.handle === 'e') {
        next.widthRatio = Math.max(minW, Math.min(1 - s.leftRatio, s.widthRatio + dx));
      }
      if (drag.handle === 'nw' || drag.handle === 'ne' || drag.handle === 'n') {
        const newT = Math.max(0, Math.min(s.topRatio + s.heightRatio - minH, s.topRatio + dy));
        next.heightRatio = s.heightRatio + (s.topRatio - newT);
        next.topRatio = newT;
      }
      if (drag.handle === 'sw' || drag.handle === 'se' || drag.handle === 's') {
        next.heightRatio = Math.max(minH, Math.min(1 - s.topRatio, s.heightRatio + dy));
      }
    }

    onChangeRoi({
      leftRatio: Number(next.leftRatio.toFixed(4)),
      topRatio: Number(next.topRatio.toFixed(4)),
      widthRatio: Number(next.widthRatio.toFixed(4)),
      heightRatio: Number(next.heightRatio.toFixed(4)),
    });
  };

  const endRoiDrag = () => {
    dragStateRef.current = null;
  };

  // Eyedropper directly on the live captured video or built-in canvas
  const handleEyedropperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!eyedropperTarget) return;

    let r = 0;
    let g = 0;
    let b = 0;

    if (hasStream && browserVideoRef.current && browserVideoRef.current.videoWidth > 0) {
      const v = browserVideoRef.current;
      const vrect = v.getBoundingClientRect();
      const rx = Math.min(1, Math.max(0, (e.clientX - vrect.left) / Math.max(1, vrect.width)));
      const ry = Math.min(1, Math.max(0, (e.clientY - vrect.top) / Math.max(1, vrect.height)));
      const tmp = document.createElement('canvas');
      tmp.width = v.videoWidth;
      tmp.height = v.videoHeight;
      const tctx = tmp.getContext('2d');
      if (!tctx) return;
      tctx.drawImage(v, 0, 0);
      const px = Math.min(v.videoWidth - 1, Math.max(0, Math.round(rx * v.videoWidth)));
      const py = Math.min(v.videoHeight - 1, Math.max(0, Math.round(ry * v.videoHeight)));
      const d = tctx.getImageData(px, py, 1, 1).data;
      r = d[0];
      g = d[1];
      b = d[2];
    } else if (isBuiltInTable && embeddedCasinoCanvasRef.current) {
      const c = embeddedCasinoCanvasRef.current;
      const crect = c.getBoundingClientRect();
      const cxRatio = (e.clientX - crect.left) / Math.max(1, crect.width);
      const cyRatio = (e.clientY - crect.top) / Math.max(1, crect.height);
      const cctx = c.getContext('2d');
      if (!cctx) return;
      const px = Math.min(c.width - 1, Math.max(0, Math.round(cxRatio * c.width)));
      const py = Math.min(c.height - 1, Math.max(0, Math.round(cyRatio * c.height)));
      const d = cctx.getImageData(px, py, 1, 1).data;
      r = d[0];
      g = d[1];
      b = d[2];
    } else {
      return;
    }

    const hsv = rgbToHsv(r, g, b);
    const updatedProfile = calibrateProfileFromPixel(
      activePreset.hsvProfile,
      eyedropperTarget,
      r,
      g,
      b
    );
    onUpdatePreset({ ...activePreset, hsvProfile: updatedProfile });
    setLastHsvSample(
      `${eyedropperTarget}: H=${hsv.h.toFixed(0)}° S=${(hsv.s * 100).toFixed(0)}% V=${(
        hsv.v * 100
      ).toFixed(0)}%`
    );
    setEyedropperTarget(null);
  };

  const resetRoiToDefault = () => {
    onChangeRoi(
      isBuiltInTable && !hasStream
        ? { leftRatio: 0.0145, topRatio: 0.232, widthRatio: 0.9708, heightRatio: 0.6786 }
        : { leftRatio: 0.08, topRatio: 0.14, widthRatio: 0.84, heightRatio: 0.14 }
    );
  };

  if (!isOpen) return null;

  const viewportHeightClass =
    splitHeightPct === 45
      ? 'h-[360px]'
      : splitHeightPct === 56
      ? 'h-[450px]'
      : 'h-[540px]';

  // For built-in table, the ROI overlay sits inside the top 112px strip canvas container so coordinates are 1:1
  const renderRoiOverlay = () => (
    <>
      {showMira && (
        <div
          onPointerDown={(e) => startRoiDrag(e, 'move')}
          style={{
            left: `${roi.leftRatio * 100}%`,
            top: `${roi.topRatio * 100}%`,
            width: `${roi.widthRatio * 100}%`,
            height: `${roi.heightRatio * 100}%`,
          }}
          className={`absolute z-20 border-2 border-dashed border-emerald-400 bg-emerald-500/10 ${
            eyedropperTarget ? 'pointer-events-none' : 'cursor-move'
          }`}
        >
          <div className="absolute -top-5 left-0 px-1.5 py-0.5 bg-emerald-600 text-[10px] font-mono text-white rounded-t flex items-center gap-1 whitespace-nowrap">
            <Move className="w-2.5 h-2.5" />
            Quadro OCR ({activePreset.expectedCells} cél.) {isOcrActive ? '· ATIVO' : ''}
          </div>

          {/* 4 Corner Handles */}
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

          {/* 4 Edge Handles for fine height/width stretching */}
          <div
            onPointerDown={(e) => startRoiDrag(e, 'n')}
            className="absolute -top-1 left-1/2 -translate-x-1/2 w-8 h-2 bg-emerald-400/90 rounded-full cursor-ns-resize"
          />
          <div
            onPointerDown={(e) => startRoiDrag(e, 's')}
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-2 bg-emerald-400/90 rounded-full cursor-ns-resize"
          />
          <div
            onPointerDown={(e) => startRoiDrag(e, 'w')}
            className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-6 bg-emerald-400/90 rounded-full cursor-ew-resize"
          />
          <div
            onPointerDown={(e) => startRoiDrag(e, 'e')}
            className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-6 bg-emerald-400/90 rounded-full cursor-ew-resize"
          />
        </div>
      )}

      {showDebugBoxes && lastFrameResult && lastFrameResult.allBoxes.length > 0 && (
        <div
          style={{
            left: `${roi.leftRatio * 100}%`,
            top: `${roi.topRatio * 100}%`,
            width: `${roi.widthRatio * 100}%`,
            height: `${roi.heightRatio * 100}%`,
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
                  box.number !== null ? 'border-sky-400/90' : 'border-red-500/80'
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
    </>
  );

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
              placeholder="https://m.kwanzabet.ao ou mesa://europeia-ao-vivo"
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
            onClick={() => {
              setShowMira((m) => !m);
              setShowRoiPrecisionBar((r) => !r);
            }}
            title="Mostrar/Redirecionar Quadro OCR (Mira)"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer whitespace-nowrap ${
              showMira
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-700 bg-slate-900 text-slate-300'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            Quadro OCR
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
              title="Abrir site em nova aba"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir Site
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

      {/* Quick Bookmarks & Screen Stream Controls */}
      <div className="bg-[#0D131F] border-b border-slate-800/80 px-3 py-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => navigateToUrl(BUILTIN_TABLE_URL)}
          className={`px-2 py-0.5 rounded border whitespace-nowrap cursor-pointer ${
            isBuiltInTable && !hasStream
              ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300 font-medium'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
          }`}
        >
          Mesa Integrada
        </button>

        <button
          type="button"
          onClick={() => navigateToUrl(KWANZABET_URL)}
          className={`px-2 py-0.5 rounded border whitespace-nowrap cursor-pointer ${
            currentUrl.startsWith(KWANZABET_URL)
              ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300 font-medium'
              : 'border-slate-800 bg-slate-900 text-slate-300 hover:text-white'
          }`}
        >
          m.kwanzabet.ao
        </button>

        {recentBookmarks
          .filter((bm) => bm !== KWANZABET_URL)
          .map((bm) => (
            <button
              key={bm}
              type="button"
              onClick={() => navigateToUrl(bm)}
              className={`px-2 py-0.5 rounded border whitespace-nowrap max-w-[180px] truncate cursor-pointer ${
                currentUrl === bm
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {bm.replace(/^https?:\/\//, '')}
            </button>
          ))}

        <div className="ml-auto flex items-center gap-2">
          {!hasStream ? (
            <button
              type="button"
              onClick={() => void onStartExternalScreenCapture()}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded border border-sky-600/70 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 font-medium whitespace-nowrap cursor-pointer"
            >
              <Camera className="w-3 h-3" />
              Capturar Aba/Janela do KwanzaBet
            </button>
          ) : (
            <button
              type="button"
              onClick={onStopScreenCapture}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded border border-red-600/70 bg-red-500/15 hover:bg-red-500/25 text-red-300 font-medium whitespace-nowrap cursor-pointer"
            >
              Parar Stream de Captura
            </button>
          )}
        </div>
      </div>

      {/* Main Browser / Live Stream Viewport */}
      <div
        ref={viewportRef}
        onPointerMove={handlePointerMove}
        onPointerUp={endRoiDrag}
        onPointerCancel={endRoiDrag}
        onClick={handleEyedropperClick}
        className={`relative w-full ${viewportHeightClass} bg-[#0B0F17] overflow-hidden select-none ${
          eyedropperTarget ? 'cursor-crosshair' : ''
        }`}
      >
        {/* Thin loading bar */}
        {isLoadingExternal && !hasStream && (
          <div className="absolute top-0 left-0 right-0 z-30 h-0.5 bg-slate-800 overflow-hidden">
            <div className="h-full w-1/2 bg-emerald-400 animate-pulse" />
          </div>
        )}

        {/* Live Screen Capture Video Feed (Aspect-matched so ROI maps 1:1 to video pixels) */}
        {hasStream ? (
          <div className="w-full h-full bg-black flex items-center justify-center p-1">
            <div
              className="relative max-w-full max-h-full h-full flex items-center justify-center"
              style={{ aspectRatio: `${videoAspectRatio}` }}
            >
              <video
                ref={browserVideoRef}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth > 0 && v.videoHeight > 0) {
                    setVideoAspectRatio(v.videoWidth / v.videoHeight);
                  }
                }}
                onResize={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth > 0 && v.videoHeight > 0) {
                    setVideoAspectRatio(v.videoWidth / v.videoHeight);
                  }
                }}
                className="w-full h-full object-fill bg-black rounded border border-slate-800"
              />
              {renderRoiOverlay()}
            </div>
          </div>
        ) : isBuiltInTable ? (
          <div className="relative w-full h-full">
            <EmbeddedLiveCasinoTable
              activePreset={activePreset}
              currency={currency}
              casinoCanvasRef={embeddedCasinoCanvasRef}
              onBetSettled={onBetSettled}
              roiOverlaySlot={renderRoiOverlay()}
            />
          </div>
        ) : (
          <div className="relative w-full h-full bg-[#0B0F17] flex flex-col">
            {/* Persistent, dismissible action bar for X-Frame-Options blocked sites like m.kwanzabet.ao */}
            {externalNotice && (
              <div className="z-30 bg-slate-950/95 border-b border-amber-600/70 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-amber-200 leading-snug flex-1 min-w-[240px]">
                  {externalNotice}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={currentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    1. Abrir {currentUrl.replace(/^https?:\/\//, '')} em Nova Aba
                  </a>
                  <button
                    type="button"
                    onClick={() => void onStartExternalScreenCapture()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white cursor-pointer whitespace-nowrap"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    2. Capturar Aba para OCR ao Vivo
                  </button>
                  <button
                    type="button"
                    onClick={handleReload}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 cursor-pointer whitespace-nowrap"
                  >
                    Recarregar
                  </button>
                  <button
                    type="button"
                    onClick={() => setExternalNotice(null)}
                    title="Ocultar aviso"
                    className="p-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="relative flex-1 w-full">
              {(() => {
                let iframeSrc = currentUrl;
                if (proxyAvailable) {
                  try {
                    const parsed = new URL(currentUrl);
                    const proto = parsed.protocol.replace(':', '');
                    iframeSrc = `/browse/${proto}/${parsed.host}${parsed.pathname}${parsed.search}`;
                  } catch {
                    iframeSrc = currentUrl;
                  }
                }
                return (
                  <iframe
                    key={`${iframeSrc}_${reloadNonce}`}
                    src={iframeSrc}
                    title="Navegador Embutido RoletaLab"
                    referrerPolicy={proxyAvailable ? 'same-origin' : 'no-referrer'}
                    onLoad={() => setIsLoadingExternal(false)}
                    onError={() => {
                      setIsLoadingExternal(false);
                      setExternalNotice(
                        'Não foi possível abrir diretamente aqui. Abra em Nova Aba e clique em "Capturar Aba para OCR ao Vivo".'
                      );
                    }}
                    className="w-full h-full border-0 bg-[#0B0F17]"
                  />
                );
              })()}
              {renderRoiOverlay()}
            </div>
          </div>
        )}
      </div>

      {/* Precision ROI Redirect / Resize & HSV Eyedropper Bar */}
      {showRoiPrecisionBar && (
        <div className="bg-[#0E1420] border-t border-slate-800 px-3 py-2 flex flex-wrap items-center gap-3 text-[11px]">
          <span className="font-semibold text-emerald-400 flex items-center gap-1 whitespace-nowrap">
            <Move className="w-3.5 h-3.5" />
            Redirecionar Quadro OCR:
          </span>

          <label className="flex items-center gap-1.5 text-slate-300">
            <span>X:</span>
            <input
              type="range"
              min={0}
              max={95}
              step={0.5}
              value={Number((roi.leftRatio * 100).toFixed(1))}
              onChange={(e) => {
                const left = Number(e.target.value) / 100;
                onChangeRoi({
                  ...roi,
                  leftRatio: Math.max(0, Math.min(1 - roi.widthRatio, left)),
                });
              }}
              className="w-20 accent-emerald-500"
            />
            <span className="font-mono w-9">
              {(roi.leftRatio * 100).toFixed(0)}%
            </span>
          </label>

          <label className="flex items-center gap-1.5 text-slate-300">
            <span>Y:</span>
            <input
              type="range"
              min={0}
              max={95}
              step={0.5}
              value={Number((roi.topRatio * 100).toFixed(1))}
              onChange={(e) => {
                const top = Number(e.target.value) / 100;
                onChangeRoi({
                  ...roi,
                  topRatio: Math.max(0, Math.min(1 - roi.heightRatio, top)),
                });
              }}
              className="w-20 accent-emerald-500"
            />
            <span className="font-mono w-9">
              {(roi.topRatio * 100).toFixed(0)}%
            </span>
          </label>

          <label className="flex items-center gap-1.5 text-slate-300">
            <span>Larg:</span>
            <input
              type="range"
              min={10}
              max={100}
              step={0.5}
              value={Number((roi.widthRatio * 100).toFixed(1))}
              onChange={(e) => {
                const w = Number(e.target.value) / 100;
                onChangeRoi({
                  ...roi,
                  widthRatio: Math.min(1 - roi.leftRatio, w),
                });
              }}
              className="w-20 accent-emerald-500"
            />
            <span className="font-mono w-9">
              {(roi.widthRatio * 100).toFixed(0)}%
            </span>
          </label>

          <label className="flex items-center gap-1.5 text-slate-300">
            <span>Alt:</span>
            <input
              type="range"
              min={5}
              max={95}
              step={0.5}
              value={Number((roi.heightRatio * 100).toFixed(1))}
              onChange={(e) => {
                const h = Number(e.target.value) / 100;
                onChangeRoi({
                  ...roi,
                  heightRatio: Math.min(1 - roi.topRatio, h),
                });
              }}
              className="w-20 accent-emerald-500"
            />
            <span className="font-mono w-9">
              {(roi.heightRatio * 100).toFixed(0)}%
            </span>
          </label>

          <label className="flex items-center gap-1 text-slate-300">
            <span>Células:</span>
            <input
              type="number"
              min={4}
              max={20}
              value={activePreset.expectedCells}
              onChange={(e) =>
                onUpdatePreset({
                  ...activePreset,
                  expectedCells: Math.max(4, Math.min(20, Number(e.target.value) || 12)),
                })
              }
              className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-100"
            />
          </label>

          <button
            type="button"
            onClick={resetRoiToDefault}
            className="px-2 py-0.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer whitespace-nowrap"
          >
            Centralizar ROI
          </button>

          {/* Compact HSV Eyedropper right inside Browser bar */}
          <div className="flex items-center gap-1 ml-auto">
            <Pipette className="w-3.5 h-3.5 text-slate-400" />
            {(['GREEN', 'RED', 'BLACK'] as RouletteColor[]).map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => setEyedropperTarget(eyedropperTarget === col ? null : col)}
                className={`px-1.5 py-0.5 rounded border text-[10px] cursor-pointer ${
                  eyedropperTarget === col
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                {col === 'GREEN' ? 'V0' : col === 'RED' ? 'Verm' : 'Preto'}
              </button>
            ))}
            {lastHsvSample && (
              <span className="font-mono text-[10px] text-emerald-400 hidden xl:inline">
                {lastHsvSample}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
