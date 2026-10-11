# Anteckningsappen – arkitektur

*Levande dokument – hur koden är uppbyggd och varför. Senast ändrad: 2026-10-11*

## Grundregler
1. **Vanilla JS med ES-moduler, inget byggsteg.** Filerna i repot är exakt det GitHub Pages serverar.
2. **Local-first.** IndexedDB på enheten är sanningen. Molnet är en kopia.
3. **Dataflödet går bara åt ett håll:** UI → store → sync → Supabase. UI:t anropar aldrig Supabase direkt.
4. **AI skriver aldrig över.** Varje AI-resultat är en ny version.
5. **Inga beroenden utan anledning.** Hittills finns inga alls: Supabase anropas med `fetch`.

## Filstruktur
```
index.html
app.css
manifest.webmanifest
sw.js                     – service worker, cachar appens filer
js/
  main.js                 – start + växla mellan lista och editor
  store.js                – IndexedDB, ENDA stället som läser/skriver anteckningar
  supabase.js             – projektets adress + anon-nyckel, konto (anonymt eller mejl), anrop med dess JWT
  sync.js                 – Supabase-synk i bakgrunden
  ai.js                   – anrop till serverfunktionen
  lock.js                 – lås för privata anteckningar
  ui/editor.js
  ui/list.js
  ui/signin.js            – inloggning via mejl, för synk
tests/
  store.test.js
  ai.test.js              – serverfunktionens logik, med låtsasversioner av Supabase och Anthropic
  sync.test.js
supabase/
  functions/ai/index.ts   – AI-anropen, API-nyckeln bor här
  migrations/001_ai_usage.sql – räknare för gränsen på AI-anrop
  migrations/002_notes.sql
```
Varje fil gör en sak. Krånglar något vet du var du ska leta.

## Datamodell
```js
/**
 * @typedef {Object} Version
 * @property {string} text
 * @property {'user'|'spellcheck'|'rewrite'|'summary'} source
 * @property {number} at          // ms sedan 1970
 *
 * @typedef {Object} Note
 * @property {string} id          // crypto.randomUUID(), skapas lokalt
 * @property {Version[]} versions // äldst först, bara tillägg
 * @property {string} title
 * @property {string} category
 * @property {boolean} private
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {boolean} deleted    // soft delete, krävs för synk
 * @property {number} [titledAt]  // när texten som rubriken gjordes för skrevs, saknas = aldrig
 */
```
- Det du skriver uppdaterar senaste `user`-versionen. AI lägger till en ny version.
- "Original" = texten precis före senaste AI-versionen läggs till som en ny `user`-version. Inget tas någonsin bort.
- Listan sorteras efter när *texten* senast ändrades (senaste versionens `at`), inte `updatedAt`. Då kan rubrik, kategori m.m. ändras utan att anteckningen hoppar i listan.
- Rubrik görs när `titledAt` är äldre än senaste textändringen. Korta enradare får ingen AI-rubrik, där visas första raden.
- Paren original → rättad finns automatiskt för en eventuell egen modell senare.

## Supabase-tabell
Hela definitionen står i `supabase/migrations/002_notes.sql`. Kolumnerna motsvarar datamodellen ovan, plus:
- `user_id` – ägaren, sätts av servern.
- `server_updated_at` – serverns klocka, sätts av en trigger vid varje ändring. Appen hämtar "allt som ändrats sedan sist" utifrån den, inte utifrån enhetens `updated_at`. Annars missas ändringar som gjordes offline för länge sedan.

Två policies: var och en kommer bara åt sina egna rader, och anonyma konton kommer inte åt tabellen alls (restriktiv policy på `is_anonymous`).

## Synk
- **Last-write-wins per anteckning** utifrån `updatedAt`. En användare = riktiga konflikter är extremt sällsynta. Vinnaren tas hel; versioner från två enheter blandas aldrig.
- LWW avgörs på två ställen: `merge` i `sync.js` när rader hämtas, och en trigger i databasen som behåller sin rad när den som skickas inte är nyare.
- Körs vid start, efter ändringar (2 s debounce), när nätet kommer tillbaka (`online`), när appen visas igen och var 30:e sekund medan den är öppen.
- Raderingar synkas som `deleted: true`, aldrig som borttagna rader.
- Merge-logiken är en ren funktion `(lokal, fjärr) => vinnare` så den går att testa.
- `store.js` håller en lista (`dirty`) över anteckningar med ändringar som inte har skickats. Det som hämtas från molnet hamnar inte där.
- Synk sker bara när enheten är inloggad med mejl. Inloggning: länk via mejl (`/auth/v1/otp`), samma flöde på alla enheter. Länken leder till appens adress med sessionen efter `#`, där `signInFromUrl` tar emot den. Den installerade appen delar lagring med webbläsaren och märker inloggningen via `storage`-händelsen. Kod i mejlet stöds också (`/auth/v1/verify`), men kräver egen SMTP-tjänst för att mallen ska gå att ändra. Vid inloggning skickas allt som finns lokalt upp. Det anonyma kontot kopplas alltså inte om; det har inga anteckningar på servern att ta med.
- Ändras en öppen anteckning från en annan enhet laddas den om i editorn, men bara om inget osparat står där.
- Fortfarande ingen Supabase-klient: synken är några `fetch`-anrop mot PostgREST.

## AI
- **En Supabase Edge Function** `ai` med `action`: `spellcheck`, `rewrite`, `summarize`, `title`, `categorize`.
- Promptarna bor på servern, så de kan justeras utan att appen deployas om.
- Kräver den anonyma användarens JWT + enkel gräns för antal anrop (per användare och totalt per dygn, tabellen `ai_usage`).
- Leverantör: Anthropic, via vanliga `fetch` utan SDK. Liten modell (`claude-haiku-5-5`) för `spellcheck`, `title`, `categorize`. Större (`claude-sonnet-5-5`) för `rewrite`, `summarize`.
- Appen pratar med Supabase via `fetch` i `js/supabase.js`, utan Supabase-klienten.
- Är `SUPABASE_URL` tom i `js/supabase.js` visas inga AI-funktioner och inget anropas.
- Markerad text: bara markeringen skickas och byts ut. Annars hela anteckningen.
- `categorize` får listan över befintliga kategorier och väljer bland dem i första hand.
- Rubrik och kategori körs när man lämnar anteckningen, inte medan man skriver.

## Kända buggfällor och hur de undviks
| Fälla | Lösning |
|---|---|
| `contenteditable` strular på mobil | Vanlig `<textarea>` |
| Text försvinner när appen stängs på mobil | Spara vid `visibilitychange`, lita inte på `beforeunload` |
| Gammal kod ligger kvar i cachen | Versionsnummer i cache-namnet i `sw.js`, bumpa vid varje deploy |
| Supabase-klienten gör uppstarten seg | Ladda den efter att editorn visats |
| Tomma anteckningar fyller listan | Spara inte förrän det finns text |
| AI-fel förstör text | AI lägger bara till versioner, rör aldrig befintliga |

## Testning
- `node --test` (inbyggt, inget att installera).
- Testa `store.js` och merge-logiken i `sync.js`. UI testas för hand.

## Storleksbudget
- Egen kod: runt 20–30 kB.
- Typsnitt: 0 kB (systemtypsnitt).
- Supabase-klienten blir den största delen, och laddas efter första visningen.
