# German Neural Reader v0.6 – German Piper-WASM Fix + Full Diagnostics

# German Neural Reader

Eine kleine statische Web-App für lange deutsche TTS-Aufnahmen im Browser.

## Was sie macht

- Piper/Thorsten German TTS direkt im Browser
- Medium- und High-Modell
- TXT-Upload oder Copy/Paste
- automatische Aufteilung langer Texte
- natürliche Satz-/Absatzpausen
- Ausgabe als **eine zusammenhängende MP3**
- keine TTS-API und kein Zeichenlimit
- der eingegebene Text wird nicht an einen TTS-Server geschickt

## iPhone: schnellster Weg

Die App muss über `https://` geöffnet werden. Am einfachsten:

1. ZIP entpacken.
2. Den kompletten Ordner bei einem statischen Hoster hochladen, z. B. Netlify Drop oder GitHub Pages.
3. Die erzeugte HTTPS-Adresse in Safari öffnen.
4. `1 · Stimme laden` antippen.
5. `Mittelalter-Text laden` oder eine eigene TXT auswählen.
6. Mit `Stimme testen` prüfen.
7. `2 · Komplette MP3 erzeugen`.
8. Safari im Vordergrund lassen und das Display nicht sperren.
9. Wenn die MP3 fertig ist, `MP3 sichern` antippen.

## Hinweise fürs iPhone

- **Medium** ist empfohlen; das Modell ist etwa 63 MB groß.
- **High** ist etwa 114 MB groß und benötigt mehr RAM.
- Beim ersten Start werden das Modell und JS-Bibliotheken geladen.
- Danach kann das Modell über den Browser-Cache wiederverwendet werden.
- Sehr lange Skripte können auf mobilen Geräten eine Weile dauern. Nicht währenddessen Safari schließen.

## Datenschutz

Die Sprachinferenz selbst findet lokal im Browser statt. Beim ersten Laden werden:
- ONNX Runtime Web von jsDelivr,
- Phonemizer.js von jsDelivr,
- lamejs von jsDelivr,
- das Piper-Sprachmodell von Hugging Face
heruntergeladen.

Der eigentliche Skripttext wird von der App nicht an einen TTS-Dienst gesendet.

## Lizenzen

Siehe `LICENSES.md`.


## v0.2 Änderungen
- kleinere TTS-Blöcke (ca. 180 Zeichen) für geringeren RAM-Verbrauch
- Safari-konservative ONNX-Konfiguration (`numThreads = 1`)
- separate Statusanzeige für **Phonemisierung**, **Audio-Berechnung** und **MP3-Kodierung**
- 45-s-Timeout für Phonemisierung und 90-s-Timeout pro ONNX-Abschnitt
- Diagnose-Knopf
- kurze UI-Pausen zwischen Abschnitten, damit Mobile Safari nicht scheinbar einfriert
- direkter Phonemizer-CDN-Import statt `+esm`

### Update einer bestehenden GitHub-Pages-Installation
Am einfachsten alle Dateien aus dem ZIP erneut ins Repository hochladen und vorhandene Dateien ersetzen.
Wichtig sind insbesondere `index.html` und `app.js`.


## v0.3 Änderungen
- ausführliches Debug-Log im Browser
- Button **Log kopieren**
- protokolliert Browser-/iPhone-Umgebung
- protokolliert Modell-Downloads und Cache-Hits
- protokolliert Phonemizer-Start, Laufzeit und Ergebnis
- protokolliert ONNX-Eingaben, Laufzeit und Audioausgabe
- globale JavaScript- und Promise-Fehler werden mit Stacktrace protokolliert
- Diagnose besteht jetzt aus 5 separaten Tests

Wenn ein Fehler auftritt:
1. Seite neu laden
2. `Diagnose` ausführen
3. `Log kopieren`
4. kompletten Log-Text an ChatGPT schicken


## v0.5
- TXT-Uploads werden **sofort** in `localStorage` gespeichert.
- Vor `Stimme laden`, `Stimme testen`, Modellwechsel und `Diagnose` wird der aktuelle Text nochmals gespeichert.
- Nach Reload wird der Text automatisch wiederhergestellt.
- Diagnose scrollt nach Abschluss automatisch zum vollständigen Log.
- `Kompletten Log kopieren` kopiert den gesamten Diagnoseverlauf.
- iOS-Dateiauswahl wird nach Upload zurückgesetzt, damit dieselbe TXT später erneut gewählt werden kann.


## v0.6 – wichtiger Fix

Der bisherige `phonemizer`-NPM-Baustein wurde entfernt. Der Grund:
Die verwendete Version 1.2.1 enthält im Quellcode `SUPPORTED_LANGUAGES = ["en"]` und ist damit für unser deutsches Thorsten-Modell die falsche Phonemizer-Schicht.

v0.6 nutzt stattdessen `@diffusionstudio/piper-wasm`, das Piper/eSpeak-NG-Daten für die eigentliche mehrsprachige Piper-Phonemisierung bereitstellt.

### Neue Diagnose
Die Diagnose prüft jetzt einzeln:
1. Browser-Umgebung
2. Piper-WASM JavaScript
3. Piper-WASM `.wasm`
4. eSpeak `.data`
5. Script/Factory
6. WASM/eSpeak-Initialisierung
7. deutsche Phonemisierung
8. Thorsten ONNX + Audio

Jeder Schritt landet vollständig im kopierbaren Diagnose-Log.
