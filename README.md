# Protokollwesen – Skop Bauconsulting

Besprechungsprotokolle und Baudokumentation für PC, Mac und iPad, mit Offline-Betrieb und Synchronisation über den eigenen Server (Synology NAS).

## Aufbau

| Teil | Inhalt |
|------|--------|
| `server/` | Node.js-Server: Anmeldung, Synchronisation, Dateiablage, E-Mail-Versand. Daten in einer SQLite-Datenbank. |
| `client/` | Web-App (installierbar auf iPad / PC / Mac). Speichert alle Projekte lokal und arbeitet offline. |
| `shared/` | Gemeinsame Logik: Datenmodell, Nummerierung, Übernahme offener Punkte, PDF-Layout. |

**Daten auf der NAS** (Ordner `/data` im Container):

- `protokollwesen.db`: Datenbank (Projekte, Kontakte, Protokolle, Änderungsverlauf)
- `files/`: Fotos, Logos und versendete PDFs
- `backups/`: tägliche Sicherung der Datenbank (14 Stände)

Den gesamten Ordner bitte zusätzlich in **Hyper Backup** aufnehmen.

## Funktionen (Stand Phase 1)

- Anmeldung mit Benutzern und Rollen (Administrator / Mitarbeiter). Mitarbeiter sehen nur freigegebene Projekte.
- Projekte, Firmen und Kontakte, Projektbeteiligte mit projektbezogenem Gewerk und Verteiler-Vorgabe.
- Protokollarten: Baubesprechung, AG Jour fixe, Planungsbesprechung, Mängelbegehung, BauKG, Aktennotiz, Abnahme/Übergabe. Frei erweiterbar.
- **Fortlaufende Protokolle:** Nach dem Abschließen sind sie gesperrt, auch serverseitig. Freischalten darf nur ein Administrator. Der Stand der Punkte (Status, Fälligkeit …) wird beim Abschluss eingefroren.
- **Standardprotokolle:** jederzeit frei bearbeitbar.
- Punkte werden fortlaufend nummeriert (z. B. `BBP01.011`). Bei der Übernahme in Folgeprotokolle **bleibt die Nummer erhalten**, mit vollständiger Historie („Anm. TT.MM.JJJJ“).
- Gliederung nach Zusatzfeld, Gewerk oder Typ. Felder: Firma, Zuständig, Beobachter, Typ, Gewerk, Zusatzfeld, fällig von/bis, Status, Priorität.
- Formatierter Text (fett, kursiv, Aufzählungen). Nachträgliche Ergänzungen werden kursiv gedruckt.
- Fotos mit Anmerkung je Eintrag. Am iPad werden Fotos automatisch verkleinert.
- PDF im Stil der bisherigen Protokolle; welche Felder gedruckt werden, ist einstellbar.
- Versand per E-Mail an den Verteiler über office@skop-bauconsulting.at. Das versendete PDF wird archiviert.
- Liste der offenen Punkte je Projekt, mit Filter nach Firma und überfälligen Punkten.
- Offline-Betrieb: Alle Änderungen werden lokal gespeichert und bei Verbindung automatisch abgeglichen. Gleichzeitige Änderungen am selben Feld von zwei Geräten werden gemeldet.

## Kostenverfolgung Hochbau (`/kosten/`)

Die Kostenverfolgung (ÖNORM B 1801-1: Budget, Aufträge, Nachträge, Rechnungen, Rechnungsprüfung) läuft im selben Container unter **`https://<Adresse>/kosten/`**. Diese Seite ist die gemeinsame **Startseite**: oben die Kostenverfolgung, darunter im gleichen Aufbau das Protokollwesen (Schnellzugriff und Projektliste mit Protokollen und offenen Punkten). Im Protokollwesen führt ein Klick auf das Logo links oben zurück zur Startseite.

- **Gleiche Anmeldung** wie im Protokollwesen. Wer dort im selben Browser angemeldet ist, muss sich nicht erneut anmelden.
- **Projekte liegen auf der NAS** (Tabelle `kosten` in `protokollwesen.db`, Originalrechnungen unter `data/files/kosten/`). Jede Änderung wird nach wenigen Sekunden übertragen. Andere Geräte übernehmen sie beim nächsten Abgleich (alle 30 s, beim Wechsel ins Fenster oder über die Statusanzeige links unten).
- **Offline** wird im Browser weitergearbeitet. Nicht übertragene Änderungen werden später nachgeholt.
- **Gleichzeitige Änderung** am selben Projekt auf zwei Geräten: Das Programm fragt nach. Zur Wahl stehen „Beide behalten“ (eigener Stand als Kopie), „Stand vom Server übernehmen“ (eigener Stand wird vorher als .json heruntergeladen) und „Meinen Stand übertragen“.
- Am Server bleiben die **letzten fünf Stände** jedes Projekts erhalten (Statusanzeige → Frühere Stände → Als Kopie öffnen).
- **Zugriff:** Administratoren sehen alle Projekte. Mitarbeiter sehen ihre eigenen und die für sie freigegebenen (Statusanzeige → Freigabe).
- Bereits vorhandene Projekte aus der bisherigen Einzeldatei: Diese im Browser über „Projekt laden (.json)“ öffnen. Sie werden danach automatisch auf die NAS übertragen. Das Beispielprojekt bleibt nur im Browser.

