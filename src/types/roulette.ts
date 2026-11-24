export type RouletteColor = 'GREEN' | 'RED' | 'BLACK';

export type SpinSource = 'ocr' | 'manual' | 'context';

export interface SpinEntry {
  id: string;
  number: number;
  color: RouletteColor;
  timestamp: number;
  source: SpinSource;
  confidence: number;
  multiplierDetected?: boolean;
  evaluation?: SpinMarketEvaluation;
}

export type MarketId =
  | 'COR'
  | 'PARIDADE'
  | 'ALTO_BAIXO'
  | 'DUZIA'
  | 'COLUNA'
  | 'VIZINHOS'
  | 'SETOR';

export interface SpinMarketEvaluation {
  results: Record<MarketId, boolean | null>; // true = OK, false = X, null = not applicable (e.g. 0 on outside bets)
  primaryHit: boolean | null;
}

export interface ROIRect {
  leftRatio: number;   // 0..1
  topRatio: number;    // 0..1
  widthRatio: number;  // 0..1
  heightRatio: number; // 0..1
}

export interface HSVRange {
  hueMin: number; // 0..360 (handles wrap-around if hueMin > hueMax)
  hueMax: number; // 0..360
  satMin: number; // 0..1
  satMax: number; // 0..1
  valMin: number; // 0..1
  valMax: number; // 0..1
}

export interface HSVProfile {
  name: string;
  green: HSVRange;
  red: HSVRange;
  black: HSVRange;
  calibratedSamples: number;
}

export type CasinoProviderId =
  | 'evolution'
  | 'pragmatic'
  | 'creedroomz'
  | 'playtech'
  | 'lightning'
  | 'custom';

export interface CasinoLayoutPreset {
  id: CasinoProviderId;
  name: string;
  description: string;
  roi: ROIRect;
  expectedCells: number;
  newestOnLeft: boolean;
  multiplierMode: boolean;
  hsvProfile: HSVProfile;
}

export interface FrameSignature {
  dHash: bigint;
  leftEdgeHash: bigint;
  meanLuma: number;
  timestamp: number;
}

export interface HSVSampleVote {
  greenVotes: number;
  redVotes: number;
  blackVotes: number;
  ignoredBright: number;
  resolvedColor: RouletteColor | null;
}

export interface OCRCellBox {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rawText: string;
  number: number | null;
  color: RouletteColor | null;
  confidence: number;
  rejectedReason?: string;
  hsvVotes: HSVSampleVote;
  invertedPreviewDataUrl?: string;
}

export interface OCRDetection {
  number: number;
  color: RouletteColor | null;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}

export interface OCRFrameResult {
  timestamp: number;
  processingMs: number;
  skippedBySignature: boolean;
  signatureReason: string;
  globalHamming: number;
  leftEdgeHamming: number;
  lumaDiff: number;
  detections: OCRDetection[];
  allBoxes: OCRCellBox[];
  clahePreviewDataUrl?: string;
  roiWidth: number;
  roiHeight: number;
}

export type ReconciliationEventType =
  | 'FULL_STRIP'
  | 'NEW_SPINS'
  | 'NO_CHANGE'
  | 'NEGATIVE_SHIFT_IGNORED'
  | 'PENDING_CONFIRMATION'
  | 'TABLE_SWITCH';

export interface ReconciliationEvent {
  type: ReconciliationEventType;
  spins: OCRDetection[];
  isFullStrip: boolean;
  shift: number;
  avgConfidence: number;
  message: string;
}

export interface NumberStat {
  number: number;
  color: RouletteColor;
  count: number;
  relativePct: number;
  currentDelay: number;
  maxDelay: number;
  markovScore: number;
  recencyScore: number;
}

export interface ExternalMarketStat {
  label: string;
  currentStreak: number;
  maxStreak: number;
  currentDelay: number;
  hitsLast20: number;
  totalHits: number;
}

export type ChipStrategyProfile = 'VIZINHOS' | 'SETORES' | 'EQUILIBRADO';

export type SectorName =
  | 'Voisins du Zéro'
  | 'Tiers du Cylindre'
  | 'Orphelins'
  | 'Jeu Zéro';

export interface SectorStat {
  name: SectorName;
  numbers: number[];
  hits: number;
  density: number; // hits / sectorSize
  currentDelay: number;
}

export interface ChipSuggestion {
  profile: ChipStrategyProfile;
  numbers: number[];
  chipCount: number;
  unitValue: number;
  totalStake: number;
  cappedByBankroll: boolean;
  description: string;
}

