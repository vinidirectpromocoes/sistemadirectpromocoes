/* Optional inference, isolated from business APIs and credentials. */
let transformerModule,semanticPipeline,speechPipeline,languageEngine,cpuLanguagePipeline,busy=false;
const progress=(id,p)=>postMessage({id,progress:p.text||[p.status,p.file,p.progress?Math.round(p.progress)+'%':''].filter(Boolean).join(' ')});
async function transformers(){if(!transformerModule){transformerModule=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');transformerModule.env.allowLocalModels=false;transformerModule.env.backends.onnx.wasm.numThreads=1;}return transformerModule;}
onmessage=async event=>{
 const {id,type,p}=event.data;
 if(busy){postMessage({id,error:'Já existe um processamento em andamento.'});return;}busy=true;
 try{
  let result;
  if(type==='semantic'){
   if(!Array.isArray(p.texts)||p.texts.length>50||p.texts.some(t=>typeof t!=='string'||t.length>1000)||typeof p.query!=='string'||p.query.length>500)throw Error('Selecione até 50 registros para esta busca.');
   const {pipeline}=await transformers();semanticPipeline ||= await pipeline('feature-extraction','Xenova/paraphrase-multilingual-MiniLM-L12-v2',{dtype:'q8',device:'wasm',progress_callback:info=>progress(id,info)});
   const vectors=(await semanticPipeline([p.query,...p.texts],{pooling:'mean',normalize:true})).tolist(),query=vectors.shift();result=vectors.map((v,index)=>({index,score:v.reduce((sum,value,i)=>sum+value*query[i],0)})).sort((a,b)=>b.score-a.score).slice(0,5);
  }else if(type==='speech'){
   if(!(p.audio instanceof Float32Array)||!p.audio.length||p.audio.length>16000*60)throw Error('Use áudio de até 60 segundos.');
   const {pipeline}=await transformers();speechPipeline ||= await pipeline('automatic-speech-recognition','Xenova/whisper-tiny',{dtype:'q8',device:'wasm',progress_callback:info=>progress(id,info)});
   result=(await speechPipeline(p.audio,{language:'portuguese',task:'transcribe',chunk_length_s:30,stride_length_s:5})).text;
  }else if(type==='language-cpu'){
   if(typeof p.text!=='string'||!p.text.trim()||p.text.length>1000)throw Error('Use uma mensagem de até 1.000 caracteres.');
   const {pipeline}=await transformers();cpuLanguagePipeline ||= await pipeline('text-generation','onnx-community/Qwen2.5-0.5B-Instruct',{dtype:'q4',device:'wasm',progress_callback:info=>progress(id,info)});
   const response=await cpuLanguagePipeline([{role:'system',content:'Responda em português. Resuma o pedido em uma frase e faça uma pergunta para confirmar. Não invente dados. Você não executa ações no sistema.'},{role:'user',content:p.text}],{max_new_tokens:64,do_sample:false});const generated=response[0].generated_text;result=Array.isArray(generated)?generated.at(-1).content:generated;
  }else if(type==='language'){
   if(typeof p.text!=='string'||p.text.length>2000)throw Error('Use uma mensagem de até 2.000 caracteres.');
   if(!navigator.gpu)throw Error('Modelo local exige WebGPU neste navegador. Continue com o assistente por regras.');
   if(!languageEngine){const {CreateMLCEngine,prebuiltAppConfig}=await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm');const name='Qwen2.5-0.5B-Instruct-q4f16_1-MLC';if(!prebuiltAppConfig.model_list.some(m=>m.model_id===name))throw Error('O modelo selecionado não está disponível nesta versão.');languageEngine=await CreateMLCEngine(name,{initProgressCallback:info=>progress(id,info)});}
   await languageEngine.resetChat();
   const response=await languageEngine.chat.completions.create({messages:[{role:'system',content:'Você ajuda a Direct Promoções a esclarecer uma solicitação em português. Não tem acesso ao sistema nem pode afirmar que salvou dados. Resuma o pedido, indique informações faltantes e proponha uma pergunta de conferência. Não invente nomes, CPF, preços ou pagamentos. Sua resposta será revisada por uma pessoa.'},{role:'user',content:p.text}],temperature:0.1,max_tokens:256});result=response.choices[0].message.content;
  }else throw Error('Recurso local não reconhecido.');
  postMessage({id,result});
 }catch(e){postMessage({id,error:/compatible GPU|WebGPU|adapter/i.test(e.message)?'A aceleração de vídeo não está disponível neste aparelho. Use a opção pelo processador ou a Leitura IA por regras.':e.message||String(e)});}finally{busy=false;}
};
