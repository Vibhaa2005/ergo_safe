// noiseMath.js
// Noise exposure calculations (no screen code here, so it can be tested).
//
// Allowed time T = 8 h / 2^((L − criterion) / exchangeRate)
// Daily dose D   = Σ (time spent at level / allowed time at that level) × 100 %
// TWA            = criterion + exchangeRate × log2(D / 100)

export const NOISE_STANDARDS = {
  niosh: {
    key: 'niosh',
    label: 'NIOSH (85 dB(A), 3 dB exchange)',
    shortLabel: 'NIOSH',
    criterionLevel: 85,
    exchangeRate: 3,
    threshold: 80,   // levels below this are not counted
    ceiling: 140,
  },
  india: {
    key: 'india',
    label: 'Factories Act, India (90 dB(A), 5 dB exchange)',
    shortLabel: 'Factories Act',
    criterionLevel: 90,
    exchangeRate: 5,
    threshold: 90,
    ceiling: 115,
  },
};

export function allowedHours(levelDb, standard) {
  if (levelDb < standard.threshold) {
    return Infinity;
  }
  return 8 / Math.pow(2, (levelDb - standard.criterionLevel) / standard.exchangeRate);
}

// entries = [{ zone, levelDb, hours }]
export function dailyDosePercent(entries, standard) {
  let dose = 0;
  for (const entry of entries) {
    const allowed = allowedHours(entry.levelDb, standard);
    if (isFinite(allowed)) {
      dose += (entry.hours / allowed) * 100;
    }
  }
  return dose;
}

export function timeWeightedAverage(dosePercent, standard) {
  if (dosePercent <= 0) {
    return null;
  }
  return standard.criterionLevel + standard.exchangeRate * Math.log2(dosePercent / 100);
}

// Combined sound level of several entries over the shift (energy average).
export function equivalentLevel(entries) {
  let totalHours = 0;
  let energy = 0;
  for (const entry of entries) {
    totalHours += entry.hours;
    energy += entry.hours * Math.pow(10, entry.levelDb / 10);
  }
  if (totalHours === 0) {
    return null;
  }
  return 10 * Math.log10(energy / totalHours);
}

export function doseStatus(dosePercent, entries, standard) {
  for (const entry of entries) {
    if (entry.levelDb > standard.ceiling) {
      return { riskLevel: 'veryhigh', label: 'Above the never-exceed ceiling', text: 'Some zone is above ' + standard.ceiling + ' dB(A). No unprotected exposure is allowed there.' };
    }
  }
  if (dosePercent > 100) {
    return { riskLevel: 'high', label: 'Over the daily limit', text: 'Daily noise dose exceeds 100 %. Hearing damage is likely over time without control measures.' };
  }
  if (dosePercent >= 50) {
    return { riskLevel: 'medium', label: 'Action level reached', text: 'Dose is 50–100 %. Start a hearing conservation programme: protectors available, yearly hearing tests.' };
  }
  return { riskLevel: 'low', label: 'Within limits', text: 'Daily dose below 50 % of the limit.' };
}

// Hearing protector needed to bring the level at the ear down to 80 dB(A).
// Uses the OSHA field de-rating for A-weighted measurements:
//   real protection ≈ (NRR − 7) / 2
export function requiredProtectorNrr(twaDb) {
  const targetAtEar = 80;
  if (twaDb === null || twaDb <= targetAtEar) {
    return null;
  }
  const attenuationNeeded = twaDb - targetAtEar;
  return Math.ceil(attenuationNeeded * 2 + 7);
}

// ---------- A-weighting for the live microphone meter ----------

// A-weighting gain in dB at frequency f (IEC 61672).
export function aWeightingDb(frequency) {
  const f2 = frequency * frequency;
  const numerator = Math.pow(12194, 2) * f2 * f2;
  const denominator = (f2 + Math.pow(20.6, 2)) *
    Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2))) *
    (f2 + Math.pow(12194, 2));
  return 20 * Math.log10(numerator / denominator) + 2.0;
}