export interface RouletteAnalysis {
  totalCombined: number;
  sessionCount: number;
  contextCount: number;
  lastNumber: number | null;
  numberStats: NumberStat[];
  hotNumbers: NumberStat[];
  coldNumbers: NumberStat[];
  anchorNumber: number | null;
  anchorNeighbors: number[]; // 5 numbers (±2 on European wheel)
  topTransitions: Array<{ number: number; count: number; pct: number }>;
  colors: {
    red: ExternalMarketStat;
    black: ExternalMarketStat;
    zeroCount: number;
    zeroPct: number;
  };
  parity: {
    even: ExternalMarketStat;
    odd: ExternalMarketStat;
  };
  halves: {
    low: ExternalMarketStat;  // 1-18
    high: ExternalMarketStat; // 19-36
  };
  dozens: [ExternalMarketStat, ExternalMarketStat, ExternalMarketStat];
  columns: [ExternalMarketStat, ExternalMarketStat, ExternalMarketStat];
  sectors: SectorStat[];
  dominantSector: SectorStat | null;
  chipSuggestion: ChipSuggestion;
  suggestedTargets: Record<MarketId, { label: string; numbers: number[] }>;
}

export interface MarketRegimeReport {
  unpredictabilityPct: number; // 0..100
  isBlocked: boolean;
  shannonEntropyPct: number;
  uniqueRatioPct: number;
  alternationRatePct: number;
  zeroExcessPct: number;
  reasons: string[];
  sampleSize: number;
}

export type ConfidenceTier = 'Baixa' | 'Média' | 'Alta';
export type BetAction = 'APOSTAR' | 'AGUARDAR';

export interface MarketScoreCandidate {
  market: MarketId;
  label: string;
  targetLabel: string;
  targetNumbers: number[];
  score: number;
}

export interface MasterBetDecision {
  action: BetAction;
  tier: ConfidenceTier;
  score: number;
  primaryMarket: MarketId;
  targetLabel: string;
  targetNumbers: number[];
  unitMultiplier: number; // 0, 0.5, 1.0, 1.25
  recommendedStake: number;
  blockReason: string | null;
  candidates: MarketScoreCandidate[];
  houseEdgePct: number;
}

export interface MarketAccuracyMetric {
  market: MarketId;
  label: string;
  hits: number;
  attempts: number;
  accuracyPct: number;
}

export interface WalkForwardSummary {
  tableHits: number;
  tableAttempts: number;
  tableAccuracyPct: number;
  tablePerMarket: MarketAccuracyMetric[];
  sessionHits: number;
  sessionAttempts: number;
  sessionAccuracyPct: number;
  sessionPerMarket: MarketAccuracyMetric[];
}

export type CurrencyCode = 'AOA' | 'EUR' | 'USD' | 'BRL';

export interface BankrollConfig {
  initialBankroll: number;
  currentBankroll: number;
  baseUnit: number;
  stopLossPct: number; // e.g. 15 means -15%
  stopWinPct: number;  // e.g. 25 means +25%
  currency: CurrencyCode;
  unpredictabilityThresholdPct: number; // default 60
  strategyProfile: ChipStrategyProfile;
}

export interface SessionRecord {
  id: string;
  tableName: string;
  providerId: CasinoProviderId;
  startedAt: number;
  endedAt: number;
  sessionSpins: SpinEntry[];
  contextSpins: SpinEntry[];
  initialBankroll: number;
  finalBankroll: number;
  currency: CurrencyCode;
  avgOcrConfidence: number;
  walkForward: WalkForwardSummary;
  equityCurve: Array<{ spinIndex: number; balance: number; number: number }>;
}

export interface MonteCarloConfig {
  initialBankroll: number;
  baseUnit: number;
  spinsPerSession: number;
  simulations: number;
  stopLossPct: number;
  stopWinPct: number;
  tableMaxBet: number;
  betType: 'EVEN_MONEY' | 'DOZEN' | 'STRAIGHT_NEIGHBORS_5';
}

export interface StrategySimResult {
  strategyName: 'Flat Betting' | "D'Alembert" | 'Martingale (com Teto)';
  ruinProbabilityPct: number;
  stopWinProbabilityPct: number;
  avgFinalBankroll: number;
  medianFinalBankroll: number;
  avgMaxDrawdownPct: number;
  expectedValuePct: number;
  sampleTrajectory: number[]; // median equity curve across spins
  p10Trajectory: number[];
  p90Trajectory: number[];
}
