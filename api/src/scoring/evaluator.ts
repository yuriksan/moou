import { compileExpression } from 'filtrex';
import { scoringFunctions } from './functions.js';

type CompiledFormula = (data: Record<string, unknown>) => number;

// Cache compiled formulas by formula string
const formulaCache = new Map<string, CompiledFormula>();

/**
 * Compile a scoring formula string into a reusable function.
 * Uses filtrex for safe expression evaluation with custom functions.
 */
export function compileFormula(formulaStr: string): CompiledFormula {
  let compiled = formulaCache.get(formulaStr);
  if (compiled) return compiled;

  try {
    compiled = compileExpression(formulaStr, {
      extraFunctions: scoringFunctions,
      customProp: (name: string, _get: unknown, obj: Record<string, unknown>) =>
        obj.hasOwnProperty(name) ? obj[name] : 0,
    }) as CompiledFormula;
    formulaCache.set(formulaStr, compiled);
    return compiled;
  } catch (err) {
    console.error(`Failed to compile formula: ${formulaStr}`, err);
    return () => 0;
  }
}

/**
 * Evaluate a scoring formula against motivation attributes.
 * Returns numeric score, or 0 on any error.
 */
/**
 * Replace undefined/null values with 0 so arithmetic doesn't produce NaN.
 * filtrex resolves missing variables as undefined, and undefined * N = NaN.
 */
function sanitizeAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    result[key] = (value === undefined || value === null) ? 0 : value;
  }
  return result;
}

/**
 * Evaluate a scoring formula against motivation attributes.
 * Returns numeric score, or 0 on any error.
 */
export function evaluateScore(formulaStr: string, attributes: Record<string, unknown>): number {
  const fn = compileFormula(formulaStr);
  try {
    const result = fn(sanitizeAttributes(attributes));
    // filtrex may return non-numbers for invalid expressions
    if (typeof result !== 'number' || !isFinite(result)) return 0;
    return Math.round(result * 100) / 100; // round to 2 decimal places
  } catch (err) {
    console.error(`Failed to evaluate formula: ${formulaStr}`, err);
    return 0;
  }
}
