// Custom authentication is checked in PostgreSQL before privileged Storage access.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
Deno.serve(async (req: Request) => {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
  if(req.method !== 'POST') return new Response(JSON.stringify({erro:'Use POST.'}),{status:405,headers});
  try {
    const text=await req.text();if(text.length>10000)throw Error('Invalid');
    const p=JSON.parse(text);
    if(!Array.isArray(p.ids)||p.ids.length<1||p.ids.length>100||p.ids.some((x: unknown)=>!Number.isSafeInteger(x)||Number(x)<1))throw Error('Invalid');
    const url=Deno.env.get('SUPABASE_URL')!;
    const publicKey='sb_publishable_sulYm_YcfXUosfNvhQnDXg_I4lgxjth';
    const auth=await fetch(url+'/rest/v1/rpc/direct_backup_attachment_manifest',{method:'POST',headers:{apikey:publicKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:p.token,p_run:p.run,p_ids:p.ids})});
    if(!auth.ok)throw Error('Unauthorized');
    const items=await auth.json();if(items.length!==p.ids.length)throw Error('Incomplete');
    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const signed=await service.storage.from('direct-evidencias').createSignedUrls(items.map((x:{caminho:string})=>x.caminho),600);
    if(signed.error||signed.data?.some(x=>!x.signedUrl))throw Error('Storage');
    return new Response(JSON.stringify({items:items.map((x:object,i:number)=>({...x,url:signed.data![i].signedUrl}))}),{headers});
  } catch {return new Response(JSON.stringify({erro:'Acesso ou cópia de evidências indisponível.'}),{status:401,headers});}
});
