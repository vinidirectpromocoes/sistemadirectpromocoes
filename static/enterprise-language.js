/* Administrator-reviewed vocabulary; exact phrases, no regular expressions. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.DirectEnterpriseLanguage=api;})(globalThis,()=>{
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 function apply(text,records){const lines=String(text).split('\n'),words=lines[0].trim().split(/\s+/),matches=[];for(const r of records||[]){if(r.status!=='aprovada')continue;const phrase=r.dados.entrada.trim().split(/\s+/);if(phrase.length&&phrase.every((w,i)=>norm(words[i])===norm(w)))matches.push({count:phrase.length,command:r.dados.comando});}if(!matches.length)return text;const length=Math.max(...matches.map(m=>m.count)),best=matches.filter(m=>m.count===length);if(new Set(best.map(m=>m.command)).size>1)throw Error('Há formas de falar aprovadas com interpretações diferentes. Revise o vocabulário antes de aplicar.');lines[0]=best[0].command+(words.length>length?' '+words.slice(length).join(' '):'');return lines.join('\n');}
 return {apply,norm};
});
