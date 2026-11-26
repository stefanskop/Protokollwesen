# Installation auf der Synology DS216+II

Dauer ca. 30 Minuten. Das Programm wird fertig von GitHub geladen, auf der NAS wird nichts gebaut.

---

## Schritt 1 – Voraussetzungen

1. **DSM 7.2.2** installieren (Systemsteuerung → Update & Wiederherstellung).
2. **Paketzentrum** → „Container Manager“ suchen → **Installieren**.

> **Container Manager wird nicht angezeigt?**
> - Das DSM-Update auf 7.2.2 muss **vollständig installiert** sein, inkl. Neustart. Unter DSM 7.1 heißt das Paket noch „Docker“.
> - Im Paketzentrum links „**Alle Pakete**“ wählen und oben rechts nach `Container` suchen (unter „Installiert“ wird es nicht gezeigt).
> - Danach Paketzentrum einmal schließen und neu öffnen.

## Schritt 2 – Ordner anlegen

In **File Station**:

1. Im freigegebenen Ordner `docker` (wird vom Container Manager angelegt) einen Ordner **`protokollwesen`** anlegen.
2. Darin einen Ordner **`data`** anlegen.

Ergebnis: `/docker/protokollwesen/data`

## Schritt 3 – Programm einrichten

1. **Container Manager** öffnen → links **Projekt** → **Erstellen**.
2. Projektname: `protokollwesen`
3. Pfad: `/docker/protokollwesen` auswählen
4. Quelle: **„docker-compose.yml erstellen“** wählen und folgenden Text einfügen:

```yaml
services:
  protokollwesen:
    image: ghcr.io/stefanskop/protokollwesen:latest
    pull_policy: always
    container_name: protokollwesen
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    environment:
      - TZ=Europe/Vienna
      - ADMIN_EMAIL=office@skop-bauconsulting.at
      - ADMIN_NAME=Stefan Skop
      - ADMIN_PASSWORD=HIER-STARTPASSWORT-EINTRAGEN
    mem_limit: 384m
```

5. Bei `ADMIN_PASSWORD` ein **vorläufiges** Passwort eintragen (min. 8 Zeichen).
6. **Weiter** → die Seite „Web-Portal“ ohne Änderung überspringen → **Fertig**.

Der Container Manager lädt das Programm und startet es. Unter **Container** muss „protokollwesen“ danach grün laufen.

> `./data` bedeutet: Ordner `data` **im gewählten Projektordner**. Die NAS legt ihn nicht selbst an: Er muss vor dem Start existieren und klein geschrieben sein. Beispiel: Projektordner `/docker/Protokollwesen/Data` → Ordner `/docker/Protokollwesen/Data/data` anlegen. Nach dem ersten Start liegt dort die Datei `protokollwesen.db`.
>
> Fehlermeldung „Bind mount failed … does not exist“: Den in der Meldung genannten Ordner in File Station anlegen und das Projekt erneut starten.

## Schritt 4 – Erster Test im Büro

1. Am PC im Büronetz den Browser öffnen: **`http://<IP-der-NAS>:8080`**. Die IP steht in DSM unter Systemsteuerung → Netzwerk → Netzwerkschnittstelle, z. B. `http://192.168.1.20:8080`.
2. Mit `office@skop-bauconsulting.at` und dem vorläufigen Passwort anmelden.
3. **Einstellungen → Mein Konto** → Passwort ändern.
4. **Einstellungen → E-Mail-Versand** → Passwort des Postfachs eintragen → **Test senden**.
5. **Einstellungen → Benutzer** → Mitarbeiter anlegen.

> Ohne HTTPS (Schritt 5) funktioniert das Programm nur **online**. Für den Offline-Betrieb am iPad ist Schritt 5 nötig.

## Schritt 5 – Sichere Adresse (HTTPS) für iPad und Baustelle

