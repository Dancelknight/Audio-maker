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
