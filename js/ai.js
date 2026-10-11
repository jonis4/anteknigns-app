// @ts-check
import { configured, request } from './supabase.js';

/** @typedef {'spellcheck' | 'rewrite' | 'summarize'} AiAction */
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
  const data = await call({ action, text });
  if (typeof data?.text !== 'string' || data.text === '') throw new AiError('failed');
  return data.text;
}

/**
 * Ber om rubrik och kategori för en anteckning. Kategorin väljs i första hand bland de befintliga.
 * @param {string} text
 * @param {string[]} categories
 * @returns {Promise<{ title: string, category: string }>}
 * @throws {AiError}
 */
export async function organize(text, categories) {
  const data = await call({ action: 'organize', text, categories });
  if (typeof data?.title !== 'string' || typeof data?.category !== 'string') throw new AiError('failed');
  return { title: data.title, category: data.category };
}

/**
 * @param {unknown} body
 * @returns {Promise<any>} svaret från serverfunktionen
 * @throws {AiError}
 */
async function call(body) {
  if (!navigator.onLine) throw new AiError('offline');

  /** @type {Response} */
  let res;
  try {
    res = await request('/functions/v1/ai', { body, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    // fetch kastar TypeError när nätet inte går att nå. Allt annat (t.ex. timeout) är ett vanligt fel.
    throw new AiError(err instanceof TypeError ? 'offline' : 'failed');
  }
  if (res.status === 429) throw new AiError('limit');
  if (res.status === 413) throw new AiError('too_long');
  if (!res.ok) throw new AiError('failed');

  return res.json().catch(() => null);
}
