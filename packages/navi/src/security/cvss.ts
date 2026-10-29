/**
 * CVSS v3.1 Base Score Calculator
 * Implements the FIRST.org Common Vulnerability Scoring System v3.1 specification.
 */

export interface CvssV31Vector {
  attack_vector: "N" | "A" | "L" | "P" // Network, Adjacent, Local, Physical
  attack_complexity: "L" | "H" // Low, High
  privileges_required: "N" | "L" | "H" // None, Low, High
  user_interaction: "N" | "R" // None, Required
  scope: "U" | "C" // Unchanged, Changed
  confidentiality: "N" | "L" | "H" // None, Low, High
  integrity: "N" | "L" | "H" // None, Low, High
  availability: "N" | "L" | "H" // None, Low, High
}

export type SeverityLevel = "none" | "low" | "medium" | "high" | "critical"

export interface CvssResult {
  score: number
  severity: SeverityLevel
  vector: string
}

const METRIC_WEIGHTS = {
  attack_vector: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  attack_complexity: { L: 0.77, H: 0.44 },
  privileges_required: {
    U: { N: 0.85, L: 0.62, H: 0.27 },
    C: { N: 0.85, L: 0.68, H: 0.5 },
  },
  user_interaction: { N: 0.85, R: 0.62 },
  confidentiality: { H: 0.56, L: 0.22, N: 0.0 },
  integrity: { H: 0.56, L: 0.22, N: 0.0 },
  availability: { H: 0.56, L: 0.22, N: 0.0 },
}

function roundup(input: number): number {
  const intInput = Math.round(input * 100000)
  if (intInput % 10000 === 0) {
    return intInput / 100000
  }
  return (Math.floor(intInput / 10000) + 1) / 10
}

/**
 * Calculates CVSS 3.1 Base Score and determines Severity.
 */
export function calculateCvss(vector: CvssV31Vector): CvssResult {
  const av = METRIC_WEIGHTS.attack_vector[vector.attack_vector]
  const ac = METRIC_WEIGHTS.attack_complexity[vector.attack_complexity]
  const pr = METRIC_WEIGHTS.privileges_required[vector.scope][vector.privileges_required]
  const ui = METRIC_WEIGHTS.user_interaction[vector.user_interaction]

  const c = METRIC_WEIGHTS.confidentiality[vector.confidentiality]
  const i = METRIC_WEIGHTS.integrity[vector.integrity]
  const a = METRIC_WEIGHTS.availability[vector.availability]

  // ISS = 1 - [ (1 - Impact_Conf) × (1 - Impact_Integ) × (1 - Impact_Avail) ]
  const iss = 1.0 - (1.0 - c) * (1.0 - i) * (1.0 - a)

  // Impact Sub score
  let impact: number
  if (vector.scope === "U") {
    impact = 6.42 * iss
  } else {
    impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
  }

  // Exploitability
  const exploitability = 8.22 * av * ac * pr * ui

  let score: number
  if (impact <= 0) {
    score = 0.0
  } else if (vector.scope === "U") {
    score = roundup(Math.min(impact + exploitability, 10.0))
  } else {
    score = roundup(Math.min(1.08 * (impact + exploitability), 10.0))
  }

  // Format canonical CVSS:3.1 string
  const vectorStr =
    `CVSS:3.1/AV:${vector.attack_vector}/AC:${vector.attack_complexity}/` +
    `PR:${vector.privileges_required}/UI:${vector.user_interaction}/` +
    `S:${vector.scope}/C:${vector.confidentiality}/I:${vector.integrity}/A:${vector.availability}`

  let severity: SeverityLevel = "none"
  if (score === 0.0) severity = "none"
  else if (score < 4.0) severity = "low"
  else if (score < 7.0) severity = "medium"
  else if (score < 9.0) severity = "high"
  else severity = "critical"

  return {
    score,
    severity,
    vector: vectorStr,
  }
}
