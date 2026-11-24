import { MarketId, RouletteColor, SectorName } from '../types/roulette';

// Official physical European single-zero roulette wheel sequence (clockwise from 0)
export const EUROPEAN_WHEEL_SEQUENCE: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const EUROPEAN_HOUSE_EDGE_PCT = 2.70; // 1 / 37 = 2.7027%

export const RED_NUMBERS = new Set<number>([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const BLACK_NUMBERS = new Set<number>(
  Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => !RED_NUMBERS.has(n))
);

export const WHEEL_SECTORS: Record<SectorName, number[]> = {
  'Voisins du Zéro': [22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25],
  'Tiers du Cylindre': [27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33],
  'Orphelins': [1, 20, 14, 31, 9, 17, 34, 6],
  'Jeu Zéro': [12, 35, 3, 26, 0, 32, 15],
};

export const MARKET_LABELS: Record<MarketId, string> = {
  COR: 'Cor (Vermelho / Preto)',
  PARIDADE: 'Par / Ímpar',
  ALTO_BAIXO: 'Força (1–18 / 19–36)',
  DUZIA: 'Dúzia em Atraso',
  COLUNA: 'Coluna em Atraso',
  VIZINHOS: 'Âncora & Vizinhos ±2',
  SETOR: 'Setor da Roda',
};

export const ALL_MARKETS: MarketId[] = [
  'COR',
  'PARIDADE',
  'ALTO_BAIXO',
  'DUZIA',
  'COLUNA',
  'VIZINHOS',
  'SETOR',
];

export function getNumberColor(num: number): RouletteColor {
  if (num === 0) return 'GREEN';
  if (RED_NUMBERS.has(num)) return 'RED';
  return 'BLACK';
}

export function getDozen(num: number): 1 | 2 | 3 | null {
  if (num <= 0 || num > 36) return null;
  if (num <= 12) return 1;
  if (num <= 24) return 2;
  return 3;
}

export function getColumn(num: number): 1 | 2 | 3 | null {
  if (num <= 0 || num > 36) return null;
  const mod = num % 3;
  if (mod === 1) return 1;
  if (mod === 2) return 2;
  return 3;
}

export function getWheelNeighbors(anchor: number, radius = 2): number[] {
  const idx = EUROPEAN_WHEEL_SEQUENCE.indexOf(anchor);
  if (idx === -1) return [];
  const len = EUROPEAN_WHEEL_SEQUENCE.length;
  const result: number[] = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const pos = ((idx + offset) % len + len) % len;
    result.push(EUROPEAN_WHEEL_SEQUENCE[pos]);
  }
  return result;
}

export function getWheelDistance(a: number, b: number): number {
  const ia = EUROPEAN_WHEEL_SEQUENCE.indexOf(a);
  const ib = EUROPEAN_WHEEL_SEQUENCE.indexOf(b);
  if (ia === -1 || ib === -1) return 99;
  const diff = Math.abs(ia - ib);
  return Math.min(diff, EUROPEAN_WHEEL_SEQUENCE.length - diff);
}

export function isNumberInSector(num: number, sector: SectorName): boolean {
  return WHEEL_SECTORS[sector].includes(num);
}

export function formatCurrency(value: number, currency: 'AOA' | 'EUR' | 'USD' | 'BRL'): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const formatted = abs.toLocaleString('pt-PT', {
    minimumFractionDigits: currency === 'AOA' ? 0 : 2,
    maximumFractionDigits: currency === 'AOA' ? 0 : 2,
  });
  switch (currency) {
    case 'AOA':
      return `${sign}${formatted} Kz`;
    case 'EUR':
      return `${sign}€${formatted}`;
    case 'USD':
      return `${sign}$${formatted}`;
    case 'BRL':
      return `${sign}R$ ${formatted}`;
  }
}