**Neue Version der Kostenverfolgung einspielen:** `kosten/Kostenverfolgung.html` durch die neue Datei ersetzen und auf `main` hochladen. Das Abgleich-Skript `kosten/kosten-sync.js` wird beim Bauen automatisch eingebunden, die HTML-Datei selbst muss dafür nicht angepasst werden. Voraussetzung ist, dass die globalen Funktionen `boot`, `loadStore`, `persist`, `normalizeProject` und die Objekte `STORE`, `P`, `START`, `PRJ`, `RPS`, `UI` und `IO` erhalten bleiben.

## Installation auf der Synology DS216+II

**Schritt-für-Schritt-Anleitung: [docs/INSTALLATION_NAS.md](docs/INSTALLATION_NAS.md)** – das Programm wird fertig von GitHub geladen (ghcr.io), nicht auf der NAS gebaut.

Kurzfassung:

Voraussetzung: DSM 7.2 mit **Container Manager** (Paketzentrum).

1. In File Station den Ordner `docker/protokollwesen` anlegen und den Inhalt dieses Repositorys dorthin kopieren (oder per Git holen).
2. In `docker-compose.yml` `ADMIN_EMAIL`, `ADMIN_NAME` und ein Startpasswort eintragen.
3. Container Manager → **Projekt** → Erstellen → Pfad `docker/protokollwesen` → „Vorhandene docker-compose.yml verwenden“ → Erstellen. Der erste Build dauert auf der DS216+II einige Minuten.
4. Die App ist danach unter `http://<NAS-IP>:8080` erreichbar.

### HTTPS (nötig für iPad-Offline-Betrieb)

iPad und Browser erlauben den Offline-Betrieb nur über **HTTPS**:

1. Systemsteuerung → Externer Zugriff → DDNS, oder eine eigene Subdomain wie `protokoll.skop-bauconsulting.at`, die auf die NAS zeigt.
2. Systemsteuerung → Sicherheit → Zertifikat → **Let's Encrypt**-Zertifikat für diese Adresse anlegen.
3. Systemsteuerung → Anmeldeportal → Erweitert → **Reverse Proxy**: `https://protokoll.…:443` → `http://localhost:8080`.
4. Am iPad die Adresse in Safari öffnen → Teilen → **Zum Home-Bildschirm**. Danach startet die App wie ein Programm und funktioniert auch offline.

Der Zugriff von außen kann auf das VPN beschränkt bleiben, wenn die Adresse im VPN auf die NAS zeigt.

### Updates

Neuen Stand in den Ordner kopieren, dann Container Manager → Projekt → **Erstellen** (neu bauen). Datenbank-Umstellungen laufen beim Start automatisch. Bestehende Projekte bleiben unverändert nutzbar.

## Entwicklung

```bash
npm install
npm run dev:server   # Server auf :8080 (DATA_DIR=./data)
npm run dev:client   # Web-App auf :5173 mit Proxy zum Server
npm run typecheck
npm run build
```

### Grundsätze für Erweiterungen

- Datenbank-Umstellungen nur **anhängen** (`server/src/db.ts`, `MIGRATIONS`), niemals bestehende ändern.
- Neue Felder in `shared/src/model.ts` ergänzen und einen Standardwert in `normalize()` (`shared/src/defaults.ts`) setzen. Alte Datensätze bleiben so lesbar.
- Die Synchronisation arbeitet feldweise und kennt keine festen Spalten. Neue Felder brauchen keine Server-Änderung.

## Fahrplan

- **Phase 2:** Skizzen und Markierungen direkt im Foto, Import aus Baumaster-PDFs (Kontakte, offene Punkte), Einladung zur nächsten Besprechung per Mail.
- **Phase 3:** Bautagebuch, Mängelmanagement mit Verortung im Plan, Planverwaltung.
- **Phase 4:** Mehr- und Minderkosten, Bauzeitplan, Fotos mit GPS.
