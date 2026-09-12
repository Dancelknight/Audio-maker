# Drittanbieter-Lizenzen und rechtliche Hinweise

Diese Datei dokumentiert die wichtigsten Drittanbieter-Komponenten der Anwendung. Sie ist eine technische Übersicht und keine Rechtsberatung. Für einen kommerziellen Launch sollten die jeweiligen Originallizenzen unverändert zugänglich bleiben.

## Browser-Anwendung

### ONNX Runtime Web 1.22.0
- Anbieter: Microsoft
- Lizenz: MIT
- Nutzung: ONNX-Inferenz im Browser
- Quelle: https://github.com/microsoft/onnxruntime
- Hinweis: MIT erlaubt kommerzielle Nutzung, Veränderung und Weitergabe; Copyright- und Lizenzhinweise müssen erhalten bleiben.

### @diffusionstudio/piper-wasm 1.0.0
- Lizenz des npm-Pakets: MIT
- Quelle: https://www.npmjs.com/package/@diffusionstudio/piper-wasm
- Nutzung: Piper-/eSpeak-NG-Phonemisierung im Browser
- Wichtiger Zusatz: Das veröffentlichte WASM-Build basiert unter anderem auf eSpeak NG. eSpeak NG steht unter GPL-3.0-or-later. Für eine öffentliche Distribution müssen deshalb die GPL-Hinweise und die Anforderungen an die Bereitstellung des korrespondierenden Quellcodes berücksichtigt werden.
- eSpeak NG: https://github.com/espeak-ng/espeak-ng
- Piper phonemize: https://github.com/rhasspy/piper-phonemize

### lamejs 1.2.1
- Lizenz: LGPL-3.0
- Quelle: https://github.com/zhuker/lamejs
- Nutzung: MP3-Kodierung im Browser
- Hinweis: Kommerzielle Nutzung ist möglich, die LGPL-Pflichten müssen aber eingehalten werden. Die Bibliothek sollte als klar getrennte Drittanbieter-Komponente behandelt und die Originallizenz zugänglich gemacht werden.

## Sprachmodelle

### Eva K – de_DE-eva_k-x_low
- Quelle: https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/de/de_DE/eva_k/x_low
- Repository-Kennzeichnung: MIT
- Trainingsdatensatz: M-AILABS German Speech Dataset
- Datensatzlizenz: BSD-artige M-AILABS-Lizenz; kommerzielle Nutzung ist erlaubt, Copyright-, Lizenz- und Haftungshinweise müssen bei Weiterverteilung des Datensatzes erhalten bleiben.
- Hinweis: Das Modell wird von der Anwendung zur Laufzeit von Hugging Face geladen und nicht als eigene Aufnahme ausgegeben.

### Thorsten – Medium / High
- Quelle: https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/de/de_DE/thorsten
- Repository-Kennzeichnung: MIT
- Trainingsdatensatz: Thorsten-Voice
- Datensatzlizenz: CC0-1.0
- Quelle des Datensatzes: https://github.com/thorstenMueller/Thorsten-Voice
- Hinweis: CC0 erlaubt auch kommerzielle Nutzung ohne Namensnennungspflicht; eine freiwillige Quellenangabe ist dennoch sinnvoll.

## Externe Rechenwege

### Google Colab
Das Colab-Notebook installiert aktuell unter anderem:
- piper-tts==1.3.0
- ffmpeg

Wichtig: piper-tts 1.3.0 ist auf PyPI als GPL-3.0-or-later ausgewiesen. Kommerzielle Nutzung ist grundsätzlich erlaubt, aber Distribution und Bereitstellung müssen die GPL-Bedingungen erfüllen.

FFmpeg ist je nach Build und aktivierten Komponenten unter LGPL bzw. GPL lizenziert. Das in Google Colab über apt installierte ffmpeg wird nur in der externen Colab-Laufzeit verwendet und nicht als Bestandteil dieser Website ausgeliefert.

### Hugging Face Space
Der derzeit noch deaktivierte Prototyp verwendet:
- FastAPI
- Uvicorn
- Pydantic
- piper-tts==1.3.0
- ffmpeg

Auch hier ist insbesondere die GPL-3.0-or-later-Lizenz von piper-tts zu beachten.

## Eigener Anwendungscode

Der selbst geschriebene Code dieses Repositories hat derzeit keine separate Open-Source-Lizenzdatei. Ohne ausdrücklich vergebene Lizenz bleibt der eigene Code urheberrechtlich geschützt. Ein öffentlich sichtbares GitHub-Repository bedeutet nicht automatisch, dass Dritte den Code frei kopieren oder kommerziell weiterverwenden dürfen.

Wenn die Anwendung proprietär bleiben soll, sollte keine allgemeine MIT-Lizenz für das gesamte Repository hinzugefügt werden. Stattdessen sollten nur die Drittanbieter-Lizenzen sauber dokumentiert werden.

## Empfehlung vor öffentlichem kommerziellem Launch

1. Eine sichtbare Seite „Lizenzen / Drittanbieter“ auf der Website ergänzen.
2. Die vollständigen Original-Lizenztexte bzw. verlässliche Links für MIT, LGPL-3.0 und GPL-3.0-or-later bereitstellen.
3. Für das Browser-WASM mit eSpeak NG die GPL-Source-Compliance sauber lösen.
4. Für lamejs die LGPL-Hinweise und die Trennung der Bibliothek dokumentieren.
5. Datenschutz und Nutzungsbedingungen getrennt von den Open-Source-Lizenzen behandeln.
6. Bei Upload fremder Texte klarstellen, dass Nutzer selbst für die erforderlichen Rechte an den Inhalten verantwortlich sind.

