const PHONEMIZER = {
  js: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.js",
  wasm: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
  data: "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data"
};

let factoryPromise=null;
let modulePromise=null;
let activeRequestId=null;
let activeConfigUrl=null;
let activeModelKey=null;
let configCache=new Map();


async function getModelConfig(url){
  if(!url) return null;
  if(configCache.has(url)) return configCache.get(url);
  const p=(async()=>{
    const r=await fetch(url,{mode:"cors",cache:"force-cache"});
    if(!r.ok) throw new Error("Config download failed ("+r.status+")");
    return await r.json();
  })();
  configCache.set(url,p);
  return p;
}

function phonemesToModelIds(phonemes,phonemeIdMap){
  if(!Array.isArray(phonemes) || !phonemeIdMap) return null;
  const out=[];
  const add=(symbol)=>{
    const v=phonemeIdMap[symbol];
    if(v===undefined) return false;
    if(Array.isArray(v)) out.push(...v);
    else out.push(v);
    return true;
  };
  // Piper convention: BOS, then each phoneme followed by PAD, then EOS.
  add("^");
  for(const ph of phonemes){
    if(add(ph)) add("_");
  }
  add("$");
  return out;
}

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
            const configUrl=activeConfigUrl;
            const modelKey=activeModelKey;
            activeRequestId=null;
            activeConfigUrl=null;
            activeModelKey=null;
            (async()=>{
              try{
                let ids=parsed.phoneme_ids;
                let mapping="generic-piper";
                if(configUrl && Array.isArray(parsed.phonemes)){
                  const cfg=await getModelConfig(configUrl);
                  const mapped=phonemesToModelIds(parsed.phonemes,cfg?.phoneme_id_map);
                  if(Array.isArray(mapped) && mapped.length>=4){
                    ids=mapped;
                    mapping="model-config";
                  }
                }
                self.postMessage({
                  type:"result",
                  requestId:id,
                  ids,
                  phonemeCount:parsed.phonemes?.length||0,
                  processedText:parsed.processed_text||"",
                  mapping,
                  modelKey
                });
              }catch(err){
                self.postMessage({type:"error",requestId:id,message:err?.message||String(err),stack:err?.stack||null});
              }
            })();
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
  const {requestId,text,language="de",configUrl=null,modelKey=null}=msg;
  try{
    const mod=await ensureModule();
    if(activeRequestId!==null) throw new Error("Phonemizer worker busy");
    activeRequestId=requestId;
    activeConfigUrl=configUrl;
    activeModelKey=modelKey;
    mod.callMain([
      "-l",language,
      "--input",JSON.stringify([{text:String(text||"").trim()}]),
      "--espeak_data","/espeak-ng-data"
    ]);
  }catch(err){
    activeRequestId=null;
    activeConfigUrl=null;
    activeModelKey=null;
    self.postMessage({type:"error",requestId,message:err?.message||String(err),stack:err?.stack||null});
  }
};