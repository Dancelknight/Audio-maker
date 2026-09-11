const PHONEMIZER = {
  js: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.js",
  wasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  data: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data"
};

self.onmessage = async (e) => {
  const { text, language="de" } = e.data || {};
  try {
    importScripts(PHONEMIZER.js);
    if (typeof self.createPiperPhonemize !== "function") {
      throw new Error("createPiperPhonemize missing in worker");
    }

    let resolved = false;
    const mod = await self.createPiperPhonemize({
      noInitialRun: true,
      noExitRuntime: true,
      locateFile(file) {
        if (file.endsWith(".wasm")) return PHONEMIZER.wasm;
        if (file.endsWith(".data")) return PHONEMIZER.data;
        return file;
      },
      print(line) {
        if (resolved) return;
        try {
          const parsed = JSON.parse(line);
          if (Array.isArray(parsed?.phoneme_ids)) {
            resolved = true;
            self.postMessage({
              type: "result",
              ids: parsed.phoneme_ids,
              phonemeCount: parsed.phonemes?.length || 0,
              processedText: parsed.processed_text || ""
            });
          }
        } catch (_) {}
      },
      printErr(line) {
        if (/error|fatal|exception|abort/i.test(String(line))) {
          self.postMessage({ type: "error", message: String(line) });
        }
      }
    });

    mod.callMain([
      "-l", language,
      "--input", JSON.stringify([{text:String(text || "").trim()}]),
      "--espeak_data", "/espeak-ng-data"
    ]);
  } catch (err) {
    self.postMessage({ type: "error", message: err?.message || String(err), stack: err?.stack || null });
  }
};