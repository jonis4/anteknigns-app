# Anteckningsappen – projektplan

*Levande dokument – bocka av och justera allt eftersom. Senast ändrad: 2026-10-11*

Hör ihop med:
- **kravspec.md** – *vad* appen ska göra
- **arkitektur.md** – *hur* koden är uppbyggd
- **plan.md** (det här) – *i vilken ordning* det byggs

## Principer för planen

- **En fas i taget.** Varje fas ska sluta med en app du faktiskt kan använda, inte halvfärdiga delar överallt.
- **Använd appen själv mellan faserna.** Det är där du hittar vad som skaver. Skriv ner det under "Saker jag märkt" längst ner.
- **Inget nytt beroende utan anledning.** Vill du lägga till ett bibliotek, skriv varför i arkitektur.md först.
- **Lagring och synk testas, UI testas för hand.** Det är där buggar kostar data.

---

## Fas 0 – Grunden
**Mål:** en tom app som går att installera och som öppnar utan nät.

- [x] Skapa GitHub-repo och slå på GitHub Pages
- [x] `index.html`, `app.css`, `js/main.js` med en tom textarea
- [x] `manifest.webmanifest` + ikon
- [x] `sw.js` som cachar appens filer (versionsnummer i cache-namnet)
- [x] Systemtypsnitt och mörkt läge via `prefers-color-scheme` direkt från start
- [x] `// @ts-check` + JSDoc uppsatt så VS Code kollar typer
- [x] Installera på mobilen ("Lägg till på startskärmen") och på datorn

**Klart när:** appen ligger på startskärmen, öppnar direkt och funkar i flygplansläge.

---

## Fas 1 – Skriva lokalt (första användbara versionen)
**Mål:** en riktig anteckningsapp på en enhet. Ingen AI, inget moln.

- [x] `store.js` – IndexedDB, enda stället som läser/skriver anteckningar
- [x] Datamodell med versioner och soft delete (se arkitektur.md)
- [x] Appen öppnar direkt i ett nytt tomt dokument
- [x] Autospar: debounce ~500 ms + spara vid `visibilitychange`
- [x] Tomma anteckningar sparas inte (annars fylls listan av skräp)
- [x] Lista sorterad efter datum, öppna och ändra gamla anteckningar
- [x] Ta bort anteckning
- [x] Tester för `store.js` med `node --test`

**Klart när:** du har använt appen som din riktiga anteckningsapp i en vecka utan att tappa text.

---

## Fas 2 – AI (kärnidén)
**Mål:** skriv slarvigt, tryck på en knapp, få det rättat – utan att originalet försvinner.

- [x] Supabase-projekt i EU-region
- [x] Driftsätt i Supabase: kör `001_ai_usage.sql`, lägg upp funktionen `ai`, sätt `ANTHROPIC_API_KEY`, fyll i `js/supabase.js` (se README)
- [x] Anonym inloggning i bakgrunden (behövs för att skydda AI-funktionen)
- [x] Edge Function `ai` med `action`-parameter, API-nyckeln bara på servern
- [x] Funktionen kräver JWT + enkel gräns för antal anrop
- [x] **Rättstava** – lägger till en ny version, skriver aldrig över
- [x] Visa original / ångra AI med ett tryck
- [x] Den diskreta AI-knappen + AI-val när man markerar text
- [x] **Automatisk rubrik** när man lämnar anteckningen
- [x] **Renskriv** och **Summera**
- [x] Liten modell för rättstavning, större för renskriv/summera
- [x] Felhantering: inget nät eller fel från AI = texten är orörd, diskret meddelande
- [x] Testa mot riktiga Supabase och riktig modell

**Klart när:** rättstavning funkar på mobilen, och det går alltid att komma tillbaka till exakt det du skrev.

---

## Fas 3 – Synk mellan enheter
**Mål:** skriv på mobilen, läs på datorn.

- [x] Tabell `notes` + Row Level Security (bara ägaren ser sina rader) – SQL skriven i `002_notes.sql`
- [ ] Kör `002_notes.sql` i Supabase och sätt Site URL under URL Configuration (se README)
- [x] `sync.js` – skickar lokala ändringar, hämtar andras, last-write-wins per anteckning
- [x] Synk vid start, efter ändringar och när nätet kommer tillbaka
- [x] Logga in via länk i mejlet (först när du vill synka) – ersätter "koppla det anonyma kontot", se arkitektur.md
- [ ] Logga in med samma mejl på andra enheten
- [x] Tester för merge-logiken
- [ ] Testa: skriv offline på båda enheterna, slå på nätet, inget ska försvinna

**Klart när:** du skriver på mobilen och anteckningen dyker upp på datorn utan att du gör något.

---

## Fas 4 – Organisering
**Mål:** appen håller ordning åt dig.

- [ ] **Tyst kategorisering** – AI väljer bland befintliga kategorier, skapar ny bara om inget passar
- [ ] Kategorin syns i listan, flytta om det blivit fel
- [ ] **Privat** via swipe/långtryck i listan
- [ ] Lås för privata anteckningar (PIN först, biometri om det går smidigt)
- [ ] Privata anteckningar syns aldrig i listan förrän låset är öppnat

**Klart när:** du kan låna ut mobilen utan att privata anteckningar syns, och kategorierna stämmer oftast.

---

## Fas 5 – Finputs
**Mål:** från "funkar" till "känns rätt".

- [ ] Designgenomgång mot Dieter Rams principer – ta bort allt som inte behövs
- [ ] Mät uppstartstid, sätt ett mål och håll det
- [ ] Gester och övergångar – bara där de minskar friktion
- [ ] Gå igenom "Saker jag märkt" och åtgärda

---

## Parkerat (inte nu)
- **Capacitor** – bara om PWA ger för mycket friktion
- **Egen finjusterad lokal modell** – paren original → rättad sparas redan via versionerna
- **Andra användare** – kräver kostnadskontroll per användare innan det öppnas

## Öppna frågor
- PIN eller biometri för privat-låset? (Biometri i PWA via WebAuthn går men är krångligare)
- Vilka modeller exakt, och vad kostar det per månad vid din användning?
- När ska kategoriseringen köras – när man lämnar anteckningen, eller samlat i bakgrunden?

## Saker jag märkt
*(fyll på medan du använder appen)*
