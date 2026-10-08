// Compatibilidade para páginas antigas: nunca cria uma conta de diarista.
export function createSignupHandler() {
  return async request => {
    const origin=request.headers.get('Origin')||'';
    const allowed=/^https:\/\/sistemadirectpromocoes(?:-[a-z0-9]+)?(?:-sistemadirectpromocoes)?\.vercel\.app$/.test(origin);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(allowed){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization, apikey, content-type, x-client-info';headers['Access-Control-Allow-Methods']='POST, OPTIONS';}
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    return new Response(JSON.stringify({error:'O cadastro agora é feito sem conta ou senha. Reabra seu link privado de cadastro para usar o novo formulário.'}),{status:410,headers});
  };
}
