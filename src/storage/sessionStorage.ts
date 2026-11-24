import {
  BankrollConfig,
  CasinoLayoutPreset,
  CasinoProviderId,
  HSVProfile,
  SessionRecord,
} from '../types/roulette';

const STORAGE_KEYS = {
  PRESETS: 'roletalab_layout_presets_v1',
  ACTIVE_PRESET_ID: 'roletalab_active_preset_v1',
  BANKROLL: 'roletalab_bankroll_v1',
  SESSIONS: 'roletalab_sessions_v1',
};

const DEFAULT_HSV_PROFILE: HSVProfile = {
  name: 'Padrão Europeu',
  green: { hueMin: 85, hueMax: 165, satMin: 0.25, satMax: 1, valMin: 0.18, valMax: 1 },
  red: { hueMin: 332, hueMax: 22, satMin: 0.28, satMax: 1, valMin: 0.20, valMax: 1 },
  black: { hueMin: 0, hueMax: 360, satMin: 0, satMax: 0.28, valMin: 0, valMax: 0.28 },
  calibratedSamples: 0,
};

export const DEFAULT_LAYOUT_PRESETS: CasinoLayoutPreset[] = [
  {
    id: 'evolution',
    name: 'Evolution Gaming',
    description: 'Faixa horizontal inferior/superior com 12 pílulas, mais recente à esquerda.',
    roi: { leftRatio: 0.08, topRatio: 0.14, widthRatio: 0.84, heightRatio: 0.14 },
    expectedCells: 12,
    newestOnLeft: true,
    multiplierMode: false,
    hsvProfile: { ...DEFAULT_HSV_PROFILE, name: 'Evolution' },
  },
  {
    id: 'pragmatic',
    name: 'Pragmatic Play',
    description: 'Faixa compacta de histórico (12 números), mais recente à esquerda.',
    roi: { leftRatio: 0.1, topRatio: 0.12, widthRatio: 0.8, heightRatio: 0.13 },
    expectedCells: 12,
    newestOnLeft: true,
    multiplierMode: false,
    hsvProfile: { ...DEFAULT_HSV_PROFILE, name: 'Pragmatic Play' },
  },
  {
    id: 'creedroomz',
    name: 'Creedroomz',
    description: 'Pílulas quadradas de alto contraste, 10–12 células visíveis.',
    roi: { leftRatio: 0.12, topRatio: 0.15, widthRatio: 0.76, heightRatio: 0.14 },
    expectedCells: 10,
    newestOnLeft: true,
    multiplierMode: false,
    hsvProfile: { ...DEFAULT_HSV_PROFILE, name: 'Creedroomz' },
  },
  {
    id: 'playtech',
    name: 'Playtech Live',
    description: 'Faixa lateral/superior configurável com opção mais recente à direita.',
    roi: { leftRatio: 0.1, topRatio: 0.16, widthRatio: 0.8, heightRatio: 0.14 },
    expectedCells: 12,
    newestOnLeft: false,
    multiplierMode: false,
    hsvProfile: { ...DEFAULT_HSV_PROFILE, name: 'Playtech' },
  },
  {
    id: 'lightning',
    name: 'Lightning / Inferno / XXXtreme',
    description: 'Recorta apenas os 70% superiores da célula e bloqueia sub-badges 50x–500x.',
    roi: { leftRatio: 0.08, topRatio: 0.14, widthRatio: 0.84, heightRatio: 0.18 },
    expectedCells: 10,
    newestOnLeft: true,
    multiplierMode: true,
    hsvProfile: { ...DEFAULT_HSV_PROFILE, name: 'Lightning / Multiplicadores' },
  },
];

export const DEFAULT_BANKROLL_CONFIG: BankrollConfig = {
  initialBankroll: 100000,
  currentBankroll: 100000,
  baseUnit: 1000,
  stopLossPct: 15,
  stopWinPct: 25,
  currency: 'AOA',
  unpredictabilityThresholdPct: 60,
  strategyProfile: 'VIZINHOS',
};

export function loadLayoutPresets(): CasinoLayoutPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PRESETS);
    if (!raw) return DEFAULT_LAYOUT_PRESETS;
    const parsed = JSON.parse(raw) as CasinoLayoutPreset[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_LAYOUT_PRESETS;
  } catch {
    return DEFAULT_LAYOUT_PRESETS;
  }
}

export function saveLayoutPresets(presets: CasinoLayoutPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(presets));
  } catch {
    // Ignore quota errors
  }
}

export function loadActivePresetId(): CasinoProviderId {
  try {
    const id = localStorage.getItem(STORAGE_KEYS.ACTIVE_PRESET_ID) as CasinoProviderId | null;
    return id ?? 'evolution';
  } catch {
    return 'evolution';
  }
}

export function saveActivePresetId(id: CasinoProviderId): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PRESET_ID, id);
  } catch {
    // Ignore
  }
}

export function loadBankrollConfig(): BankrollConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BANKROLL);
    if (!raw) return DEFAULT_BANKROLL_CONFIG;
    return { ...DEFAULT_BANKROLL_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_BANKROLL_CONFIG;
  }
}

export function saveBankrollConfig(cfg: BankrollConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.BANKROLL, JSON.stringify(cfg));
  } catch {
    // Ignore
  }
}

export function loadSessionArchive(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessionArchive(sessions: SessionRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions.slice(0, 50)));
  } catch {
    // Ignore
  }
}

export function exportSessionsToJSON(sessions: SessionRecord[]): string {
  return JSON.stringify(sessions, null, 2);
}

export function exportSessionsToCSV(sessions: SessionRecord[]): string {
  const headers = [
    'session_id',
    'table_name',
    'provider',
    'started_at',
    'ended_at',
    'session_spins_count',
    'context_spins_count',
    'currency',
    'initial_bankroll',
    'final_bankroll',
    'pnl',
    'avg_ocr_conf_pct',
    'table_wf_accuracy_pct',
    'session_wf_accuracy_pct',
    'sequence_newest_first',
  ];

  const rows = sessions.map((s) => {
    const pnl = s.finalBankroll - s.initialBankroll;
    const seq = s.sessionSpins.map((sp) => sp.number).join(' ');
    return [
      s.id,
      `"${s.tableName.replace(/"/g, '""')}"`,
      s.providerId,
      new Date(s.startedAt).toISOString(),
      new Date(s.endedAt).toISOString(),
      s.sessionSpins.length,
      s.contextSpins.length,
      s.currency,
      s.initialBankroll,
      s.finalBankroll,
      pnl,
      (s.avgOcrConfidence * 100).toFixed(1),
      s.walkForward.tableAccuracyPct.toFixed(1),
      s.walkForward.sessionAccuracyPct.toFixed(1),
      `"${seq}"`,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
