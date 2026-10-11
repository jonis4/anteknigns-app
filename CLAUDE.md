# Anteckningsappen

Minimal anteckningsapp som PWA, hostad på GitHub Pages. Läs `docs/` innan du ändrar något:

- `docs/kravspec.md` – vad appen ska göra
- `docs/arkitektur.md` – hur koden är uppbyggd (följ den strikt)
- `docs/plan.md` – byggordning i faser

## Arbetssätt
- **Bygg en fas i taget.** Börja aldrig på nästa fas utan att bli ombedd. Bocka av i `docs/plan.md` när något är klart.
- **Lägg inte till något beroende utan att fråga först.** Enda planerade externa biblioteket är Supabase-klienten (pinnad version).

## Grundregler
- Vanilla JS med ES-moduler. Inget byggsteg, inga ramverk, ingen npm för appen. Filerna i repot är exakt det GitHub Pages serverar.
- `// @ts-check` och JSDoc-typer i varje JS-fil.
- Appen ligger under `/<reponamn>/`: bara relativa sökvägar, inga som börjar med `/`.
- Local-first: IndexedDB är sanningen, molnet en kopia. Bara `js/store.js` läser och skriver anteckningar.
- Dataflöde åt ett håll: UI → store → sync → Supabase. UI:t anropar aldrig Supabase direkt.
- AI skriver aldrig över text. Varje AI-resultat är en ny version.
- Systemtypsnitt, mörkt läge via `prefers-color-scheme`, inga inställningar. Extremt minimalt UI (Dieter Rams, Apple) – lägg inte till UI som fasen inte kräver.
- Ny eller omdöpt fil i appen: lägg till den i `FILES` i `sw.js`. Bumpa `CACHE` (`notes-vN`) vid varje deploy.

## Köra och testa
- Lokalt: `python -m http.server 8000` i roten, öppna `http://localhost:8000/`.
- Tester: `node --test` (lagring och synk). UI testas för hand.
