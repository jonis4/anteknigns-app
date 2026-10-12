# Anteckningsappen – kravspec

*Levande dokument – uppdateras när idéer ändras. Senast ändrad: 2026-10-11*

## Kärnidé
Minimal friktion mellan tanke och anteckning. Man skriver fritt utan att bry sig om stavning eller formulering – AI städar upp i efterhand, när man ber om det.

## Skriva
- Appen öppnar direkt i ett nytt, tomt dokument
- Allt sparas automatiskt – ingen spara-knapp, och ingen "Sparat"-bekräftelse (autospar ska vara osynligt)
- Man kan alltid gå tillbaka och ändra i gamla anteckningar

## AI-funktioner (bara när man ber om det)
- **Rättstava** – sker först när man trycker på knappen, aldrig automatiskt. AI som förstår kontexten och rättar utifrån den
- **Renskriv** – gör om texten till ordentlig prosa
- **Summera** – kortar ner till det viktigaste
- **Automatisk rubrik** på varje anteckning
- AI-funktionerna syns inte hela tiden – de ligger bakom en enda diskret knapp, eller dyker upp när man markerar text
- **AI får aldrig äta texten** – originalet sparas alltid och är ett tryck bort

## Organisering
- Lista över alla anteckningar, sorterad efter datum
- **Tyst kategorisering** – appen sorterar in anteckningen i en kategori utan att fråga. Finns en liknande redan (t.ex. "idéer ljusstake") hamnar den där. Man ser det i listan och flyttar bara om det blivit fel
- **Privat del** – aktivt val, via ett swipe/långtryck i listan. Gör man inget hamnar anteckningen bland allt annat. "Privat" = dold bakom lås (PIN/biometri), så en kompis som lånar mobilen inte ser den. Ingen kryptering krävs

## Design
- Extremt minimal – minimera friktion och brus så mycket som möjligt
- Förebilder: Apples approach till UX/UI, och Dieter Rams mentalitet
- Inga inställningar – följer systemet (mörkt läge enligt OS, systemtypsnitt)
- Snabb uppstart räknas som en del av minimalismen

### Känsla
Minimal ska inte betyda tom. Appen ska kännas lugn och levande, så att man vill öppna den.

- Rörelse används bara där den minskar friktion eller ger känsla, aldrig som dekoration
- Typografin bär designen, med tydlig hierarki även på en nästan tom skärm
- En enda dämpad accentfärg, sparsamt använd
- Den tomma anteckningen ska inbjuda, som att appen väntar på en
- AI-ögonblicket (rättstavning och ångra) är appens kärna och ska ha den mest genomarbetade rörelsen
- Mikrobelöningar i stället för bekräftelser: appen visar att något hänt genom hur den rör sig
- Prestanda går före animation

## Tekniska beslut
- **PWA** – HTML/CSS/JS, hostas på **GitHub Pages**, installeras via "Lägg till på startskärmen". Ingen APK, ingen App Store
- Plan B om PWA ger för mycket friktion: paketera samma webbkod till riktig app med **Capacitor** (ingen omskrivning)
- **Vanilla JS med ES-moduler, inget byggsteg, inga ramverk** – detaljer i arkitektur.md
- **Local-first** – allt sparas först på enheten (IndexedDB) och funkar offline; molnet är en kopia som synkas i bakgrunden
- **Versioner i stället för överskrivning** – varje AI-resultat sparas som en ny version, originalet finns alltid kvar
- Funkar på mobil och dator, synk via molnet (**Supabase**, EU-region)
- **Ingen inloggning** förrän man vill synka mellan enheter (anonymt konto i bakgrunden, kopplas till mejl när man vill synka)
- **AI via API** i en serverfunktion (nyckeln ligger aldrig i appen) – rättning funkar direkt i mobilen
- Liten/billig modell för rättstavning, större vid behov för renskrivning/summering
- Byggs för mig själv

## Ej beslutat
- Byta till en egen finjusterad lokal modell senare (paren originaltext → rättad text sparas redan via versionerna)

## Ändringslogg
- 2026-10-11 – första versionen
- 2026-10-11 – designprinciper tillagda (minimera friktion/brus, Apple + Dieter Rams som förebilder)
- 2026-10-11 – designlösningar tillagda (tyst kategorisering, gömda AI-knappar, originaltext sparas alltid, inget "Sparat", inga inställningar)
- 2026-10-11 – plattform beslutad: PWA på GitHub Pages, Capacitor som plan B
- 2026-10-11 – utvärdering och tangentbordstest borttagna
- 2026-10-11 – kodupplägg beslutat: vanilla JS utan byggsteg, local-first (offline löst), versionsmodell för AI-ändringar. Plan och arkitektur i egna dokument
