export function createSignupHandler(env,createClient){
 return async function(req){
  const origin=req.headers.get('origin')||'';
  const allowed=origin==='https://sistemadirectpromocoes-zeta.vercel.app'||origin==='https://sistemadirectpromocoes.vercel.app'||/^https:\/\/sistemadirectpromocoes-[a-z0-9]+-sistemadirectpromocoes\.vercel\.app$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
  const reply=(status,message)=>new Response(JSON.stringify(typeof message==='string'?{error:message}:message),{status,headers});
  if(!allowed)return reply(403,'Origem não permitida.');
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,'Método não permitido.');
  if(Number(req.headers.get('content-length')||0)>16000)return reply(413,'Cadastro muito grande.');
  let body;try{const text=await req.text();if(text.length>16000)return reply(413,'Cadastro muito grande.');body=JSON.parse(text);}catch{return reply(400,'Confira os dados do cadastro.');}
  const {convite,email,senha,dados}=body||{};
  if(typeof convite!=='string'||!/^[0-9a-f]{64}$/.test(convite)||typeof email!=='string'||email.length>254||typeof senha!=='string'||senha.length<8||senha.length>128||!dados||typeof dados!=='object'||Array.isArray(dados)||typeof dados.nome!=='string'||typeof dados.cpf!=='string')return reply(400,'Confira convite, e-mail, senha, nome e CPF.');
  const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const cleanEmail=email.trim().toLowerCase();
  // Uma reserva no banco limita tentativas e impede criar várias contas por convite.
  const reservation=await admin.rpc('direct_portal_signup_prepare',{p_convite:convite,p_email:cleanEmail,p_cpf:dados.cpf,p_nome:dados.nome});
  if(reservation.error)return reply(400,reservation.error.message);
  const nonce=reservation.data;
  let created;try{created=await admin.auth.admin.createUser({email:cleanEmail,password:senha,email_confirm:true,user_metadata:{direct_cadastro:dados,direct_convite:convite},app_metadata:{direct_invite_signup:nonce}});}catch{await admin.rpc('direct_portal_signup_release',{p_convite:convite,p_nonce:nonce});return reply(503,'Não foi possível criar o acesso. Tente novamente.');}
  if(created.error){await admin.rpc('direct_portal_signup_release',{p_convite:convite,p_nonce:nonce});return reply(400,/already|registered|exists/i.test(created.error.message)?'Se já possui conta, use “Já tenho acesso” para entrar.':'Não foi possível criar o acesso. Confira o e-mail e a senha.');}
  const finish=await admin.rpc('direct_portal_signup_finish',{p_convite:convite,p_nonce:nonce,p_user_id:created.data.user.id});
  if(finish.error){await admin.auth.admin.deleteUser(created.data.user.id);await admin.rpc('direct_portal_signup_release',{p_convite:convite,p_nonce:nonce});return reply(400,'Não foi possível concluir o convite. Peça um novo link à Direct.');}
  return reply(200,{created:true});
 };
}
