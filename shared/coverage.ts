/**
 * Coverage as the editor needs it.
 *
 * Deliberately line-oriented rather than a faithful model of every format's
 * detail: the two things a coverage view has to answer are "which lines did the
 * tests not run" and "how much of this file is covered". Branch and function
 * totals ride along for the summary but do not drive the gutter.
 */

export interface FileCoverage {
  /** Absolute path. */
  path: string
  /** Hit count per 1-based line. Absent lines are not instrumented. */
  lines: Record<number, number>
  /** Lines that are instrumented but were never executed. */
  uncovered: number[]
  /** Lines where some branches were taken and others were not. */
  partial: number[]
  coveredLines: number
  totalLines: number
  coveredBranches: number
  totalBranches: number
  coveredFunctions: number
  totalFunctions: number
}

export interface CoverageReport {
  /** Which run produced this, so a stale report can be labelled. */
  at: number
  /** Absolute path of the report file it was parsed from. */
  source: string
  format: 'lcov' | 'istanbul' | 'cobertura' | 'go'
  files: FileCoverage[]
  totals: {
    coveredLines: number
    totalLines: number
    coveredBranches: number
    totalBranches: number
    coveredFunctions: number
    totalFunctions: number
  }
}

export function percent(covered: number, total: number): number {
  if (!total) return 100
  return Math.round((covered / total) * 1000) / 10
}
