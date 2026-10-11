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
