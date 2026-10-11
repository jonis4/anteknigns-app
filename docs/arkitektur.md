# Anteckningsappen – arkitektur

*Levande dokument – hur koden är uppbyggd och varför. Senast ändrad: 2026-10-11*

## Grundregler
1. **Vanilla JS med ES-moduler, inget byggsteg.** Filerna i repot är exakt det GitHub Pages serverar.
2. **Local-first.** IndexedDB på enheten är sanningen. Molnet är en kopia.
3. **Dataflödet går bara åt ett håll:** UI → store → sync → Supabase. UI:t anropar aldrig Supabase direkt.
4. **AI skriver aldrig över.** Varje AI-resultat är en ny version.
5. **Inga beroenden utan anledning.** Enda externa biblioteket: Supabase-klienten (pinnad version).

## Filstruktur
```
index.html
app.css
manifest.webmanifest
sw.js                     – service worker, cachar appens filer
js/
  main.js                 – start + växla mellan lista och editor
  store.js                – IndexedDB, ENDA stället som läser/skriver anteckningar
  sync.js                 – Supabase-synk i bakgrunden
  ai.js                   – anrop till serverfunktionen
  lock.js                 – lås för privata anteckningar
  ui/editor.js
  ui/list.js
tests/
  store.test.js
  sync.test.js
supabase/
  functions/ai/index.ts   – AI-anropen, API-nyckeln bor här
  migrations/001_notes.sql
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
 */
```
- Det du skriver uppdaterar senaste `user`-versionen. AI lägger till en ny version.
- "Ångra AI" = visa föregående version.
- Paren original → rättad finns automatiskt för en eventuell egen modell senare.

## Supabase-tabell (skiss)
```sql
create table notes (
  id          uuid primary key,
  user_id     uuid not null default auth.uid(),
  versions    jsonb not null,
  title       text,
  category    text,
  private     boolean not null default false,
  created_at  bigint not null,
  updated_at  bigint not null,
  deleted     boolean not null default false
);

alter table notes enable row level security;

create policy "egna anteckningar" on notes
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

## Synk
- **Last-write-wins per anteckning** utifrån `updatedAt`. En användare = riktiga konflikter är extremt sällsynta.
- Körs vid start, efter ändringar (debounce) och när nätet kommer tillbaka (`online`-eventet).
- Raderingar synkas som `deleted: true`, aldrig som borttagna rader.
- Merge-logiken är en ren funktion `(lokal, fjärr) => vinnare` så den går att testa.

## AI
- **En Supabase Edge Function** `ai` med `action`: `spellcheck`, `rewrite`, `summarize`, `title`, `categorize`.
- Promptarna bor på servern, så de kan justeras utan att appen deployas om.
- Kräver den anonyma användarens JWT + enkel gräns för antal anrop.
- Liten modell för `spellcheck`, `title`, `categorize`. Större för `rewrite`, `summarize`.
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
