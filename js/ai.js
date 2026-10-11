// @ts-check
import { configured, post } from './supabase.js';

/** @typedef {'spellcheck' | 'rewrite' | 'summarize' | 'title'} AiAction */
/** @typedef {'offline' | 'limit' | 'too_long' | 'failed'} AiErrorCode */

const TIMEOUT = 60_000;

/** Sant när Supabase är inställt. Annars ska inga AI-funktioner visas. */
export const aiEnabled = configured;

export class AiError extends Error {
  /** @param {AiErrorCode} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Skickar text till serverfunktionen och ger tillbaka resultatet. Ändrar ingenting själv.
 * @param {AiAction} action
 * @param {string} text
 * @returns {Promise<string>}
 * @throws {AiError}
 */
export async function runAi(action, text) {
  if (!navigator.onLine) throw new AiError('offline');

  /** @type {Response} */
  let res;
  try {
    res = await post('/functions/v1/ai', { action, text }, AbortSignal.timeout(TIMEOUT));
  } catch (err) {
    // fetch kastar TypeError när nätet inte går att nå. Allt annat (t.ex. timeout) är ett vanligt fel.
    throw new AiError(err instanceof TypeError ? 'offline' : 'failed');
  }
  if (res.status === 429) throw new AiError('limit');
  if (res.status === 413) throw new AiError('too_long');
  if (!res.ok) throw new AiError('failed');

  const data = await res.json().catch(() => null);
  if (typeof data?.text !== 'string' || data.text === '') throw new AiError('failed');
  return data.text;
}
