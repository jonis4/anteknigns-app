// @ts-check

// Den tunna kopplingen till Supabase: projektets adress, det anonyma kontot och anrop med dess JWT.
// Båda värdena nedan är publika och får ligga i repot. Hemliga nycklar bor bara på servern.
/** @type {string} */
export const SUPABASE_URL = 'https://viasncmtqznnrwqzvigk.supabase.co';
/** @type {string} */
export const SUPABASE_ANON_KEY = 'sb_publishable_iq9wEhGEqySdqhJfwq7THg_uP7K90Zm';

/** Falskt tills värdena ovan är ifyllda. Då syns inga AI-funktioner och inget anropas. */
export const configured = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

/**
 * @typedef {Object} Session
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {number} expires_at   // sekunder sedan 1970
 */

const SESSION_KEY = 'supabase-session';
/** Förnya när mindre än så här många sekunder återstår. */
const MARGIN = 60;

/** Pågående inloggning eller förnyelse, så att två anrop samtidigt inte gör var sin. @type {Promise<Session> | null} */
let pending = null;

/** @returns {Session | null} */
function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return session && typeof session.access_token === 'string' && typeof session.refresh_token === 'string' ? session : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<Response>}
 */
function authRequest(path, body) {
  return fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Förnyar sessionen. Finns ingen, eller har den blivit ogiltig, skapas ett nytt anonymt konto.
 * Nätverksfel kastas vidare utan att sessionen rörs.
 * @param {Session | null} old
 * @returns {Promise<Session>}
 */
async function renew(old) {
  let res = old ? await authRequest('token?grant_type=refresh_token', { refresh_token: old.refresh_token }) : null;
  if (!res || (res.status >= 400 && res.status < 500 && res.status !== 429)) res = await authRequest('signup', {});
  if (!res.ok) throw new Error(`Supabase Auth svarade ${res.status}`);
  const data = await res.json();
  /** @type {Session} */
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + data.expires_in,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

/**
 * @param {boolean} force förnya även om sessionen inte har gått ut
 * @returns {Promise<string>} JWT för det anonyma kontot
 */
async function accessToken(force) {
  const session = loadSession();
  if (session && !force && session.expires_at - MARGIN > Date.now() / 1000) return session.access_token;
  pending ??= renew(session).finally(() => {
    pending = null;
  });
  return (await pending).access_token;
}

/**
 * POST till Supabase som den inloggade (anonyma) användaren.
 * @param {string} path t.ex. '/functions/v1/ai'
 * @param {unknown} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<Response>}
 */
export async function post(path, body, signal) {
  /** @param {boolean} force */
  const send = async (force) =>
    fetch(`${SUPABASE_URL}${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${await accessToken(force)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
  const res = await send(false);
  // 401 betyder att JWT:n inte gäller längre. Förnya och försök en gång till.
  return res.status === 401 ? send(true) : res;
}
