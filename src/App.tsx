import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Database,
  Globe,
  Plus,
  RotateCcw,
  ShieldAlert,
  Square,
} from 'lucide-react';
import { CaptureOcrStudio } from './components/CaptureOcrStudio';
import { EuropeanBettingMat } from './components/EuropeanBettingMat';
import { EuropeanWheelSvg } from './components/EuropeanWheelSvg';
import { HistoryBacktestView } from './components/HistoryBacktestView';
import { MonteCarloView } from './components/MonteCarloView';
import { SplitScreenBrowser } from './components/SplitScreenBrowser';
import { detectMarketRegime } from './engine/marketRegimeDetector';
import { computeMasterBet } from './engine/masterBetEngine';
import {
  EUROPEAN_HOUSE_EDGE_PCT,
  EUROPEAN_WHEEL_SEQUENCE,
  formatCurrency,
  getNumberColor,
} from './engine/rouletteConstants';
import { analyzeRoulette } from './engine/rouletteEngine';
import {
  buildWalkForwardSummary,
  evaluateTargetsAgainstNumber,
} from './engine/walkForwardEngine';
import { RouletteOcrPipeline, terminateOcrWorker } from './ocr/rouletteOcrPipeline';
import { TemporalReconciler } from './ocr/temporalReconciler';
import {
  loadActivePresetId,
  loadBankrollConfig,
  loadLayoutPresets,
  loadSessionArchive,
  saveActivePresetId,
  saveBankrollConfig,
  saveLayoutPresets,
  saveSessionArchive,
} from './storage/sessionStorage';
import {
  BankrollConfig,
  CasinoLayoutPreset,
  CasinoProviderId,
  ChipStrategyProfile,
  CurrencyCode,
  OCRFrameResult,
  ReconciliationEvent,
  SessionRecord,
  SpinEntry,
} from './types/roulette';

type ActiveTab = 'live' | 'capture' | 'history' | 'montecarlo';

