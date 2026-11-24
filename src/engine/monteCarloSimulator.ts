import { MonteCarloConfig, StrategySimResult } from '../types/roulette';

function getBetWinProbabilityAndPayout(betType: MonteCarloConfig['betType']) {
  // Exact European Roulette single-zero probabilities (37 pockets, 2.70% house edge)
  switch (betType) {
    case 'EVEN_MONEY':
      return { winProb: 18 / 37, netWinMult: 1 }; // Pays 1:1
    case 'DOZEN':
      return { winProb: 12 / 37, netWinMult: 2 }; // Pays 2:1
    case 'STRAIGHT_NEIGHBORS_5':
      return { winProb: 5 / 37, netWinMult: 31 / 5 }; // 5 chips -> win 36 total (+31 net on 5) = 6.2:1 net
  }
}

function simulateSingleRun(
  strategy: 'FLAT' | 'DALEMBERT' | 'MARTINGALE',
  config: MonteCarloConfig
) {
  const {
    initialBankroll,
    baseUnit,
    spinsPerSession,
    stopLossPct,
    stopWinPct,
    tableMaxBet,
  } = config;

  const { winProb, netWinMult } = getBetWinProbabilityAndPayout(config.betType);
  const stopLossBalance = initialBankroll * (1 - stopLossPct / 100);
  const stopWinBalance = initialBankroll * (1 + stopWinPct / 100);

  let balance = initialBankroll;
  let peak = initialBankroll;
  let maxDrawdownPct = 0;
  let currentStake = Math.min(baseUnit, tableMaxBet);
  let ruined = false;
  let hitStopWin = false;

  const trajectory: number[] = new Array(spinsPerSession + 1).fill(initialBankroll);

  for (let s = 1; s <= spinsPerSession; s++) {
    if (balance <= stopLossBalance || balance < baseUnit) {
      ruined = true;
      trajectory[s] = balance;
      continue;
    }
    if (balance >= stopWinBalance) {
      hitStopWin = true;
      trajectory[s] = balance;
      continue;
    }

    const stake = Math.min(currentStake, balance, tableMaxBet);
    const won = Math.random() < winProb;

    if (won) {
      balance += stake * netWinMult;
      if (strategy === 'MARTINGALE') {
        currentStake = baseUnit;
      } else if (strategy === 'DALEMBERT') {
        currentStake = Math.max(baseUnit, currentStake - baseUnit);
      }
    } else {
      balance -= stake;
      if (strategy === 'MARTINGALE') {
        currentStake = Math.min(tableMaxBet, currentStake * 2);
      } else if (strategy === 'DALEMBERT') {
        currentStake = Math.min(tableMaxBet, currentStake + baseUnit);
      }
    }

    if (balance > peak) peak = balance;
    const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;

    if (balance <= stopLossBalance || balance < baseUnit) ruined = true;
    if (balance >= stopWinBalance) hitStopWin = true;

    trajectory[s] = balance;
  }

  return {
    finalBalance: balance,
    ruined,
    hitStopWin,
    maxDrawdownPct,
    trajectory,
  };
}

function runStrategyBatch(
  strategy: 'FLAT' | 'DALEMBERT' | 'MARTINGALE',
  strategyName: StrategySimResult['strategyName'],
  config: MonteCarloConfig
): StrategySimResult {
  const { simulations, spinsPerSession, initialBankroll } = config;
  const finals: number[] = [];
  let ruins = 0;
  let stopWins = 0;
  let ddSum = 0;

  const trajectories: number[][] = [];

  for (let r = 0; r < simulations; r++) {
    const res = simulateSingleRun(strategy, config);
    finals.push(res.finalBalance);
    if (res.ruined) ruins++;
    if (res.hitStopWin) stopWins++;
    ddSum += res.maxDrawdownPct;
    trajectories.push(res.trajectory);
  }

  finals.sort((a, b) => a - b);
  const avgFinalBankroll = finals.reduce((acc, v) => acc + v, 0) / simulations;
  const medianFinalBankroll = finals[Math.floor(simulations / 2)];
  const expectedValuePct =
    initialBankroll > 0 ? ((avgFinalBankroll - initialBankroll) / initialBankroll) * 100 : 0;

  // Compute P10, Median, P90 across spin indices
  const sampleTrajectory: number[] = [];
  const p10Trajectory: number[] = [];
  const p90Trajectory: number[] = [];
  const step = Math.max(1, Math.floor(spinsPerSession / 60));

  for (let s = 0; s <= spinsPerSession; s += step) {
    const vals = trajectories.map((t) => t[s]).sort((a, b) => a - b);
    p10Trajectory.push(vals[Math.floor(vals.length * 0.1)]);
    sampleTrajectory.push(vals[Math.floor(vals.length * 0.5)]);
    p90Trajectory.push(vals[Math.floor(vals.length * 0.9)]);
  }

  return {
    strategyName,
    ruinProbabilityPct: (ruins / simulations) * 100,
    stopWinProbabilityPct: (stopWins / simulations) * 100,
    avgFinalBankroll,
    medianFinalBankroll,
    avgMaxDrawdownPct: ddSum / simulations,
    expectedValuePct,
    sampleTrajectory,
    p10Trajectory,
    p90Trajectory,
  };
}

export function runMonteCarloComparison(config: MonteCarloConfig): StrategySimResult[] {
  return [
    runStrategyBatch('FLAT', 'Flat Betting', config),
    runStrategyBatch('DALEMBERT', "D'Alembert", config),
    runStrategyBatch('MARTINGALE', 'Martingale (com Teto)', config),
  ];
}
