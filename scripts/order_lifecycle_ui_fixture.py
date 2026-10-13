"""Historic fictional case in a named disposable SQLite database; never production."""
import sys,json
from pathlib import Path
from datetime import timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
import server,enterprise as e
from test_server import SAMPLE
server.DB_PATH=Path(sys.argv[1]);server.init_db()
with server.connect() as db:
    count=db.execute('select count(*) from diaristas').fetchone()[0];workers=[];stamp=e.now()
    for i in range(2):
        digits=list(str(123450000+count+i).zfill(9))
        for size in (9,10):
            v=sum(int(d)*w for d,w in zip(digits,range(size+1,1,-1)))*10%11;digits.append(str(0 if v==10 else v))
        p=server.validate({**SAMPLE,'nome':'Original fictício' if i==0 else 'Reposição fictícia','cpf':''.join(digits)})
        workers.append(db.execute('INSERT INTO diaristas('+','.join(p)+',criado_em,atualizado_em) VALUES('+','.join('?' for _ in range(len(p)+2))+')',(*p.values(),stamp,stamp)).lastrowid)
    days=[(e.company_today()+timedelta(days=n)).isoformat() for n in range(-7,0)]
    def order(dates):
        p=server.validate_order(dict(supermercado='Super do Povo',unidade='Histórico fictício '+str(count),setor='Eventos',quantidade_diaristas=1,turnos=[dict(data=d,inicio='07:00',fim='15:20') for d in dates]));return db.execute('INSERT INTO pedidos('+','.join(p)+',criado_em,atualizado_em) VALUES('+','.join('?' for _ in range(len(p)+2))+')',(*p.values(),stamp,stamp)).lastrowid
    oid=order(days);ids=[]
    for day,status in zip(days,['presente','presente','falta','falta','desistiu','desistiu','desistiu']):
        sid=db.execute('INSERT INTO pedido_escalas(pedido_id,diarista_id,data,status,criado_em,atualizado_em) VALUES(?,?,?,?,?,?)',(oid,workers[0],day,status,stamp,stamp)).lastrowid
        if status in ('falta','desistiu'):db.execute("UPDATE pedido_escalas SET falta_motivo=?,desistencia_motivo=?,desistencia_por='QA',desistencia_em=? WHERE id=?",('Ausência conferida' if status=='falta' else None,'Não pode continuar' if status=='desistiu' else None,stamp,sid))
        if status=='desistiu':
            replacement=db.execute("INSERT INTO pedido_escalas(pedido_id,diarista_id,data,status,criado_em,atualizado_em) VALUES(?,?,?,'presente',?,?)",(oid,workers[1],day,stamp,stamp)).lastrowid;db.execute('UPDATE pedido_escalas SET substituida_por_escala_id=? WHERE id=?',(replacement,sid));sid=replacement
        if status!='falta':
            wid=workers[1] if status=='desistiu' else workers[0]
            ids.append(db.execute('INSERT INTO diarias(diarista_id,data,local,setor,pedido_escala_id,valor_centavos,valor_recebido_centavos,criado_em,data_pagamento,forma_pagamento) VALUES(?,?,?,?,?,?,?,?,?,?)',(wid,day,'Super do Povo','Eventos',sid,9000,13400,stamp,days[-1] if len(ids)==0 else None,'Pix fictício' if len(ids)==0 else '')).lastrowid)
    pending=order([days[-1]]);sid=db.execute("INSERT INTO pedido_escalas(pedido_id,diarista_id,data,status,criado_em,atualizado_em) VALUES(?,?,?,'escalada',?,?)",(pending,workers[1],days[-1],stamp,stamp)).lastrowid
    print(json.dumps(dict(order=oid,pending=pending,workers=workers,pending_scale=sid,dailies=ids)))