const SAMPLE_CONTEXT_NUMBERS = [
  17, 32, 0, 23, 8, 14, 36, 5, 29, 11, 21, 4, 19, 32, 15, 26,
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('live');

  // Persisted Presets & Bankroll
  const [presets, setPresets] = useState<CasinoLayoutPreset[]>(() => loadLayoutPresets());
  const [activePresetId, setActivePresetId] = useState<CasinoProviderId>(() =>
    loadActivePresetId()
  );
  const [bankroll, setBankroll] = useState<BankrollConfig>(() => loadBankrollConfig());
  const [archivedSessions, setArchivedSessions] = useState<SessionRecord[]>(() =>
    loadSessionArchive()
  );

  // Spin State: sessionSpins (live tracked) vs learnedBackupSpins (table context)
  const [sessionSpins, setSessionSpins] = useState<SpinEntry[]>([]);
  const [learnedBackupSpins, setLearnedBackupSpins] = useState<SpinEntry[]>([]);
  const [sessionStartedAt, setSessionStartedAt] = useState<number>(() => Date.now());
  const [equityCurve, setEquityCurve] = useState<
    Array<{ spinIndex: number; balance: number; number: number }>
  >(() => [{ spinIndex: 0, balance: loadBankrollConfig().currentBankroll, number: -1 }]);

  // Quick Manual Input
  const [manualInput, setManualInput] = useState('');

  // Capture & OCR State
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureMode, setCaptureMode] = useState<'screen' | 'synthetic' | 'image'>('synthetic');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [lastFrameResult, setLastFrameResult] = useState<OCRFrameResult | null>(null);
  const [reconcileLogs, setReconcileLogs] = useState<ReconciliationEvent[]>([]);

  // Embedded Split-Screen Browser State
  const [isBrowserOpen, setIsBrowserOpen] = useState(true);
  const [isEmbeddedBuiltInTable, setIsEmbeddedBuiltInTable] = useState(true);
  const [isEmbeddedOcrOn, setIsEmbeddedOcrOn] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const syntheticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const embeddedCasinoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const ocrPipelineRef = useRef<RouletteOcrPipeline>(new RouletteOcrPipeline());
  const reconcilerRef = useRef<TemporalReconciler>(new TemporalReconciler());
  const isProcessingOcrRef = useRef(false);
  const lastRealBetTimestampRef = useRef<number>(0);

  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? presets[0],
    [presets, activePresetId]
  );

  // Persist changes
  useEffect(() => {
    saveLayoutPresets(presets);
  }, [presets]);

  useEffect(() => {
    saveActivePresetId(activePresetId);
  }, [activePresetId]);

  useEffect(() => {
    saveBankrollConfig(bankroll);
  }, [bankroll]);

  useEffect(() => {
    saveSessionArchive(archivedSessions);
  }, [archivedSessions]);

  useEffect(() => {
    return () => {
      void terminateOcrWorker();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Layer 4: Quantitative Calculations
  const combinedSpins = useMemo(
    () => [...sessionSpins, ...learnedBackupSpins],
    [sessionSpins, learnedBackupSpins]
  );

  const analysis = useMemo(
    () => analyzeRoulette(sessionSpins, learnedBackupSpins, bankroll),
    [sessionSpins, learnedBackupSpins, bankroll]
  );

  const regime = useMemo(
    () => detectMarketRegime(combinedSpins, bankroll.unpredictabilityThresholdPct),
    [combinedSpins, bankroll.unpredictabilityThresholdPct]
  );

  const avgOcrConfidence = useMemo(() => {
    const ocrSpins = sessionSpins.filter((s) => s.source === 'ocr');
    if (ocrSpins.length === 0) return 0.92;
    return ocrSpins.reduce((acc, s) => acc + s.confidence, 0) / ocrSpins.length;
  }, [sessionSpins]);

  const masterBet = useMemo(
    () => computeMasterBet(analysis, regime, bankroll, avgOcrConfidence),
    [analysis, regime, bankroll, avgOcrConfidence]
  );

  const walkForward = useMemo(
    () => buildWalkForwardSummary(sessionSpins, learnedBackupSpins),
    [sessionSpins, learnedBackupSpins]
  );

  // Archive current session helper
  const archiveCurrentSession = useCallback(
    (tableLabel?: string) => {
      if (sessionSpins.length === 0 && learnedBackupSpins.length === 0) return;
      const record: SessionRecord = {
        id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        tableName: tableLabel ?? activePreset.name,
        providerId: activePreset.id,
        startedAt: sessionStartedAt,
        endedAt: Date.now(),
        sessionSpins,
        contextSpins: learnedBackupSpins,
        initialBankroll: bankroll.initialBankroll,
        finalBankroll: bankroll.currentBankroll,
        currency: bankroll.currency,
        avgOcrConfidence,
        walkForward,
        equityCurve,
      };
      setArchivedSessions((prev) => [record, ...prev]);
    },
    [
      activePreset,
      avgOcrConfidence,
      bankroll,
      equityCurve,
      learnedBackupSpins,
      sessionSpins,
      sessionStartedAt,
      walkForward,
    ]
  );

  // Keep latest analysis & masterBet in refs for async OCR callback
  const latestAnalysisRef = useRef(analysis);
  const latestMasterBetRef = useRef(masterBet);
  const latestBankrollRef = useRef(bankroll);
  useEffect(() => {
    latestAnalysisRef.current = analysis;
    latestMasterBetRef.current = masterBet;
    latestBankrollRef.current = bankroll;
  }, [analysis, masterBet, bankroll]);

  // Register a real-time spin (from OCR NEW_SPINS or manual click)
  const recordLiveSpin = useCallback(
    (
      num: number,
      source: 'ocr' | 'manual',
      confidence = 1,
      multiplierDetected = false
    ) => {
      if (num < 0 || num > 36) return;

      const prevAnalysis = latestAnalysisRef.current;
      const prevMaster = latestMasterBetRef.current;
      const prevBankroll = latestBankrollRef.current;

      const evaluation = evaluateTargetsAgainstNumber(
        prevAnalysis.suggestedTargets,
        num,
        prevMaster.primaryMarket
      );

      // Update simulated bankroll tracking only when no direct real bet was placed in the embedded browser
      let nextBalance = prevBankroll.currentBankroll;
      const hadRecentRealBet = Date.now() - lastRealBetTimestampRef.current < 3500;
      if (!hadRecentRealBet && prevMaster.action === 'APOSTAR' && prevMaster.recommendedStake > 0) {
        const hit = evaluation.results[prevMaster.primaryMarket];
        if (hit !== null) {
          if (hit) {
            const payoutRatio =
              prevMaster.primaryMarket === 'DUZIA' || prevMaster.primaryMarket === 'COLUNA'
                ? 2
                : prevMaster.primaryMarket === 'VIZINHOS'
                ? 36 / Math.max(1, prevMaster.targetNumbers.length) - 1
                : 1;
            nextBalance = Math.round(
              nextBalance + prevMaster.recommendedStake * payoutRatio
            );
          } else {
            nextBalance = Math.max(0, Math.round(nextBalance - prevMaster.recommendedStake));
          }
          setBankroll((b) => ({ ...b, currentBankroll: nextBalance }));
        }
      }

      const newEntry: SpinEntry = {
        id: `spin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        number: num,
        color: getNumberColor(num),
        timestamp: Date.now(),
        source,
        confidence,
        multiplierDetected,
        evaluation,
      };

      setSessionSpins((prev) => [newEntry, ...prev]);
      setEquityCurve((prev) => [
        ...prev,
        { spinIndex: prev.length, balance: nextBalance, number: num },
      ]);
    },
    []
  );

  // Process a single video/canvas frame through Layer 2 (OCR) -> Layer 3 (Temporal Reconciler)
  const handleProcessSourceFrame = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement,
      forceRun = false,
      presetOverride?: CasinoLayoutPreset
    ) => {
      if (isProcessingOcrRef.current) return;
      isProcessingOcrRef.current = true;

      try {
        const effectivePreset = presetOverride ?? activePreset;
        const frameRes = await ocrPipelineRef.current.processFrame(
          source,
          effectivePreset,
          forceRun
        );
        setLastFrameResult(frameRes);

        if (!frameRes.skippedBySignature && frameRes.detections.length > 0) {
          const event = reconcilerRef.current.reconcile(frameRes.detections);

          if (event.type !== 'NO_CHANGE') {
            setReconcileLogs((prev) => [event, ...prev].slice(0, 30));
          }

          if (event.type === 'FULL_STRIP') {
            const contextEntries: SpinEntry[] = event.spins.map((d, idx) => ({
              id: `ctx_${Date.now()}_${idx}`,
              number: d.number,
              color: d.color ?? getNumberColor(d.number),
              timestamp: Date.now(),
              source: 'context',
              confidence: d.confidence,
            }));
            setLearnedBackupSpins(contextEntries);
          } else if (event.type === 'NEW_SPINS') {
            // Emit oldest of the newly arrived spins first so index 0 ends up newest
            const orderedToEmit = [...event.spins].reverse();
            for (const sp of orderedToEmit) {
              recordLiveSpin(sp.number, 'ocr', sp.confidence, activePreset.multiplierMode);
            }
          } else if (event.type === 'TABLE_SWITCH') {
            archiveCurrentSession(activePreset.name);
            const newContext: SpinEntry[] = event.spins.map((d, idx) => ({
              id: `ctx_sw_${Date.now()}_${idx}`,
              number: d.number,
              color: d.color ?? getNumberColor(d.number),
              timestamp: Date.now(),
              source: 'context',
              confidence: d.confidence,
            }));
            setSessionSpins([]);
            setLearnedBackupSpins(newContext);
            setSessionStartedAt(Date.now());
            setBankroll((b) => ({ ...b, currentBankroll: b.initialBankroll }));
            setEquityCurve([
              { spinIndex: 0, balance: bankroll.initialBankroll, number: -1 },
            ]);
          }
        }
      } finally {
        isProcessingOcrRef.current = false;
      }
    },
    [activePreset, archiveCurrentSession, bankroll.initialBankroll, recordLiveSpin]
  );

  // Screen Capture API (getDisplayMedia)
  const handleStartScreenCapture = async () => {
    setCaptureError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setCaptureError(
        'Screen Capture API indisponível neste navegador/contexto. Use a Faixa Simulada ou Carregar Print.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });

      mediaStreamRef.current = stream;
      setCaptureMode('screen');
      setIsCapturing(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setIsCapturing(false);
        mediaStreamRef.current = null;
      });
    } catch (err) {
      setCaptureError(
        err instanceof Error
          ? `Captura cancelada ou bloqueada: ${err.message}`
          : 'Não foi possível iniciar a captura de ecrã.'
      );
    }
  };

  const handleStopCapture = () => {
    setIsCapturing(false);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Non-blocking 375ms OCR loop for Screen Capture OR Embedded Split-Screen Browser
  useEffect(() => {
    const shouldPollEmbedded =
      activeTab === 'live' && isBrowserOpen && isEmbeddedOcrOn && isEmbeddedBuiltInTable;
    if (!isCapturing && !shouldPollEmbedded) return;

    const timer = window.setInterval(() => {
      if (isCapturing) {
        const src =
          captureMode === 'screen' ? videoRef.current : syntheticCanvasRef.current;
        if (src) {
          void handleProcessSourceFrame(src, false);
        }
      } else if (shouldPollEmbedded && embeddedCasinoCanvasRef.current) {
        const builtInPreset: CasinoLayoutPreset = {
          ...activePreset,
          roi: {
            leftRatio: 0.0145,
            topRatio: 0.232,
            widthRatio: 0.9708,
            heightRatio: 0.6786,
          },
        };
        void handleProcessSourceFrame(
          embeddedCasinoCanvasRef.current,
          false,
          builtInPreset
        );
      }
    }, 375);

    return () => window.clearInterval(timer);
  }, [
    activePreset,
    activeTab,
    captureMode,
    handleProcessSourceFrame,
    isBrowserOpen,
    isCapturing,
    isEmbeddedBuiltInTable,
    isEmbeddedOcrOn,
  ]);

  const handleToggleEmbeddedOcr = () => {
    if (!isEmbeddedBuiltInTable && !isCapturing) {
      // External URL in iframe: start getDisplayMedia capture so real pixels can be read
      void handleStartScreenCapture();
      return;
    }
    setIsEmbeddedOcrOn((v) => !v);
  };

  const handleEmbeddedBetSettled = useCallback(
    (stake: number, payout: number) => {
      lastRealBetTimestampRef.current = Date.now();
      const net = payout - stake;
      setBankroll((b) => ({
        ...b,
        currentBankroll: Math.max(0, Math.round(b.currentBankroll + net)),
      }));
    },
    []
  );

  const handleUpdatePreset = (updated: CasinoLayoutPreset) => {
    setPresets((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleLoadSampleContext = () => {
    const entries: SpinEntry[] = SAMPLE_CONTEXT_NUMBERS.map((num, idx) => ({
      id: `sample_ctx_${Date.now()}_${idx}`,
      number: num,
      color: getNumberColor(num),
      timestamp: Date.now() - idx * 45000,
      source: 'context',
      confidence: 0.96,
    }));
    setLearnedBackupSpins(entries);
  };

  const handleResetTable = () => {
    if (sessionSpins.length > 0) {
      archiveCurrentSession();
    }
    reconcilerRef.current.reset();
    ocrPipelineRef.current.resetSignature();
    setSessionSpins([]);
    setLearnedBackupSpins([]);
    setSessionStartedAt(Date.now());
    setBankroll((b) => ({ ...b, currentBankroll: b.initialBankroll }));
    setEquityCurve([{ spinIndex: 0, balance: bankroll.initialBankroll, number: -1 }]);
    setReconcileLogs([]);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseInt(manualInput.trim(), 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 36) {
      recordLiveSpin(parsed, 'manual', 1);
      setManualInput('');
    }
  };

  const handleRandomSpin = () => {
    const num =
      EUROPEAN_WHEEL_SEQUENCE[Math.floor(Math.random() * EUROPEAN_WHEEL_SEQUENCE.length)];
    recordLiveSpin(num, 'manual', 1);
  };

  const pnlAmount = bankroll.currentBankroll - bankroll.initialBankroll;
  const pnlPct =
    bankroll.initialBankroll > 0 ? (pnlAmount / bankroll.initialBankroll) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-[#0B0F17]/95 backdrop-blur border-b border-slate-800/90 px-4 sm:px-6 py-3.5">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('live');
            }}
            className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            RoletaLab
          </a>

          {/* Zone 2: Clean single-line text nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {[
              { id: 'live' as const, label: 'Painel ao Vivo' },
              { id: 'capture' as const, label: 'Captura & OCR' },
              { id: 'history' as const, label: 'Histórico & Backtest' },
              { id: 'montecarlo' as const, label: 'Simulador Banca' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer pb-0.5 ${
                  activeTab === tab.id
                    ? 'text-emerald-400 border-b-2 border-emerald-400'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 Primary Action Button */}
          <div className="shrink-0">
            {!isCapturing ? (
              <button
                type="button"
                onClick={() => void handleStartScreenCapture()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                Iniciar Captura
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopCapture}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                Parar Captura
              </button>
            )}
          </div>
        </div>

        {/* Mobile navigation row */}
        <div className="flex md:hidden items-center gap-4 mt-2.5 pt-2 border-t border-slate-800/70 overflow-x-auto text-xs font-medium">
          {[
            { id: 'live' as const, label: 'Painel ao Vivo' },
            { id: 'capture' as const, label: 'Captura & OCR' },
            { id: 'history' as const, label: 'Histórico' },
            { id: 'montecarlo' as const, label: 'Simulador' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Workspace Configuration Toolbar (Below Top Bar) */}
      <div className="border-b border-slate-800/70 bg-[#0E1420] px-4 sm:px-6 py-2.5">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-slate-400">
              <span>Layout:</span>
              <select
                value={activePresetId}
                onChange={(e) => setActivePresetId(e.target.value as CasinoProviderId)}
                className="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 text-slate-100 focus:outline-none"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() =>
                handleUpdatePreset({
                  ...activePreset,
                  multiplierMode: !activePreset.multiplierMode,
                })
              }
              className={`px-2.5 py-1 rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                activePreset.multiplierMode
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Multiplicador (Ignorar 50x–500x): {activePreset.multiplierMode ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={() =>
                handleUpdatePreset({
                  ...activePreset,
                  newestOnLeft: !activePreset.newestOnLeft,
                })
              }
              className="px-2.5 py-1 rounded-md border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              Direção: {activePreset.newestOnLeft ? 'Mais recente à Esq.' : 'Mais recente à Dir.'}
            </button>

            <select
              value={bankroll.currency}
              onChange={(e) =>
                setBankroll((b) => ({ ...b, currency: e.target.value as CurrencyCode }))
              }
              aria-label="Moeda"
              className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-slate-200 font-mono focus:outline-none"
            >
              <option value="AOA">AOA (Kz)</option>
              <option value="EUR">EUR (€)</option>
              <option value="USD">USD ($)</option>
              <option value="BRL">BRL (R$)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('live');
                setIsBrowserOpen((v) => !v);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border whitespace-nowrap cursor-pointer ${
                isBrowserOpen && activeTab === 'live'
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              {isBrowserOpen ? 'Ocultar Navegador' : 'Abrir Navegador Embutido'}
            </button>
            {learnedBackupSpins.length === 0 && (
              <button
                type="button"
                onClick={handleLoadSampleContext}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 whitespace-nowrap cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                Carregar Contexto Mesa (16)
              </button>
            )}
            <button
              type="button"
              onClick={handleRandomSpin}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Giro Aleatório
            </button>
            <button
              type="button"
              onClick={handleResetTable}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Nova Mesa
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {captureError && (
          <div className="bg-amber-950/40 border border-amber-700/60 rounded-lg px-4 py-3 text-xs text-amber-200 flex items-center justify-between gap-3">
            <span>{captureError}</span>
            <button
              type="button"
              onClick={() => setCaptureError(null)}
              className="text-amber-300 underline cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {activeTab === 'live' && (
          <div className="space-y-6">
            {/* Top Half of Split-Screen Vertical: Embedded Browser + Live ROI / OCR */}
            <SplitScreenBrowser
              isOpen={isBrowserOpen}
              onClose={() => setIsBrowserOpen(false)}
              activePreset={activePreset}
              currency={bankroll.currency}
              isOcrActive={isEmbeddedBuiltInTable ? isEmbeddedOcrOn : isCapturing}
              onToggleOcr={handleToggleEmbeddedOcr}
              onStartExternalScreenCapture={handleStartScreenCapture}
              onUpdatePreset={handleUpdatePreset}
              lastFrameResult={lastFrameResult}
              embeddedCasinoCanvasRef={embeddedCasinoCanvasRef}
              screenVideoRef={videoRef}
              hasScreenStream={isCapturing && captureMode === 'screen'}
              onUrlModeChange={setIsEmbeddedBuiltInTable}
              onBetSettled={handleEmbeddedBetSettled}
            />

            {/* Bottom Half of Split-Screen Vertical: Live Strip & Quantitative Engine */}
            <section className="bg-[#111827] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span className="font-semibold text-slate-200">
                    Histórico ao Vivo
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Sessão:{' '}
                    <strong className="font-mono text-slate-100">
                      {sessionSpins.length}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Contexto da Mesa:{' '}
                    <strong className="font-mono text-slate-100">
                      {learnedBackupSpins.length}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Amostra Combinada:{' '}
                    <strong className="font-mono text-emerald-400">
                      {combinedSpins.length}
                    </strong>
                  </span>
                </div>

                <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={36}
                    placeholder="0–36"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-100 cursor-pointer whitespace-nowrap"
                  >
                    Registar
                  </button>
                </form>
              </div>

              {combinedSpins.length === 0 ? (
                <div className="py-3 text-xs text-slate-400">
                  Nenhum giro registado ainda. Clique num número na roda/tapete, digite 0–36 acima, carregue uma amostra de contexto ou inicie a Captura OCR.
                </div>
              ) : (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {/* Live Session Spins (with OK / X evaluation marker) */}
                  {sessionSpins.map((sp, idx) => {
                    const hit = sp.evaluation?.primaryHit;
                    return (
                      <div key={sp.id} className="flex flex-col items-center shrink-0">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center font-mono text-sm font-bold text-white border ${
                            sp.color === 'GREEN'
                              ? 'bg-emerald-700 border-emerald-500'
                              : sp.color === 'RED'
                              ? 'bg-red-700 border-red-500'
                              : 'bg-slate-900 border-slate-700'
                          } ${idx === 0 ? 'ring-2 ring-amber-400' : ''}`}
                        >
                          {sp.number}
                        </div>
                        <span
                          className={`mt-1 text-[10px] font-mono ${
                            hit === true
                              ? 'text-emerald-400'
                              : hit === false
                              ? 'text-red-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {hit === true ? 'OK' : hit === false ? 'X' : '—'}
                        </span>
                      </div>
                    );
                  })}

                  {sessionSpins.length > 0 && learnedBackupSpins.length > 0 && (
                    <div
                      className="h-10 w-px bg-slate-700 mx-1 shrink-0"
                      title="Separação entre Sessão ao Vivo e Contexto Inicial da Mesa"
                    />
                  )}

                  {/* Context Spins (learnedBackupSpins) */}
                  {learnedBackupSpins.map((sp) => (
                    <div
                      key={sp.id}
                      className="flex flex-col items-center shrink-0 opacity-75"
                      title="Contexto inicial da mesa (não altera taxa da sessão)"
                    >
                      <div
                        className={`w-8 h-8 rounded-md flex items-center justify-center font-mono text-xs font-semibold text-white border ${
                          sp.color === 'GREEN'
                            ? 'bg-emerald-900/80 border-emerald-700'
                            : sp.color === 'RED'
                            ? 'bg-red-900/80 border-red-700'
                            : 'bg-slate-900 border-slate-800'
                        }`}
                      >
                        {sp.number}
                      </div>
                      <span className="mt-1 text-[9px] text-slate-500 font-mono">
                        ctx
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Main 2-Column Quantitative Layout */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Left Dominant Anchor (7 cols): Interactive Wheel + Synchronized Mat */}
              <div className="xl:col-span-7 space-y-6">
                <section className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h1 className="text-lg font-semibold text-slate-100">
                        Roda Física & Tapete Europeu Sincronizado
                      </h1>
                      <p className="text-xs text-slate-400">
                        Sequência oficial 0–36 · Âncora atual:{' '}
                        <span className="font-mono text-slate-200">
                          {analysis.anchorNumber ?? '—'}
                        </span>{' '}
                        · Setor dominante:{' '}
                        <span className="text-emerald-400">
                          {analysis.dominantSector?.name ?? '—'}
                        </span>
                      </p>
                    </div>

                    {/* Strategy Profile Selector */}
                    <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                      {(['VIZINHOS', 'SETORES', 'EQUILIBRADO'] as ChipStrategyProfile[]).map(
                        (prof) => (
                          <button
                            key={prof}
                            type="button"
                            onClick={() =>
                              setBankroll((b) => ({ ...b, strategyProfile: prof }))
                            }
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                              bankroll.strategyProfile === prof
                                ? 'bg-slate-800 text-emerald-400'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {prof === 'VIZINHOS'
                              ? 'Vizinhos'
                              : prof === 'SETORES'
                              ? 'Setores'
                              : 'Equilibrado'}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-center">
                    <EuropeanWheelSvg
                      lastNumber={analysis.lastNumber}
                      anchorNumber={analysis.anchorNumber}
                      anchorNeighbors={analysis.anchorNeighbors}
                      chipNumbers={analysis.chipSuggestion.numbers}
                      masterTargetNumbers={masterBet.targetNumbers}
                      numberStats={analysis.numberStats}
                      onNumberClick={(num) => recordLiveSpin(num, 'manual', 1)}
                    />

                    <EuropeanBettingMat
                      lastNumber={analysis.lastNumber}
                      masterBet={masterBet}
                      chipSuggestion={analysis.chipSuggestion}
                      dominantSectorName={analysis.dominantSector?.name ?? null}
                      currency={bankroll.currency}
                      onNumberClick={(num) => recordLiveSpin(num, 'manual', 1)}
                    />
                  </div>
                </section>

                {/* Wheel Stats: Hot / Cold / Markov Transitions / External Markets */}
                <section className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {/* Hot Numbers */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 mb-2">
                        Números Quentes (Top 6)
                      </h3>
                      <div className="space-y-1.5">
                        {analysis.hotNumbers.map((st) => (
                          <div
                            key={st.number}
                            className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-slate-900/60 border border-slate-800/80"
                          >
                            <span className="font-mono font-semibold text-slate-100">
                              #{st.number}
                            </span>
                            <span className="font-mono text-slate-400">
                              {st.count}× ({st.relativePct.toFixed(1)}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Cold / Delayed Numbers */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 mb-2">
                        Frios / Maior Atraso (Top 6)
                      </h3>
                      <div className="space-y-1.5">
                        {analysis.coldNumbers.map((st) => (
                          <div
                            key={st.number}
                            className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-slate-900/60 border border-slate-800/80"
                          >
                            <span className="font-mono font-semibold text-slate-100">
                              #{st.number}
                            </span>
                            <span className="font-mono text-amber-400">
                              Atraso {st.currentDelay} (máx {st.maxDelay})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Markov Order 1 Transitions */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-300 mb-2">
                        Transições Markov (após {analysis.lastNumber ?? '—'})
                      </h3>
                      {analysis.topTransitions.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          Sem transições repetidas ainda para o último número.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {analysis.topTransitions.map((tr) => (
                            <div
                              key={tr.number}
                              className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-slate-900/60 border border-slate-800/80"
                            >
                              <span className="font-mono font-semibold text-emerald-400">
                                → {tr.number}
                              </span>
                              <span className="font-mono text-slate-300">
                                {tr.count}× ({tr.pct.toFixed(0)}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* External Markets Table */}
                  <div className="pt-4 border-t border-slate-800/80 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-1.5 text-left font-medium">Mercado Externo</th>
                          <th className="py-1.5 text-right font-medium">Seq. Atual</th>
                          <th className="py-1.5 text-right font-medium">Seq. Máx</th>
                          <th className="py-1.5 text-right font-medium">Atraso Atual</th>
                          <th className="py-1.5 text-right font-medium">Últimos 20</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {[
                          analysis.colors.red,
                          analysis.colors.black,
                          analysis.parity.even,
                          analysis.parity.odd,
                          analysis.halves.low,
                          analysis.halves.high,
                          ...analysis.dozens,
                          ...analysis.columns,
                        ].map((m) => (
                          <tr key={m.label}>
                            <td className="py-1.5 text-slate-200">{m.label}</td>
                            <td className="py-1.5 text-right font-mono text-slate-300">
                              {m.currentStreak}
                            </td>
                            <td className="py-1.5 text-right font-mono text-slate-400">
                              {m.maxStreak}
                            </td>
                            <td
                              className={`py-1.5 text-right font-mono ${
                                m.currentDelay >= 5 ? 'text-amber-400 font-semibold' : 'text-slate-300'
                              }`}
                            >
                              {m.currentDelay}
                            </td>
                            <td className="py-1.5 text-right font-mono text-slate-400">
                              {m.hitsLast20}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              {/* Right Column (5 cols): Master Bet, Entropy Guard, 0s Walk-Forward, Bankroll */}
              <div className="xl:col-span-5 space-y-6">
                {/* Master Bet & Regime Detector Card */}
                <section className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs text-slate-400">Aposta Mestra</span>
                      <div className="flex items-center gap-2.5 mt-1">
                        {masterBet.action === 'APOSTAR' ? (
                          <span className="inline-flex items-center gap-1.5 text-xl font-display font-bold text-emerald-400">
                            <CheckCircle2 className="w-5 h-5" />
                            APOSTAR
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xl font-display font-bold text-amber-400">
                            <ShieldAlert className="w-5 h-5" />
                            AGUARDAR
                          </span>
                        )}
                        <span className="text-xs font-mono text-slate-400">
                          · Score {masterBet.score}/100 ({masterBet.tier})
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs text-slate-400 block">Alocação</span>
                      <span className="font-mono text-base font-bold text-slate-100">
                        {masterBet.action === 'APOSTAR'
                          ? formatCurrency(masterBet.recommendedStake, bankroll.currency)
                          : '0'}
                      </span>
                      {masterBet.unitMultiplier > 0 && (
                        <span className="block text-[11px] font-mono text-emerald-400">
                          {masterBet.unitMultiplier}× unidade
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Target Market Callout */}
                  <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div>
                      <span className="text-[11px] text-slate-400 block">
                        Alvo Principal ({masterBet.primaryMarket})
                      </span>
                      <span className="text-sm font-semibold text-slate-100">
                        {masterBet.targetLabel}
                      </span>
                    </div>
                    {masterBet.targetNumbers.length <= 7 && masterBet.targetNumbers.length > 0 && (
                      <div className="flex gap-1 font-mono text-xs">
                        {masterBet.targetNumbers.map((n) => (
                          <span
                            key={n}
                            className="w-6 h-6 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-100"
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Entropy / Unpredictability Regime Guard */}
                  <div
                    className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                      regime.isBlocked
                        ? 'border-red-800/70 bg-red-950/30 text-red-200'
                        : 'border-slate-800 bg-slate-900/40 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between font-medium">
                      <span className="flex items-center gap-1.5">
                        {regime.isBlocked && (
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                        )}
                        Detetor de Entropia & Regime
                      </span>
                      <span className="font-mono">
                        Imprevisibilidade: {regime.unpredictabilityPct}% (máx {bankroll.unpredictabilityThresholdPct}%)
                      </span>
                    </div>

                    {masterBet.blockReason && (
                      <p className="font-semibold text-amber-300">
                        {masterBet.blockReason}
                      </p>
                    )}

                    {regime.reasons.length > 0 && (
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-300">
                        {regime.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}

                    <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] font-mono text-slate-400">
                      <span>Shannon: {regime.shannonEntropyPct.toFixed(0)}%</span>
                      <span>Únicos: {regime.uniqueRatioPct.toFixed(0)}%</span>
                      <span>Zero: {regime.zeroExcessPct.toFixed(1)}%</span>
                    </div>
                  </div>

                  {/* Candidate Scores */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {masterBet.candidates.map((c) => (
                      <div
                        key={c.market}
                        className="px-2.5 py-2 rounded bg-slate-900/50 border border-slate-800 flex items-center justify-between"
                      >
                        <span className="text-slate-300 truncate">{c.label}</span>
                        <span className="font-mono font-semibold text-slate-100 ml-2">
                          {c.score}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Mathematical Honesty Disclosure */}
                  <p className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-3 leading-relaxed">
                    Transparência Matemática: House Edge real da Roleta Europeia é{' '}
                    <strong className="font-mono text-slate-200">
                      {EUROPEAN_HOUSE_EDGE_PCT.toFixed(2)}%
                    </strong>{' '}
                    (Zero único). Os sinais representam padrões históricos observados; a banca da casa mantém vantagem matemática a longo prazo.
                  </p>
                </section>

                {/* Walk-Forward 0s Accuracy Card */}
                <section className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
                  <h2 className="text-sm font-semibold text-slate-100">
                    Taxa de Acerto Walk-Forward (0s Mesa & Sessão)
                  </h2>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
                      <span className="text-[11px] text-slate-400 block">
                        Mesa (Imediato 0s · últimos 30)
                      </span>
                      <span className="font-mono text-lg font-bold text-slate-100">
                        {walkForward.tableAttempts > 0
                          ? `${walkForward.tableAccuracyPct.toFixed(1)}%`
                          : '—'}
                      </span>
                      <span className="block text-[11px] font-mono text-slate-400">
                        {walkForward.tableHits}/{walkForward.tableAttempts} acertos
                      </span>
                    </div>

                    <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3">
                      <span className="text-[11px] text-slate-400 block">
                        Sessão ao Vivo
                      </span>
                      <span className="font-mono text-lg font-bold text-emerald-400">
                        {walkForward.sessionAttempts > 0
                          ? `${walkForward.sessionAccuracyPct.toFixed(1)}%`
                          : '—'}
                      </span>
                      <span className="block text-[11px] font-mono text-slate-400">
                        {walkForward.sessionHits}/{walkForward.sessionAttempts} acertos
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    {walkForward.tablePerMarket.map((tm, i) => {
                      const sm = walkForward.sessionPerMarket[i];
                      return (
                        <div
                          key={tm.market}
                          className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60 last:border-b-0"
                        >
                          <span className="text-slate-300">{tm.label}</span>
                          <div className="font-mono text-[11px] space-x-3">
                            <span className="text-slate-400">
                              Mesa:{' '}
                              {tm.attempts > 0 ? `${tm.accuracyPct.toFixed(0)}%` : '—'}
                            </span>
                            <span className="text-emerald-400">
                              Sessão:{' '}
                              {sm && sm.attempts > 0
                                ? `${sm.accuracyPct.toFixed(0)}%`
                                : '—'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Bankroll & Stop-Loss / Stop-Win Controls */}
                <section className="bg-[#111827] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-100">
                      Gestão de Banca & Limites Diários
                    </h2>
                    <span
                      className={`font-mono text-xs font-semibold ${
                        pnlAmount >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {pnlAmount >= 0 ? '+' : ''}
                      {formatCurrency(pnlAmount, bankroll.currency)} ({pnlPct >= 0 ? '+' : ''}
                      {pnlPct.toFixed(1)}%)
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-2.5 py-2">
                      <span className="text-slate-400 block text-[11px]">Banca Inicial</span>
                      <input
                        type="number"
                        min={100}
                        value={bankroll.initialBankroll}
                        onChange={(e) => {
                          const val = Math.max(100, Number(e.target.value) || 100);
                          setBankroll((b) => ({
                            ...b,
                            initialBankroll: val,
                            currentBankroll: val,
                          }));
                        }}
                        className="mt-0.5 w-full bg-transparent font-mono text-slate-100 focus:outline-none"
                      />
                    </label>
                    <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-2.5 py-2">
                      <span className="text-slate-400 block text-[11px]">Unidade Base</span>
                      <input
                        type="number"
                        min={1}
                        value={bankroll.baseUnit}
                        onChange={(e) =>
                          setBankroll((b) => ({
                            ...b,
                            baseUnit: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        className="mt-0.5 w-full bg-transparent font-mono text-slate-100 focus:outline-none"
                      />
                    </label>
                    <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-2.5 py-2">
                      <span className="text-slate-400 block text-[11px]">Banca Atual</span>
                      <span className="mt-0.5 block font-mono font-semibold text-slate-100">
                        {formatCurrency(bankroll.currentBankroll, bankroll.currency)}
                      </span>
                    </label>
                    <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-2.5 py-2">
                      <span className="text-slate-400 block text-[11px]">Stop-Loss (%)</span>
                      <input
                        type="number"
                        min={5}
                        max={90}
                        value={bankroll.stopLossPct}
                        onChange={(e) =>
                          setBankroll((b) => ({
                            ...b,
                            stopLossPct: Math.max(5, Math.min(90, Number(e.target.value) || 15)),
                          }))
                        }
                        className="mt-0.5 w-full bg-transparent font-mono text-red-400 focus:outline-none"
                      />
                    </label>
                    <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-2.5 py-2">
                      <span className="text-slate-400 block text-[11px]">Stop-Win (%)</span>
                      <input
                        type="number"
                        min={5}
                        max={200}
                        value={bankroll.stopWinPct}
                        onChange={(e) =>
                          setBankroll((b) => ({
                            ...b,
                            stopWinPct: Math.max(5, Math.min(200, Number(e.target.value) || 25)),
                          }))
                        }
                        className="mt-0.5 w-full bg-transparent font-mono text-emerald-400 focus:outline-none"
                      />
                    </label>
                    <label className="bg-slate-900/70 border border-slate-800 rounded-lg px-2.5 py-2">
                      <span className="text-slate-400 block text-[11px]">Teto Entropia (%)</span>
                      <input
                        type="number"
                        min={30}
                        max={95}
                        value={bankroll.unpredictabilityThresholdPct}
                        onChange={(e) =>
                          setBankroll((b) => ({
                            ...b,
                            unpredictabilityThresholdPct: Math.max(
                              30,
                              Math.min(95, Number(e.target.value) || 60)
                            ),
                          }))
                        }
                        className="mt-0.5 w-full bg-transparent font-mono text-amber-300 focus:outline-none"
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        <div className={activeTab === 'capture' ? 'block' : 'hidden'}>
          <CaptureOcrStudio
            activePreset={activePreset}
            isCapturing={isCapturing}
            captureMode={captureMode}
            lastFrameResult={lastFrameResult}
            reconcileLogs={reconcileLogs}
            onStartScreenCapture={handleStartScreenCapture}
            onStopCapture={handleStopCapture}
            onSelectCaptureMode={(m) => setCaptureMode(m)}
            onUpdatePreset={handleUpdatePreset}
            onProcessSourceFrame={handleProcessSourceFrame}
            videoRef={videoRef}
            syntheticCanvasRef={syntheticCanvasRef}
          />
        </div>

        {activeTab === 'history' && (
          <HistoryBacktestView
            currentEquityCurve={equityCurve}
            currentWalkForward={walkForward}
            currentCurrency={bankroll.currency}
            archivedSessions={archivedSessions}
            onArchiveCurrentSession={() => archiveCurrentSession()}
            onClearArchive={() => setArchivedSessions([])}
          />
        )}

        {activeTab === 'montecarlo' && (
          <MonteCarloView
            currency={bankroll.currency}
            defaultBankroll={bankroll.initialBankroll}
            defaultUnit={bankroll.baseUnit}
            defaultStopLossPct={bankroll.stopLossPct}
            defaultStopWinPct={bankroll.stopWinPct}
          />
        )}
      </main>
    </div>
  );
}
