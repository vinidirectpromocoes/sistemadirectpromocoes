"""Fictional fixtures for the isolated UI drill, no production access."""
import json,sys,shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_enterprise import EnterpriseTest
case=EnterpriseTest();case.setUp()
try:
    records=[case.default(k) for k in case.parents if False]
    import enterprise as e
    for k in e.ENTITIES:case.default(k)
    case.db.commit();shutil.copyfile(case.oldpath if False else __import__('server').DB_PATH,sys.argv[1])
    Path(sys.argv[2]).write_text(json.dumps(case.parents,ensure_ascii=False))
finally:case.tearDown()
