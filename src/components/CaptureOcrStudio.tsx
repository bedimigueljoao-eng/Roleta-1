import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Crosshair,
  Eye,
  Pipette,
  Play,
  RefreshCw,
  Square,
  Upload,
} from 'lucide-react';
import { EUROPEAN_WHEEL_SEQUENCE, getNumberColor } from '../engine/rouletteConstants';
import { calibrateProfileFromPixel, rgbToHsv } from '../ocr/hsvColorClassifier';
import {
  CasinoLayoutPreset,
  OCRFrameResult,
  ReconciliationEvent,
  ROIRect,
  RouletteColor,
} from '../types/roulette';

interface CaptureOcrStudioProps {
  activePreset: CasinoLayoutPreset;
  isCapturing: boolean;
  captureMode: 'screen' | 'synthetic' | 'image';
  lastFrameResult: OCRFrameResult | null;
  reconcileLogs: ReconciliationEvent[];
  onStartScreenCapture: () => Promise<void>;
  onStopCapture: () => void;
  onSelectCaptureMode: (mode: 'screen' | 'synthetic' | 'image') => void;
  onUpdatePreset: (updated: CasinoLayoutPreset) => void;
  onProcessSourceFrame: (
    source: HTMLVideoElement | HTMLCanvasElement,
    forceRun?: boolean
  ) => Promise<void>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  syntheticCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

export const CaptureOcrStudio: React.FC<CaptureOcrStudioProps> = ({
  activePreset,
  isCapturing,
  captureMode,
  lastFrameResult,
  reconcileLogs,
  onStartScreenCapture,
  onStopCapture,
  onSelectCaptureMode,
  onUpdatePreset,
  onProcessSourceFrame,
  videoRef,
  syntheticCanvasRef,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showDebug, setShowDebug] = useState(true);
  const [eyedropperTarget, setEyedropperTarget] = useState<RouletteColor | null>(null);
  const [lastPickedHsv, setLastPickedHsv] = useState<string | null>(null);

  // Synthetic strip state for zero-friction testing of real CLAHE + Tesseract + HSV + Reconciler
  const [synthNumbers, setSynthNumbers] = useState<number[]>([
    17, 32, 0, 23, 8, 14, 36, 5, 29, 11, 21, 4,
  ]);
  const [loadedImageEl, setLoadedImageEl] = useState<HTMLImageElement | null>(null);

  // Interactive ROI Drag State
  const dragStateRef = useRef<{
    handle: DragHandle;
    startX: number;
    startY: number;
    startRoi: ROIRect;
  } | null>(null);

  // Render synthetic casino strip onto syntheticCanvasRef whenever synthNumbers or preset changes
  const renderSyntheticCanvas = useCallback(() => {
    const canvas = syntheticCanvasRef.current;
    if (!canvas) return;
    canvas.width = 960;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Dark casino table background
    ctx.fillStyle = '#0D131F';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle table felt arc header
    ctx.fillStyle = '#142235';
    ctx.fillRect(0, 0, canvas.width, 42);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(
      `Mesa Simulada · ${activePreset.name} ${
        activePreset.multiplierMode ? '(Modo Multiplicador 50x–500x)' : ''
      }`,
      20,
      26
    );

    // Draw horizontal history strip inside the preset's ROI zone
    const roiX = Math.round(activePreset.roi.leftRatio * canvas.width);
    const roiY = Math.round(activePreset.roi.topRatio * canvas.height);
    const roiW = Math.round(activePreset.roi.widthRatio * canvas.width);
    const roiH = Math.round(activePreset.roi.heightRatio * canvas.height);

    // Strip backdrop
    ctx.fillStyle = '#070B12';
    ctx.fillRect(roiX, roiY, roiW, roiH);

    const cellsToDraw = activePreset.expectedCells;
    const cellW = roiW / cellsToDraw;
    const ordered = activePreset.newestOnLeft
      ? synthNumbers.slice(0, cellsToDraw)
      : [...synthNumbers.slice(0, cellsToDraw)].reverse();

    for (let i = 0; i < ordered.length; i++) {
      const num = ordered[i];
      const color = getNumberColor(num);
      const cx = roiX + i * cellW;
      const pad = 4;
      const pillX = cx + pad;
      const pillY = roiY + pad;
      const pillW = cellW - pad * 2;
      const pillH = activePreset.multiplierMode ? roiH * 0.65 - pad : roiH - pad * 2;

      ctx.fillStyle =
        color === 'GREEN' ? '#15803D' : color === 'RED' ? '#B91C1C' : '#18181B';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 6);
      ctx.fill();

      // Highlight newest pill border
      const isNewest = activePreset.newestOnLeft ? i === 0 : i === ordered.length - 1;
      if (isNewest) {
        ctx.strokeStyle = '#FBBF24';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Crisp white number
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 ${Math.max(16, Math.round(pillH * 0.54))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), pillX + pillW / 2, pillY + pillH / 2 + 1);

      // Optional Lightning sub-badge (to verify 70% top-crop ignores 50x-500x)
      if (activePreset.multiplierMode && i % 3 === 0) {
        const multText = ['50x', '100x', '250x', '500x'][i % 4];
        ctx.fillStyle = '#CA8A04';
        ctx.fillRect(pillX + 4, pillY + pillH + 2, pillW - 8, roiH * 0.25);
        ctx.fillStyle = '#FEF08A';
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.fillText(multText, pillX + pillW / 2, pillY + pillH + roiH * 0.14);
      }
    }

    // Instructional footer in canvas
    ctx.fillStyle = '#64748B';
    ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      'Arraste os 4 cantos da caixa verde ROI ou use o Conta-Gotas HSV para calibrar as cores.',
      20,
      canvas.height - 22
    );
  }, [activePreset, synthNumbers, syntheticCanvasRef]);

  useEffect(() => {
    if (captureMode === 'synthetic') {
      renderSyntheticCanvas();
    }
  }, [captureMode, renderSyntheticCanvas]);

  // Draw uploaded image onto syntheticCanvasRef when in image mode
  useEffect(() => {
    if (captureMode === 'image' && loadedImageEl && syntheticCanvasRef.current) {
      const canvas = syntheticCanvasRef.current;
      canvas.width = loadedImageEl.naturalWidth || 960;
      canvas.height = loadedImageEl.naturalHeight || 540;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(loadedImageEl, 0, 0);
    }
  }, [captureMode, loadedImageEl, syntheticCanvasRef]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setLoadedImageEl(img);
      onSelectCaptureMode('image');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleSimulateNewSpinOnStrip = () => {
    const nextNum =
      EUROPEAN_WHEEL_SEQUENCE[Math.floor(Math.random() * EUROPEAN_WHEEL_SEQUENCE.length)];
    setSynthNumbers((prev) => [nextNum, ...prev.slice(0, 15)]);
  };

  const handleSimulateTableSwitch = () => {
    const fresh: number[] = [];
    for (let i = 0; i < 12; i++) {
      fresh.push(
        EUROPEAN_WHEEL_SEQUENCE[Math.floor(Math.random() * EUROPEAN_WHEEL_SEQUENCE.length)]
      );
    }
    setSynthNumbers(fresh);
  };

  // Interactive ROI Drag & Resize Handlers
  const startRoiDrag = (e: React.PointerEvent, handle: DragHandle) => {
    if (eyedropperTarget !== null) return;
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
    const container = containerRef.current;
    if (!drag || !container) return;

    const rect = container.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const s = drag.startRoi;
    let next: ROIRect = { ...s };

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

  // Interactive HSV Eyedropper ("Conta-Gotas HSV")
  const handleEyedropperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!eyedropperTarget || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;

    let r = 0;
    let g = 0;
    let b = 0;

    if (captureMode === 'screen' && videoRef.current && videoRef.current.videoWidth > 0) {
      const v = videoRef.current;
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
    } else if (syntheticCanvasRef.current) {
      const c = syntheticCanvasRef.current;
      const cctx = c.getContext('2d');
      if (!cctx) return;
      const px = Math.min(c.width - 1, Math.max(0, Math.round(rx * c.width)));
      const py = Math.min(c.height - 1, Math.max(0, Math.round(ry * c.height)));
      const d = cctx.getImageData(px, py, 1, 1).data;
      r = d[0];
      g = d[1];
      b = d[2];
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
    setLastPickedHsv(
      `${eyedropperTarget}: RGB(${r},${g},${b}) → H=${hsv.h.toFixed(0)}° S=${(
        hsv.s * 100
      ).toFixed(0)}% V=${(hsv.v * 100).toFixed(0)}%`
    );
    setEyedropperTarget(null);
  };

  const triggerManualScan = () => {
    if (captureMode === 'screen' && videoRef.current) {
      void onProcessSourceFrame(videoRef.current, true);
    } else if (syntheticCanvasRef.current) {
      void onProcessSourceFrame(syntheticCanvasRef.current, true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Capture Source & Calibration Controls */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Camada 1 & 2 — Captura de Ecrã, Editor de ROI & Calibrador HSV
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Screen Capture API (15 fps) · Assinatura &lt;1ms (dHash 64-bit + borda esquerda 35%) · CLAHE 4×2 + Tesseract.js
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isCapturing ? (
              <button
                type="button"
                onClick={() => void onStartScreenCapture()}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                Capturar Ecrã (getDisplayMedia)
              </button>
            ) : (
              <button
                type="button"
                onClick={onStopCapture}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                Parar Captura
              </button>
            )}

            <button
              type="button"
              onClick={() => onSelectCaptureMode('synthetic')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                captureMode === 'synthetic'
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              Faixa Simulada
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                captureMode === 'image'
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Carregar Print
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Eyedropper & Synthetic Test Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 mr-1">
              <Pipette className="w-3.5 h-3.5" />
              Conta-Gotas HSV:
            </span>
            {(['GREEN', 'RED', 'BLACK'] as RouletteColor[]).map((c) => {
              const active = eyedropperTarget === c;
              const label =
                c === 'GREEN' ? 'Verde (0)' : c === 'RED' ? 'Vermelho' : 'Preto';
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEyedropperTarget(active ? null : c)}
                  className={`px-2.5 py-1.5 rounded border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {active ? `Clique na pílula ${label}...` : label}
                </button>
              );
            })}
            {lastPickedHsv && (
              <span className="text-[11px] font-mono text-emerald-400">
                {lastPickedHsv}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {captureMode === 'synthetic' && (
              <>
                <button
                  type="button"
                  onClick={handleSimulateNewSpinOnStrip}
                  className="px-2.5 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 whitespace-nowrap cursor-pointer"
                >
                  + Giro na Faixa
                </button>
                <button
                  type="button"
                  onClick={handleSimulateTableSwitch}
                  className="px-2.5 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs text-slate-200 whitespace-nowrap cursor-pointer"
                >
                  Simular Troca de Mesa
                </button>
              </>
            )}

            <button
              type="button"
              onClick={triggerManualScan}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-100 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Ler OCR Agora
            </button>

            <button
              type="button"
              onClick={() => setShowDebug((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap cursor-pointer ${
                showDebug
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
                  : 'border-slate-700 bg-slate-900 text-slate-400'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Debug OCR
            </button>
          </div>
        </div>

        {/* Interactive Video / Canvas Viewport with Draggable 4-Corner ROI Overlay */}
        <div
          ref={containerRef}
          onPointerMove={handlePointerMove}
          onPointerUp={endRoiDrag}
          onClick={handleEyedropperClick}
          className={`relative w-full aspect-[16/6] min-h-[240px] bg-[#070B12] border border-slate-800 rounded-lg overflow-hidden select-none ${
            eyedropperTarget ? 'cursor-crosshair' : ''
          }`}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-fill ${
              captureMode === 'screen' ? 'block' : 'hidden'
            }`}
          />
          <canvas
            ref={syntheticCanvasRef}
            className={`w-full h-full object-fill ${
              captureMode !== 'screen' ? 'block' : 'hidden'
            }`}
          />

          {/* Green Dashed ROI Overlay with 4 draggable corners */}
          <div
            onPointerDown={(e) => startRoiDrag(e, 'move')}
            style={{
              left: `${activePreset.roi.leftRatio * 100}%`,
              top: `${activePreset.roi.topRatio * 100}%`,
              width: `${activePreset.roi.widthRatio * 100}%`,
              height: `${activePreset.roi.heightRatio * 100}%`,
            }}
            className={`absolute border-2 border-dashed border-emerald-400 bg-emerald-500/5 ${
              eyedropperTarget ? 'pointer-events-none' : 'cursor-move'
            }`}
          >
            <div className="absolute -top-5 left-0 px-1.5 py-0.5 bg-emerald-600 text-[10px] font-mono text-white rounded-t flex items-center gap-1 whitespace-nowrap">
              <Crosshair className="w-2.5 h-2.5" />
              ROI ({activePreset.expectedCells} cél.)
            </div>

            {/* 4 Corner Resize Handles */}
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
          </div>
        </div>

        {/* Fine-tune ROI numeric parameters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Left / Width</span>
            <span className="font-mono text-slate-200">
              {(activePreset.roi.leftRatio * 100).toFixed(1)}% /{' '}
              {(activePreset.roi.widthRatio * 100).toFixed(1)}%
            </span>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Top / Height</span>
            <span className="font-mono text-slate-200">
              {(activePreset.roi.topRatio * 100).toFixed(1)}% /{' '}
              {(activePreset.roi.heightRatio * 100).toFixed(1)}%
            </span>
          </div>
          <label className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 flex flex-col">
            <span className="text-slate-400">Células Esperadas</span>
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
              className="mt-0.5 bg-transparent font-mono text-slate-100 focus:outline-none"
            />
          </label>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">HSV Calibrado</span>
            <span className="font-mono text-slate-200">
              {activePreset.hsvProfile.calibratedSamples} amostras
            </span>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-slate-400 block">Modo Multiplicador</span>
            <span className="font-mono text-slate-200">
              {activePreset.multiplierMode ? 'Ativo (Top 70%)' : 'Padrão (100%)'}
            </span>
          </div>
        </div>
      </div>

      {/* Live Debug & Temporal Reconciliation Inspector */}
      {showDebug && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Layer 2 Debug */}
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                Inspeção do Pipeline OCR (CLAHE + Tesseract + HSV)
              </h3>
              {lastFrameResult && (
                <span className="text-xs font-mono text-slate-400">
                  {lastFrameResult.processingMs.toFixed(1)} ms
                </span>
              )}
            </div>

            {lastFrameResult ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  <div className="bg-slate-900/70 border border-slate-800 rounded px-2.5 py-1.5">
                    <span className="text-slate-400 block text-[11px]">dHash Global</span>
                    <span className="text-slate-100">{lastFrameResult.globalHamming} bits</span>
                  </div>
                  <div className="bg-slate-900/70 border border-slate-800 rounded px-2.5 py-1.5">
                    <span className="text-slate-400 block text-[11px]">Borda Esq. 35%</span>
                    <span className="text-slate-100">{lastFrameResult.leftEdgeHamming} bits</span>
                  </div>
                  <div className="bg-slate-900/70 border border-slate-800 rounded px-2.5 py-1.5">
                    <span className="text-slate-400 block text-[11px]">Δ Luminância</span>
                    <span className="text-slate-100">{lastFrameResult.lumaDiff.toFixed(1)}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-300">
                  Decisão da assinatura:{' '}
                  <span className="font-mono text-emerald-400">
                    {lastFrameResult.signatureReason}
                  </span>
                </p>

                {lastFrameResult.clahePreviewDataUrl && (
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">
                      Recorte ROI · Escala de Cinzentos + CLAHE (4×2, clip 2.6)
                    </span>
                    <img
                      src={lastFrameResult.clahePreviewDataUrl}
                      alt="Preview CLAHE da ROI"
                      className="w-full max-h-16 object-contain rounded border border-slate-800 bg-black"
                    />
                  </div>
                )}

                {lastFrameResult.allBoxes.length > 0 && (
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1.5">
                      Células Segmentadas (2.5× + Borda 8px + Inversão #000/#FFF) & Validação Cruzada
                    </span>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {lastFrameResult.allBoxes.map((b) => (
                        <div
                          key={b.index}
                          className={`p-1.5 rounded border text-center ${
                            b.number !== null
                              ? 'border-slate-700 bg-slate-900/80'
                              : 'border-red-900/70 bg-red-950/30'
                          }`}
                        >
                          {b.invertedPreviewDataUrl && (
                            <img
                              src={b.invertedPreviewDataUrl}
                              alt={`Célula ${b.index}`}
                              className="w-full h-8 object-contain rounded bg-white mb-1"
                            />
                          )}
                          <div className="font-mono text-xs font-bold text-slate-100">
                            {b.number !== null ? b.number : '×'}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 truncate">
                            {b.color ?? 'null'} · {(b.confidence * 100).toFixed(0)}%
                          </div>
                          {b.rejectedReason && (
                            <div
                              className="text-[9px] text-red-400 truncate"
                              title={b.rejectedReason}
                            >
                              {b.rejectedReason}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Clique em &ldquo;Ler OCR Agora&rdquo; ou inicie a captura para inspecionar o pré-processamento CLAHE e os votos HSV.
              </p>
            )}
          </div>

          {/* Layer 3 Temporal Reconciler Log */}
          <div className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Camada 3 — Reconciliação Temporal (Zero Duplicados)
            </h3>
            {reconcileLogs.length === 0 ? (
              <p className="text-xs text-slate-400">
                Aguardando leituras de faixa para alinhamento temporal (Shift -3..+4 e detetor de troca de mesa).
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {reconcileLogs.map((log, i) => (
                  <div
                    key={i}
                    className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/60 text-xs flex items-start justify-between gap-3"
                  >
                    <div>
                      <span className="font-mono font-semibold text-emerald-400">
                        {log.type}
                      </span>
                      <p className="text-slate-300 mt-0.5">{log.message}</p>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      shift {log.shift >= 0 ? `+${log.shift}` : log.shift}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
