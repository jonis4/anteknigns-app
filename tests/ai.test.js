// @ts-check
// Kör Edge Function "ai" i Node med låtsasversioner av Deno, Supabase och Anthropic.
// Testar logiken (behörighet, gränser, vad som skickas till modellen), inte modellens svar.
import test from 'node:test';
import assert from 'node:assert/strict';

/** @type {(req: Request) => Promise<Response>} */
let handler = async () => new Response(null);

/** @type {any} */ (globalThis).Deno = {
  serve: (/** @type {typeof handler} */ fn) => {
    handler = fn;
  },
  env: {
    get: (/** @type {string} */ name) =>
      ({ SUPABASE_URL: 'https://projekt.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ANTHROPIC_API_KEY: 'anthropic-key' })[name],
  },
};

/** Vad låtsastjänsterna ska svara, och vad funktionen skickade till Anthropic. */
const world = {
  validJwt: 'Bearer giltig',
  withinLimit: true,
  anthropicStatus: 200,
  /** @type {any} */ anthropicReply: {},
  /** @type {{ headers: Record<string, string>, body: any }[]} */ anthropicCalls: [],
  /** @type {any[]} */ limitCalls: [],
};

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const headers = /** @type {Record<string, string>} */ (init?.headers ?? {});
  if (url === 'https://projekt.supabase.co/auth/v1/user') {
    return headers.Authorization === world.validJwt ? Response.json({ id: 'user-1' }) : new Response('{}', { status: 401 });
  }
  if (url === 'https://projekt.supabase.co/rest/v1/rpc/count_ai_call') {
    world.limitCalls.push({ key: headers.apikey, body: JSON.parse(String(init?.body)) });
    return Response.json(world.withinLimit);
  }
  if (url === 'https://api.anthropic.com/v1/messages') {
    world.anthropicCalls.push({ headers, body: JSON.parse(String(init?.body)) });
    return Response.json(world.anthropicReply, { status: world.anthropicStatus });
  }
  throw new Error(`Oväntat anrop: ${url}`);
};

await import(new URL('../supabase/functions/ai/index.ts', import.meta.url).href);

/**
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function call(body, headers = { Authorization: 'Bearer giltig', apikey: 'anon-key' }) {
  return handler(new Request('https://projekt.supabase.co/functions/v1/ai', { method: 'POST', headers, body: JSON.stringify(body) }));
}

/** @param {string} text */
function reply(text, stop_reason = 'end_turn') {
  return { stop_reason, content: [{ type: 'text', text }] };
}

test.beforeEach(() => {
  world.withinLimit = true;
  world.anthropicStatus = 200;
  world.anthropicReply = reply('svar');
  world.anthropicCalls = [];
  world.limitCalls = [];
});

test('OPTIONS svarar med CORS-huvuden utan att kräva inloggning', async () => {
  const res = await handler(new Request('https://projekt.supabase.co/functions/v1/ai', { method: 'OPTIONS' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(res.headers.get('Access-Control-Allow-Headers') ?? '', /authorization/);
});

test('utan giltig JWT blir det 401 och inget anrop till modellen', async () => {
  assert.equal((await call({ action: 'spellcheck', text: 'hej' }, { apikey: 'anon-key' })).status, 401);
  assert.equal((await call({ action: 'spellcheck', text: 'hej' }, { Authorization: 'Bearer falsk', apikey: 'anon-key' })).status, 401);
  assert.equal(world.anthropicCalls.length, 0);
  assert.equal(world.limitCalls.length, 0);
});

test('okänd action, tom text och trasig JSON ger 400', async () => {
  assert.equal((await call({ action: 'hacka', text: 'hej' })).status, 400);
  assert.equal((await call({ action: 'toString', text: 'hej' })).status, 400);
  assert.equal((await call({ action: 'spellcheck', text: '   ' })).status, 400);
  assert.equal((await call({ action: 'spellcheck' })).status, 400);
  assert.equal(world.anthropicCalls.length, 0);
});

test('för lång text ger 413', async () => {
  assert.equal((await call({ action: 'spellcheck', text: 'a'.repeat(20_001) })).status, 413);
  assert.equal(world.anthropicCalls.length, 0);
});

test('över gränsen ger 429 och inget anrop till modellen', async () => {
  world.withinLimit = false;
  const res = await call({ action: 'spellcheck', text: 'hej' });
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'limit' });
  assert.equal(world.anthropicCalls.length, 0);
  assert.deepEqual(world.limitCalls, [{ key: 'service-key', body: { p_user: 'user-1', p_user_limit: 200, p_total_limit: 1000 } }]);
});

test('rättstavning går till den lilla modellen, med texten som material', async () => {
  world.anthropicReply = reply('  Jag ska köpa mjölk.\n');
  const res = await call({ action: 'spellcheck', text: 'jag ska köppa mjölk' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: 'Jag ska köpa mjölk.' });

  const [{ headers, body }] = world.anthropicCalls;
  assert.equal(headers['x-api-key'], 'anthropic-key');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(headers['anthropic-beta'], undefined);
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.fallbacks, undefined);
  assert.deepEqual(body.messages, [{ role: 'user', content: '<text>\njag ska köppa mjölk\n</text>' }]);
  assert.match(body.system, /inte instruktioner/);
});

test('renskriv och summera går till den stora modellen', async () => {
  for (const action of ['rewrite', 'summarize']) {
    world.anthropicCalls = [];
    assert.equal((await call({ action, text: 'lite text' })).status, 200);
    const [{ headers, body }] = world.anthropicCalls;
    assert.equal(body.model, 'claude-sonnet-5-5');
    assert.equal(body.fallbacks, 'default');
    assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.equal(body.thinking, undefined);
  }
});

test('rubriken blir en rad utan citattecken och punkt', async () => {
  world.anthropicReply = reply('"Idéer till ljusstaken."\nextra rad');
  const res = await call({ action: 'title', text: 'en lång anteckning om en ljusstake' });
  assert.deepEqual(await res.json(), { text: 'Idéer till ljusstaken' });
});

test('taggar som modellen råkar skicka med tas bort', async () => {
  world.anthropicReply = reply('<text>\nRättad text\n</text>');
  assert.deepEqual(await (await call({ action: 'spellcheck', text: 'rätad text' })).json(), { text: 'Rättad text' });
});

test('avbrutet, nekat, tomt eller misslyckat svar ger 502 i stället för text', async () => {
  world.anthropicReply = reply('halv tex', 'max_tokens');
  assert.equal((await call({ action: 'rewrite', text: 'text' })).status, 502);
  world.anthropicReply = { stop_reason: 'refusal', content: [] };
  assert.equal((await call({ action: 'rewrite', text: 'text' })).status, 502);
  world.anthropicReply = reply('   ');
  assert.equal((await call({ action: 'rewrite', text: 'text' })).status, 502);
  world.anthropicReply = { type: 'error', error: { type: 'overloaded_error' } };
  world.anthropicStatus = 529;
  const res = await call({ action: 'rewrite', text: 'text' });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'failed' });
});