### 5a – Adresse (DDNS)
Systemsteuerung → **Externer Zugriff** → DDNS → **Hinzufügen**:
- Dienstanbieter: **Synology**
- Hostname: z. B. `skop-bau` → ergibt `skop-bau.synology.me`
- Haken bei „Zertifikat von Let's Encrypt erhalten“ setzen

### 5b – Zertifikat
Systemsteuerung → **Sicherheit → Zertifikat**. Das Let's-Encrypt-Zertifikat für `skop-bau.synology.me` sollte dort erscheinen. Falls nicht: **Hinzufügen → Neues Zertifikat → Von Let's Encrypt**.

### 5c – Weiterleitung zum Programm (Reverse Proxy)
Systemsteuerung → **Anmeldeportal → Erweitert → Reverse Proxy → Erstellen**:

| | Quelle | Ziel |
|---|---|---|
| Protokoll | HTTPS | HTTP |
| Hostname | `skop-bau.synology.me` | `localhost` |
| Port | `8443` | `8080` |

Unter „Benutzerdefinierte Kopfzeile“ → Erstellen → **WebSocket** hinzufügen.

Danach unter Sicherheit → Zertifikat → **Einstellungen** dem Dienst `skop-bau.synology.me:8443` das Let's-Encrypt-Zertifikat zuweisen.

### 5d – Router
Im Router (Portweiterleitung) **nur Port 8443** an die NAS weiterleiten. Die DSM-Oberfläche selbst bleibt dadurch von außen unerreichbar.

> Falls Sie keinen Port öffnen möchten: Das Programm funktioniert dann am iPad offline und gleicht sich ab, sobald das iPad im Büro-WLAN oder per VPN verbunden ist. Sagen Sie mir Bescheid, dann passen wir die Anleitung an.

## Schritt 6 – iPad und PCs einrichten

1. Am iPad in **Safari** `https://skop-bau.synology.me:8443` öffnen und anmelden.
2. **Teilen** (Quadrat mit Pfeil) → **Zum Home-Bildschirm**.
3. Ab jetzt das Programm über das Symbol am Home-Bildschirm starten. Es funktioniert dann auch ohne Netz.

Am PC oder Mac dieselbe Adresse in Chrome oder Edge öffnen → in der Adresszeile **„App installieren“**.

## Schritt 7 – Datensicherung

**Hyper Backup** → Sicherungsaufgabe → den Ordner **`/docker/protokollwesen/data`** aufnehmen.

Zusätzlich legt das Programm täglich eine Kopie der Datenbank unter `data/backups` an (14 Tage).

## Updates

Neue Versionen erscheinen automatisch auf GitHub. Zum Einspielen:

1. **Container Manager → Projekt → protokollwesen → Aktion → Stoppen**
2. **Aktion → Erstellen**. Durch `pull_policy: always` wird dabei die neueste Version geladen (im Protokollfenster erscheint „Pulling … Pulled“).
3. Im Browser die Seite neu laden. Die Version steht unter `http://<IP-der-NAS>:8080/api/health`.

Ihre Daten bleiben dabei erhalten. Datenbank-Umstellungen laufen beim Start automatisch.

## Kostenverfolgung

Die Kostenverfolgung ist im selben Programm enthalten. Nach dem Update ist sie unter `http://<IP-der-NAS>:8080/kosten/` bzw. `https://<Ihre-Adresse>/kosten/` erreichbar, oder über **Kostenverfolgung** in der Seitenleiste. Es sind keine weiteren Einstellungen auf der NAS nötig. Ihre Daten liegen im selben `data`-Ordner und sind damit in Hyper Backup und der täglichen Sicherung enthalten.

Am iPad: `https://<Ihre-Adresse>/kosten/` in Safari öffnen → Teilen → **Zum Home-Bildschirm**.

## Hilfe bei Problemen

- **Container startet nicht:** Container Manager → Container → protokollwesen → **Protokoll**. Den Text an mich schicken.
- **Programmversion prüfen:** `http://<IP-der-NAS>:8080/api/health`
