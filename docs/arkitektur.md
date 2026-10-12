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
  ui/pin.js               – välj och skriv PIN-kod
  ui/motion.js            – all rörelse går härigenom (View Transitions) + haptik
tests/
  store.test.js
  ai.test.js              – serverfunktionens logik, med låtsasversioner av Supabase och Anthropic
  lock.test.js
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
- **En Supabase Edge Function** `ai` med `action`: `spellcheck`, `rewrite`, `summarize`, `organize` (rubrik + kategori i ett anrop). `title` finns kvar för äldre versioner av appen.
- Promptarna bor på servern, så de kan justeras utan att appen deployas om.
- Kräver den anonyma användarens JWT + enkel gräns för antal anrop (per användare och totalt per dygn, tabellen `ai_usage`).
- Leverantör: Anthropic, via vanliga `fetch` utan SDK. Liten modell (`claude-haiku-5-5`) för `spellcheck`, `organize`. Större (`claude-sonnet-5-5`) för `rewrite`, `summarize`.
- Appen pratar med Supabase via `fetch` i `js/supabase.js`, utan Supabase-klienten.
- Är `SUPABASE_URL` tom i `js/supabase.js` visas inga AI-funktioner och inget anropas.
- Markerad text: bara markeringen skickas och byts ut. Annars hela anteckningen.
- `organize` får listan över befintliga kategorier och väljer bland dem i första hand.
- AI:s kategori gäller bara när anteckningen saknar kategori. Den flyttas aldrig i efterhand, och ett eget val står alltid kvar. Rubriken görs däremot om när texten ändras.
- Rubrik och kategori körs när man lämnar anteckningen, inte medan man skriver.

## Privat och lås
- Privat är ett aktivt val per anteckning (långtryck eller högerklick i listan). Flaggan `private` synkas som allt annat.
- Privata anteckningar visas inte i listan och går inte att öppna, inte heller via bakåtknappen, förrän låset är öppet.
- Låset är stängt vid start och stängs så fort appen lämnas (`visibilitychange`).
- PIN-koden sparas bara på enheten, som saltat PBKDF2-hashvärde i `localStorage`. Varje enhet har alltså sin egen PIN-kod.
- Glömd kod: "Glömt koden?" skickar en inloggningslänk till kontot som koden är knuten till. När länken öppnas på enheten tas koden bort och en ny får väljas. Kontot knyts till koden när den väljs eller används, aldrig i efterhand av någon som inte kan den, så det hjälper inte att logga in med en annan mejl. Går bara på en enhet som är inloggad via Synka.
- Följden är att den som har både enheten och tillgång till mejlen på den kan återställa koden.
- Det är ett insynsskydd, inte kryptering: texten ligger i klartext i IndexedDB och i Supabase, precis som kravspecen säger.

## Utseende och rörelse
- **Designtokens** står överst i `app.css`: färger, avstånd, textstorlekar och rörelse (`--ease`, `--dur`, `--dur-view`, `--dur-morph`). Nya regler använder dem i stället för egna värden.
- **Accentfärgen** (`--accent`, en dämpad terrakotta) används bara på markören, AI-knappen och fältet där man väljer kategori.
- **All rörelse går via `animate()` i `ui/motion.js`**, som använder View Transitions. Vilken sorts ändring det är står i `data-motion` på `<html>`, och animationerna står under "Rörelse" i `app.css`:
  - `forward` / `back` – byte av vy. Det nya kommer in från höger på väg in i appen, från vänster på väg ut.
  - `list` – rader som läggs till, tas bort eller flyttas. Varje rad har ett eget namn (`--row`) så att webbläsaren kan följa den.
  - `morph` – AI ändrar texten, eller Original lägger tillbaka den. Den gamla texten löses upp i oskärpa medan den nya framkallas, så det som är lika står still. Det är appens mest genomarbetade rörelse (se "Känsla" i kravspec.md). Medan AI arbetar andas texten långsamt, och Original-knappen glider in som kvitto.
- Utan stöd för View Transitions, eller med `prefers-reduced-motion`, görs ändringen direkt. Inget i appen är beroende av att en animation körs.
- Tom anteckning visar dagens datum som `placeholder`. Det försvinner vid första tecknet och sparas aldrig.

## Uppstart
- **Mål: editorn är klar att skriva i inom 200 ms** vid varm start (appen cachad av service workern).
- Mätt 2026-10-11 i Edge på datorn, mobilstor yta: median 91 ms till `app-ready`, 96 ms till första bild, över sju starter. På mobilen är det inte mätt.
- Mät själv: öppna appen, och kör `performance.getEntriesByName('app-ready')[0].startTime` i DevTools-konsolen.
- Det som håller tiden nere: editorn står direkt i HTML:en med `autofocus`, modulerna hämtas parallellt (`modulepreload`), och synk och rubriker startar först efter att editorn visats.

## Kända buggfällor och hur de undviks
| Fälla | Lösning |
|---|---|
| `contenteditable` strular på mobil | Vanlig `<textarea>` |
| Text försvinner när appen stängs på mobil | Spara vid `visibilitychange`, lita inte på `beforeunload` |
| Gammal kod ligger kvar i cachen | Versionsnummer i cache-namnet i `sw.js`, bumpa vid varje deploy |
| Supabase-klienten gör uppstarten seg | Ladda den efter att editorn visats |
| Tomma anteckningar fyller listan | Spara inte förrän det finns text |
| AI-fel förstör text | AI lägger bara till versioner, rör aldrig befintliga |
| En AI-rubrik skriver över text som ändrats offline på en annan enhet | Rubrik och AI-kategori flyttar `updatedAt` ett enda steg, inte till nu, så en verklig textändring är alltid nyare |

## Testning
- `node --test` (inbyggt, inget att installera).
- Testa `store.js` och merge-logiken i `sync.js`. UI testas för hand.

## Storleksbudget
- Egen kod: 75 kB okomprimerat, 27 kB gzippat (det GitHub Pages skickar). Det ursprungliga målet 20–30 kB gällde innan AI, synk och lås fanns.
- Typsnitt: 0 kB (systemtypsnitt).
- Inga externa bibliotek.
