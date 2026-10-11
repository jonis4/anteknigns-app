# Anteckningar

Minimal anteckningsapp som PWA. Vanilla JS, inget byggsteg – filerna i repot är exakt det som serveras.

Planering finns i [docs/](docs/): [kravspec](docs/kravspec.md), [arkitektur](docs/arkitektur.md) och [plan](docs/plan.md).

## Köra lokalt

Service workers kräver `http://localhost` eller https, så öppna inte `index.html` direkt från disk. Starta en statisk server i repots rot:

```
python -m http.server 8000
```

(`python3` på Mac/Linux.) Öppna sedan <http://localhost:8000/>.

Ser du gammal kod efter en ändring? Service workern serverar från cachen. Bumpa `CACHE` i `sw.js`, eller kryssa i *Application → Service workers → Update on reload* i DevTools medan du utvecklar.

## Deploya till GitHub Pages

1. Bumpa versionen i `sw.js` (`notes-v1` → `notes-v2` …). Annars ligger den gamla koden kvar hos den som redan har appen installerad.
2. Commit och push till `main`.

Första gången: slå på Pages under **Settings → Pages → Deploy from a branch → `main` / `(root)`**. Appen hamnar på `https://<användare>.github.io/<reponamn>/`.

Alla sökvägar i appen är relativa, så den fungerar oavsett reponamn.

## Tester

```
node --test
```

## AI-funktionerna (Supabase)

Utan de här stegen fungerar appen som vanligt, men utan AI-knappen.

1. **Skapa ett projekt** på supabase.com i en EU-region.
2. **Slå på anonyma inloggningar:** Authentication → Sign In / Providers → *Allow anonymous sign-ins*.
3. **Skapa räknaren:** SQL Editor → klistra in [supabase/migrations/001_ai_usage.sql](supabase/migrations/001_ai_usage.sql) → Run.
4. **Lägg in API-nyckeln:** Edge Functions → Secrets → ny hemlighet `ANTHROPIC_API_KEY`. Nyckeln ska bara finnas här, aldrig i repot.
5. **Lägg upp funktionen:** Edge Functions → Deploy a new function → Via Editor. Döp den till `ai`, klistra in [supabase/functions/ai/index.ts](supabase/functions/ai/index.ts) och stäng av *Verify JWT with legacy secret* (funktionen kontrollerar JWT:n själv).
6. **Koppla appen:** fyll i `SUPABASE_URL` och `SUPABASE_ANON_KEY` i [js/supabase.js](js/supabase.js). Värdena finns under Project Settings → API. Båda är publika och får ligga i repot. `service_role`-nyckeln får aldrig hamna här.
7. Bumpa versionen i `sw.js`, commit och push.

Promptar, modeller och gränser står överst i `index.ts`. Ändras de räcker det att lägga upp funktionen igen; appen behöver inte deployas om.