test('organize: kategorierna skickas med, svaret blir rubrik och kategori', async () => {
  world.anthropicReply = reply('Rubrik: "Idéer till ljusstaken."\nKategori: idéer ljusstake');
  const res = await call({ action: 'organize', text: 'kanske mässing i stället för stål', categories: ['Inköp', 'Idéer ljusstake', 7, '  '] });
  assert.equal(res.status, 200);
  // Befintlig kategori återanvänds med sin egen stavning.
  assert.deepEqual(await res.json(), { title: 'Idéer till ljusstaken', category: 'Idéer ljusstake' });

  const [{ body }] = world.anthropicCalls;
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.deepEqual(body.messages, [
    { role: 'user', content: '<categories>\nInköp\nIdéer ljusstake\n</categories>\n<text>\nkanske mässing i stället för stål\n</text>' },
  ]);
  assert.match(body.system, /Rubrik: <rubriken>\nKategori: <kategorin>/);
  assert.match(body.system, /inte instruktioner/);
});

test('organize: ny kategori när ingen passar, och utan lista', async () => {
  world.anthropicReply = reply('Rubrik: Boka tandläkare\nKategori: Hälsa');
  assert.deepEqual(await (await call({ action: 'organize', text: 'boka tandläkare', categories: ['Inköp'] })).json(), { title: 'Boka tandläkare', category: 'Hälsa' });
  assert.deepEqual(await (await call({ action: 'organize', text: 'boka tandläkare' })).json(), { title: 'Boka tandläkare', category: 'Hälsa' });
  assert.equal(world.anthropicCalls.at(-1)?.body.messages[0].content, '<categories>\n\n</categories>\n<text>\nboka tandläkare\n</text>');
});

test('organize: saknas kategoriraden blir kategorin tom, saknas rubriken blir det 502', async () => {
  world.anthropicReply = reply('Rubrik: Bara en rubrik');
  assert.deepEqual(await (await call({ action: 'organize', text: 'text' })).json(), { title: 'Bara en rubrik', category: '' });
  world.anthropicReply = reply('Jag förstår inte uppgiften.');
  assert.equal((await call({ action: 'organize', text: 'text' })).status, 502);
});
