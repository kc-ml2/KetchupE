export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Brier score of probability forecasts against binary outcomes. */
export function brier(pairs: Array<{ predicted: number; outcome: boolean }>): number {
  return mean(pairs.map(({ predicted, outcome }) => (predicted - (outcome ? 1 : 0)) ** 2));
}

/** Expected calibration error with equal-width bins. */
export function ece(pairs: Array<{ predicted: number; outcome: boolean }>, bins = 10): number {
  if (!pairs.length) return 0;
  const buckets = Array.from({ length: bins }, () => ({ confidence: 0, hits: 0, count: 0 }));
  for (const { predicted, outcome } of pairs) {
    const bucket = buckets[Math.min(bins - 1, Math.floor(predicted * bins))];
    bucket.confidence += predicted;
    bucket.hits += outcome ? 1 : 0;
    bucket.count += 1;
  }
  return buckets.reduce((total, bucket) => (bucket.count ? total + (bucket.count / pairs.length) * Math.abs(bucket.hits / bucket.count - bucket.confidence / bucket.count) : total), 0);
}

export function macroF1(pairs: Array<{ predicted: number | string; actual: number | string }>): number {
  const labels = new Set(pairs.flatMap(({ predicted, actual }) => [predicted, actual]));
  const scores = [...labels].map((label) => {
    const tp = pairs.filter((pair) => pair.predicted === label && pair.actual === label).length;
    const fp = pairs.filter((pair) => pair.predicted === label && pair.actual !== label).length;
    const fn = pairs.filter((pair) => pair.predicted !== label && pair.actual === label).length;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  });
  return mean(scores);
}

/** Risk–coverage curve: at each confidence threshold, coverage = share answered, risk = failure rate among them. */
export function riskCoverage(pairs: Array<{ predicted: number; outcome: boolean }>, thresholds = [0, 0.3, 0.5, 0.7, 0.9]): Array<{ threshold: number; coverage: number; risk: number }> {
  return thresholds.map((threshold) => {
    const covered = pairs.filter((pair) => pair.predicted >= threshold);
    return { threshold, coverage: pairs.length ? covered.length / pairs.length : 0, risk: covered.length ? covered.filter((pair) => !pair.outcome).length / covered.length : 0 };
  });
}

export function recallAtK(rankedHits: boolean[], k: number, relevantTotal: number): number {
  return relevantTotal ? rankedHits.slice(0, k).filter(Boolean).length / relevantTotal : 0;
}

export function mrr(rankedHits: boolean[], k: number): number {
  const index = rankedHits.slice(0, k).findIndex(Boolean);
  return index < 0 ? 0 : 1 / (index + 1);
}

export function ndcg(rankedHits: boolean[], k: number, relevantTotal: number): number {
  const dcg = rankedHits.slice(0, k).reduce((sum, hit, index) => sum + (hit ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(k, relevantTotal) }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  return ideal ? dcg / ideal : 0;
}
