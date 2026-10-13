/**
 * Workshop scoring for allocation (plan section 4.3):
 *
 *   S = 0.35 (1 - ETA/ETA_max) + 0.20 R + 0.15 (1 - active/staff) + 0.20 P(accept) + 0.10 F
 *
 * All terms are in [0, 1], so S is in [0, 1].
 */
export interface Weights {
  eta: number;
  rating: number;
  load: number;
  accept: number;
  fairness: number;
}

export const DEFAULT_WEIGHTS: Weights = { eta: 0.35, rating: 0.2, load: 0.15, accept: 0.2, fairness: 0.1 };

/** Prior weight C for the Bayesian rating, and the platform mean used when there are no reviews. */
export const RATING_PRIOR_WEIGHT = 10;
export const DEFAULT_PLATFORM_MEAN = 4.0;

/** Score multiplier for a workshop flagged by the acceptance floor. */
export const LOW_ACCEPTANCE_PENALTY = 0.85;

/** Prior strength and mean for the smoothed acceptance rate. */
export const ACCEPT_PRIOR_WEIGHT = 10;
export const DEFAULT_ACCEPT_PRIOR = 0.6;

export interface Candidate {
  workshopId: string;
  etaMin: number;
  distanceKm: number;
  staffCount: number;
  /** accepted + in_progress jobs, plus offers currently pending */
  activeJobs: number;
  ratingSum: number;
  ratingCount: number;
  jobsToday: number;
  offers30d: number;
  accepted30d: number;
  /** replaced by the ML model's probability when available */
  pAccept?: number;
  /** acceptance rate under 40% over the last 20 offers (trust & safety rule) */
  lowAcceptance?: boolean;
}

export interface ScoreContext {
  weights?: Weights;
  platformMeanRating?: number;
  platformAcceptRate?: number;
}

export interface ScoreBreakdown {
  eta: number;
  rating: number;
  load: number;
  accept: number;
  fairness: number;
}

export interface Scored {
  candidate: Candidate;
  score: number;
  parts: ScoreBreakdown;
}

/** A shop with one 5-star review must not outrank one with 200 reviews at 4.6. */
export function bayesianRating(
  sum: number,
  count: number,
  platformMean = DEFAULT_PLATFORM_MEAN,
  priorWeight = RATING_PRIOR_WEIGHT,
): number {
  return (priorWeight * platformMean + sum) / (5 * (priorWeight + count));
}

export function smoothedAcceptRate(
  accepted: number,
  offers: number,
  prior = DEFAULT_ACCEPT_PRIOR,
  priorWeight = ACCEPT_PRIOR_WEIGHT,
): number {
  return (accepted + priorWeight * prior) / (offers + priorWeight);
}

/** Decays with the jobs a shop already got today so one shop cannot take everything. */
export function fairness(jobsToday: number): number {
  return 1 / (1 + Math.max(0, jobsToday));
}

export function scoreCandidates(candidates: Candidate[], ctx: ScoreContext = {}): Scored[] {
  if (candidates.length === 0) return [];
  const w = ctx.weights ?? DEFAULT_WEIGHTS;
  const etaMax = Math.max(...candidates.map((c) => c.etaMin));

  const scored = candidates.map((c) => {
    const parts: ScoreBreakdown = {
      eta: etaMax > 0 ? 1 - c.etaMin / etaMax : 1,
      rating: bayesianRating(c.ratingSum, c.ratingCount, ctx.platformMeanRating),
      load: c.staffCount > 0 ? Math.max(0, 1 - c.activeJobs / c.staffCount) : 0,
      accept: c.pAccept ?? smoothedAcceptRate(c.accepted30d, c.offers30d, ctx.platformAcceptRate),
      fairness: fairness(c.jobsToday),
    };
    const raw =
      w.eta * parts.eta +
      w.rating * parts.rating +
      w.load * parts.load +
      w.accept * parts.accept +
      w.fairness * parts.fairness;
    const score = c.lowAcceptance ? raw * LOW_ACCEPTANCE_PENALTY : raw;
    return { candidate: c, score, parts };
  });

  // ties broken by the faster shop so results are deterministic
  return scored.sort(
    (a, b) => b.score - a.score || a.candidate.etaMin - b.candidate.etaMin || (a.candidate.workshopId < b.candidate.workshopId ? -1 : 1),
  );
}
