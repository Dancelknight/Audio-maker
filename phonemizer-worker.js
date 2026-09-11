const PHONEMIZER = {
  js: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.js",
  wasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  data: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data"
};

let factoryPromise=null;
let modulePromise=null;
let activeRequestId=null;

function ensureModule(){
  if(modulePromise) return modulePromise;
  modulePromise=(async()=>{
    importScripts(PHONEMIZER.js);
    if(typeof self.createPiperPhonemize!=="function") throw new Error("createPiperPhonemize missing in worker");
    return await self.createPiperPhonemize({
      noInitialRun:true,
      noExitRuntime:true,
      locateFile(file){
        if(file.endsWith(".wasm")) return PHONEMIZER.wasm;
        if(file.endsWith(".data")) return PHONEMIZER.data;
        return file;
      },
      print(line){
        if(activeRequestId===null) return;
        try{
          const parsed=JSON.parse(line);
          if(Array.isArray(parsed?.phoneme_ids)){
            const id=activeRequestId;
            activeRequestId=null;
            self.postMessage({
              type:"result",
              requestId:id,
              ids:parsed.phoneme_ids,
              phonemeCount:parsed.phonemes?.length||0,
              processedText:parsed.processed_text||""
            });
          }
        }catch(_){}
      },
      printErr(line){
        if(activeRequestId!==null && /error|fatal|exception|abort/i.test(String(line))){
          const id=activeRequestId;
          activeRequestId=null;
          self.postMessage({type:"error",requestId:id,message:String(line)});
        }
      }
    });
  })();
  return modulePromise;
}

self.onmessage=async(e)=>{
  const msg=e.data||{};
  if(msg.type==="close"){
    self.close();
    return;
  }
  const {requestId,text,language="de"}=msg;
  try{
    const mod=await ensureModule();
    if(activeRequestId!==null) throw new Error("Phonemizer worker busy");
    activeRequestId=requestId;
    mod.callMain([
      "-l",language,
      "--input",JSON.stringify([{text:String(text||"").trim()}]),
      "--espeak_data","/espeak-ng-data"
    ]);
  }catch(err){
    activeRequestId=null;
    self.postMessage({type:"error",requestId,message:err?.message||String(err),stack:err?.stack||null});
  }
};