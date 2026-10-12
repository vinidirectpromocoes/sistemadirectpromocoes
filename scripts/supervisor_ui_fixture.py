"""Append a completely fictional case to the named disposable test database."""
import sys,json
from pathlib import Path
from datetime import timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
import server,enterprise as e
from test_server import SAMPLE
server.DB_PATH=Path(sys.argv[1]);server.init_db()
with server.connect() as db:
    count=db.execute('select count(*) from diaristas').fetchone()[0]
    digits=list(str(123450000+count).zfill(9))
    for size in (9,10):
        value=(sum(int(d)*weight for d,weight in zip(digits,range(size+1,1,-1)))*10)%11;digits.append(str(0 if value==10 else value))
    p={**SAMPLE,'cpf':''.join(digits),'nome':'Pessoa fictícia supervisor '+str(count)};data=server.validate(p);stamp=e.now()
    worker=db.execute('INSERT INTO diaristas('+','.join(data)+',criado_em,atualizado_em) VALUES('+','.join('?' for _ in range(len(data)+2))+')',(*data.values(),stamp,stamp)).lastrowid
    today=e.company_today();shifts=[dict(data=(today+timedelta(days=delta)).isoformat(),inicio='07:00',fim='15:20') for delta in (-1,0,1)]
    order_data=server.validate_order(dict(supermercado='Super Lagoa',unidade='Unidade fictícia supervisor',setor='Eventos',quantidade_diaristas=1,turnos=shifts))
    order=db.execute('INSERT INTO pedidos('+','.join(order_data)+',criado_em,atualizado_em) VALUES('+','.join('?' for _ in range(len(order_data)+2))+')',(*order_data.values(),stamp,stamp)).lastrowid
    ids=[]
    for shift in shifts[:2]:
        sid=db.execute("INSERT INTO pedido_escalas(pedido_id,diarista_id,data,status,criado_em,atualizado_em) VALUES(?,?,?,'presente',?,?)",(order,worker,shift['data'],stamp,stamp)).lastrowid
        ids.append(db.execute('INSERT INTO diarias(diarista_id,data,local,setor,valor_centavos,valor_recebido_centavos,pedido_escala_id,criado_em) VALUES(?,?,?,?,?,?,?,?)',(worker,shift['data'],'Super Lagoa','Eventos',10000,16000,sid,stamp)).lastrowid)
    print(json.dumps(dict(worker=worker,order=order,dailies=ids,day=today.isoformat(),start=(today-timedelta(days=1)).isoformat())))
