// @ts-check

// Den tunna kopplingen till Supabase: projektets adress, kontot och anrop med dess JWT.
// Båda värdena nedan är publika och får ligga i repot. Hemliga nycklar bor bara på servern.
/** @type {string} */
export const SUPABASE_URL = 'https://viasncmtqznnrwqzvigk.supabase.co';
/** @type {string} */
export const SUPABASE_ANON_KEY = 'sb_publishable_iq9wEhGEqySdqhJfwq7THg_uP7K90Zm';

/** Falskt tills värdena ovan är ifyllda. Då syns varken AI eller synk och inget anropas. */
export const configured = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

/**
 * @typedef {Object} Session
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {number} expires_at   // sekunder sedan 1970
 * @property {string} [email]      // saknas för det anonyma kontot
 */

/** @typedef {'offline' | 'wait' | 'wrong_code' | 'failed'} AuthErrorCode */

export class AuthError extends Error {
  /** @param {AuthErrorCode} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

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
 * Läser mejladressen ur en JWT. Undefined för det anonyma kontot, eller om JWT:n inte går att läsa.
 * @param {string} jwt
 * @returns {string | undefined}
 */
export function emailOf(jwt) {
  try {
    const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))));
    return !claims.is_anonymous && typeof claims.email === 'string' && claims.email !== '' ? claims.email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sparar sessionen ur ett svar från Supabase Auth, eller ur inloggningslänkens adress.
 * @param {{ access_token: string, refresh_token: string, expires_at?: number, expires_in?: number }} data
 * @returns {Session}
 */
function saveSession(data) {
  /** @type {Session} */
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Number(data.expires_at) || Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600),
  };
  const email = emailOf(data.access_token);
  if (email) session.email = email;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
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
  return saveSession(await res.json());
}

/**
 * @param {boolean} force förnya även om sessionen inte har gått ut
 * @returns {Promise<string>} JWT för kontot
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
 * Anrop till Supabase som den inloggade användaren (anonym eller med mejl).
 * @param {string} path t.ex. '/functions/v1/ai'
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string>, signal?: AbortSignal }} [options]
 * @returns {Promise<Response>}
 */
export async function request(path, { method = 'POST', body, headers = {}, signal } = {}) {
  /** @param {boolean} force */
  const send = async (force) =>
    fetch(`${SUPABASE_URL}${path}`, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${await accessToken(force)}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  const res = await send(false);
  // 401 betyder att JWT:n inte gäller längre. Förnya och försök en gång till.
  return res.status === 401 ? send(true) : res;
}

/** @returns {string | undefined} mejladressen enheten är inloggad med */
export function signedInEmail() {
  return configured ? loadSession()?.email : undefined;
}

/** @returns {boolean} sant när enheten är inloggad med mejl, alltså när anteckningarna ska synkas */
export function signedIn() {
  return signedInEmail() !== undefined;
}

/**
 * Tar emot inloggningen när appen öppnas via länken i mejlet. Supabase lägger då sessionen
 * efter # i adressen. Den plockas bort därifrån direkt, så att den inte ligger kvar i historiken.
 * @returns {boolean} sant om enheten loggades in
 */
export function signInFromUrl() {
  const params = new URLSearchParams(location.hash.slice(1));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token && !params.has('error')) return false;
  history.replaceState(history.state, '', location.pathname + location.search);
  if (!access_token || !refresh_token || !emailOf(access_token)) return false;
  saveSession({ access_token, refresh_token, expires_at: Number(params.get('expires_at')), expires_in: Number(params.get('expires_in')) });
  return true;
}

/**
 * Länken i mejlet öppnas ofta i ett annat fönster än appen. Båda delar lagring,
 * så appen märker inloggningen här.
 * @param {() => void} listener
 */
export function onSignedInElsewhere(listener) {
  addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY && signedIn()) listener();
  });
}

/**
 * @param {string} path
 * @param {unknown} body
 * @param {AuthErrorCode} rejected felet när Supabase säger nej
 * @returns {Promise<any>}
 */
async function authCall(path, body, rejected) {
  /** @type {Response} */
  let res;
  try {
    res = await authRequest(path, body);
  } catch {
    throw new AuthError('offline');
  }
  if (res.status === 429) throw new AuthError('wait');
  if (!res.ok) throw new AuthError(res.status < 500 ? rejected : 'failed');
  return res.json().catch(() => ({}));
}

/**
 * Skickar ett inloggningsmejl till adressen. Finns inget konto för adressen skapas ett.
 * Länken i mejlet leder tillbaka till appen (se signInFromUrl).
 * @param {string} email
 * @returns {Promise<void>}
 * @throws {AuthError}
 */
export async function requestCode(email) {
  const app = encodeURIComponent(location.origin + location.pathname);
  await authCall(`otp?redirect_to=${app}`, { email, create_user: true }, 'failed');
}

/**
 * Loggar in med koden från mejlet, om mejlet innehåller en. Efteråt gäller signedIn().
 * @param {string} email
 * @param {string} code
 * @returns {Promise<void>}
 * @throws {AuthError}
 */
export async function verifyCode(email, code) {
  const data = await authCall('verify', { type: 'email', email, token: code }, 'wrong_code');
  if (typeof data.access_token !== 'string') throw new AuthError('failed');
  saveSession(data);
}
