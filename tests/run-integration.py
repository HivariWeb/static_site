"""HTTP integration checks with isolated storage and a local SMTP sink. No external mail."""
import argparse, pathlib, tempfile, subprocess, os, socket, socketserver, threading
import urllib.request, urllib.error, urllib.parse, http.cookiejar, json, re, time, unittest
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor

ROOT=pathlib.Path(__file__).resolve().parent.parent
class SMTP(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b'220 local-test ESMTP\r\n')
        data=False;message=[]
        while True:
            line=self.rfile.readline()
            if not line:return
            if data:
                if line==b'.\r\n':
                    self.server.messages.append(b''.join(message));data=False
                    self.wfile.write(b'250 accepted by local test sink\r\n')
                else:message.append(line)
                continue
            cmd=line.upper()
            if cmd.startswith(b'DATA'):
                self.wfile.write(b'354 end with dot\r\n');data=True
            elif cmd.startswith(b'RCPT') and self.server.reject:
                self.wfile.write(b'450 temporary test failure\r\n')
            elif cmd.startswith(b'QUIT'):
                self.wfile.write(b'221 bye\r\n');return
            else:self.wfile.write(b'250 OK\r\n')

class Parser(HTMLParser):
    def __init__(self):super().__init__();self.hidden={};self.form=False
    def handle_starttag(self,t,attrs):
        a=dict(attrs)
        if t=='form' and a.get('id')=='request-form':self.form=True
        if t=='input' and a.get('type')=='hidden':self.hidden[a['name']]=a.get('value','')

def export(value):
    if isinstance(value,dict):return '['+', '.join(export(k)+' => '+export(v) for k,v in value.items())+']'
    if isinstance(value,list):return '['+', '.join(export(x) for x in value)+']'
    if isinstance(value,bool):return 'true' if value else 'false'
    if isinstance(value,int):return str(value)
    return "'"+str(value).replace('\\','\\\\').replace("'","\\'")+"'"

class Checks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='diana-integration-')
        cls.directory=pathlib.Path(cls.temp.name)
        cls.configpath=cls.directory/'config.php'
        cls.smtp=socketserver.ThreadingTCPServer(('127.0.0.1',0),SMTP)
        cls.smtp.daemon_threads=True;cls.smtp.messages=[];cls.smtp.reject=False
        threading.Thread(target=cls.smtp.serve_forever,daemon=True).start()
        with socket.socket() as s:s.bind(('127.0.0.1',0));cls.port=s.getsockname()[1]
        cls.origin='http://127.0.0.1:'+str(cls.port)
        cls.environment=os.environ.copy();cls.environment['DIANA_CONFIG_PATH']=str(cls.configpath)
        cls.php_args=[ARGS.php,'-n','-d','display_errors=0','-d','log_errors=1','-d','SMTP=127.0.0.1','-d','smtp_port='+str(cls.smtp.server_address[1])]
        cls.log=(ROOT/'audit-2026-10-23/integration-php.log').open('w',encoding='utf-8')
        cls.server=subprocess.Popen(cls.php_args+['-S','127.0.0.1:'+str(cls.port),'-t',str(ROOT),str(ROOT/'tools/dev-router.php')],cwd=ROOT,env=cls.environment,stdout=cls.log,stderr=cls.log)
        for _ in range(100):
            try:
                urllib.request.urlopen(cls.origin+'/',timeout=1).close();break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Local PHP server did not start')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate();cls.server.wait(timeout=10);cls.log.close()
        cls.smtp.shutdown();cls.smtp.server_close();cls.temp.cleanup()

    def setUp(self):
        self.case=pathlib.Path(tempfile.mkdtemp(dir=self.directory,prefix='case-'))
        self.config={'storage_path':str(self.case/'storage'),'secret':'a'*64,'allowed_origins':[self.origin],
                     'notification_email':'test@example.invalid','from_email':'no-reply@dianaberezovskaya.online',
                     'mail_enabled':False,'retention_days':90,'rate_limit':5,'rate_window_seconds':900}
        self.saveconfig();self.smtp.messages.clear();self.smtp.reject=False
        self.cookies=http.cookiejar.CookieJar();self.client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def saveconfig(self):self.configpath.write_text('<?php\nreturn '+export(self.config)+';\n',encoding='utf-8')
    def request(self,path,data=None,headers=None,method=None,client=None):
        body=urllib.parse.urlencode(data).encode('utf-8') if isinstance(data,dict) else data
        req=urllib.request.Request(self.origin+path,data=body,headers=headers or {},method=method)
        try:r=(client or self.client).open(req,timeout=10)
        except urllib.error.HTTPError as e:r=e
        with r:return r.status,dict(r.headers),r.read().decode('utf-8')
    def form(self):
        status,headers,body=self.request('/request.php?service=regime')
        self.assertEqual(status,200,body[:200]);parser=Parser();parser.feed(body);self.assertTrue(parser.form)
        self.assertNotIn('checked',body.split('id="consent"',1)[1].split('>',1)[0])
        return parser.hidden
    def payload(self,**changes):
        data=self.form()|{'name':'Тестовый родитель','contact_method':'email','contact':'parent@example.invalid','service':'regime','consent':'1','website':''}
        return data|changes
    def submit(self,data,headers=None):
        return self.request('/api/leads.php',data,headers or {'Accept':'application/json','Origin':self.origin})
    def records(self):return [json.loads(p.read_text('utf-8')) for p in (self.case/'storage/leads').glob('L-*.json')]
    def maintenance(self):
        result=subprocess.run(self.php_args+[str(ROOT/'tools/maintenance.php')],cwd=ROOT,env=self.environment,capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr);return json.loads(result.stdout)

    def test_saved_before_notification_and_separate_consent(self):
        status,headers,body=self.submit(self.payload())
        self.assertEqual(status,201,body);self.assertTrue(json.loads(body)['ok'])
        record=self.records()[0];self.assertTrue(record['consent']['accepted']);self.assertEqual(record['consent']['version'],'2026-10-23')
        self.assertEqual(len(record['consent']['document_sha256']),64);self.assertNotIn('ip',record['technical'])
        self.assertEqual(record['notification']['status'],'pending');self.assertEqual(len(self.smtp.messages),0)
        self.assertEqual(record['price_rub'],4000);self.assertIn('no-store',headers.get('Cache-Control',''))

    def test_duplicate_and_conflict(self):
        data=self.payload();a=self.submit(data);b=self.submit(data)
        self.assertEqual(a[0],201);self.assertEqual(b[0],200);self.assertEqual(json.loads(a[2])['lead_id'],json.loads(b[2])['lead_id'])
        self.assertEqual(len(self.records()),1);self.assertEqual(self.submit(data|{'name':'Другое имя'})[0],409)

    def test_parallel_duplicate(self):
        data=self.payload();cookie='; '.join(c.name+'='+c.value for c in self.cookies)
        def send(_):return self.request('/api/leads.php',data,{'Accept':'application/json','Origin':self.origin,'Cookie':cookie},client=urllib.request.build_opener())
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(send,range(2)))
        self.assertEqual(sorted(r[0] for r in results),[200,201]);self.assertEqual(len(self.records()),1)

    def test_consent_and_validation(self):
        data=self.payload(consent='0',contact='invalid')
        status,_,body=self.submit(data);self.assertEqual(status,422);errors=json.loads(body)['errors']
        self.assertIn('consent',errors);self.assertIn('contact',errors);self.assertEqual(self.records(),[])
        self.assertEqual(self.submit(self.payload(name='<script>alert(1)</script>'))[0],422)

    def test_csrf_origin_and_honeypot(self):
        data=self.payload();self.assertEqual(self.submit(data|{'csrf':'wrong'})[0],403)
        self.assertEqual(self.submit(data,{'Accept':'application/json','Origin':'https://attacker.invalid'})[0],403)
        self.assertEqual(self.submit(data|{'website':'https://spam.invalid'})[0],400);self.assertEqual(self.records(),[])

    def test_contact_arrays_and_injection(self):
        data=self.payload();del data['contact'];data['contact[x]']='bad'
        self.assertEqual(self.submit(data)[0],422)
        self.assertEqual(self.submit(self.payload(contact='a@example.invalid\r\nBcc: other@example.invalid'))[0],422)

    def test_contact_methods(self):
        for method,value in [('telegram','@parent_test'),('telegram','+7 (999) 123-45-67'),('whatsapp','+7 999 123-45-67')]:
            self.assertEqual(self.submit(self.payload(contact_method=method,contact=value))[0],201)
        self.assertEqual(self.submit(self.payload(contact_method='phone'))[0],422)

    def test_rate_limit_and_retry_allowed(self):
        first=None
        for _ in range(5):
            data=self.payload();self.assertEqual(self.submit(data)[0],201);first=first or data
        status,headers,_=self.submit(self.payload());self.assertEqual(status,429);self.assertIn('Retry-After',headers)
        self.assertEqual(self.submit(first)[0],200);self.assertEqual(len(self.records()),5)

    def test_attribution_requires_separate_permission(self):
        data={'utm_source':'yandex','yclid':'123456','client_id':'987654','secret':'must-not-be-saved'}
        self.assertEqual(self.submit(self.payload(analytics_consent='0',attribution=json.dumps(data)))[0],201)
        self.assertEqual(self.records()[0]['attribution'],[])
        self.assertEqual(self.submit(self.payload(analytics_consent='1',attribution=json.dumps(data)))[0],201)
        granted=next(r for r in self.records() if r['analytics_consent']);self.assertEqual(granted['attribution']['yclid'],'123456');self.assertNotIn('secret',granted['attribution'])

    def test_mail_handoff_and_retry_queue(self):
        self.config['mail_enabled']=True;self.saveconfig();self.smtp.reject=True
        data=self.payload();self.assertEqual(self.submit(data)[0],201)
        self.assertEqual(self.records()[0]['notification']['status'],'pending');self.smtp.reject=False
        result=self.maintenance();self.assertEqual(result['notifications_sent'],1)
        self.assertEqual(self.records()[0]['notification']['status'],'sent');self.assertEqual(len(self.smtp.messages),1)
        self.submit(data);self.maintenance();self.assertEqual(len(self.smtp.messages),1)

    def test_native_form_and_success_not_forgeable(self):
        _,_,page=self.request('/request.php?done=1');parser=Parser();parser.feed(page);self.assertTrue(parser.form)
        data=self.payload();status,_,body=self.request('/api/leads.php',data,{'Origin':self.origin})
        self.assertEqual(status,200);self.assertIn('<h2>Заявка принята</h2>',body);parser=Parser();parser.feed(body);self.assertFalse(parser.form);self.assertEqual(len(self.records()),1)

    def test_storage_unavailable_does_not_report_success(self):
        data=self.payload();block=self.case/'blocked';block.write_text('not a directory');self.config['storage_path']=str(block);self.saveconfig()
        status,_,body=self.submit(data);self.assertEqual(status,503);self.assertFalse(json.loads(body)['ok']);self.assertNotIn(str(self.case),body)

    def test_expiry_cleanup(self):
        self.assertEqual(self.submit(self.payload())[0],201)
        p=next((self.case/'storage/leads').glob('L-*.json'));record=json.loads(p.read_text('utf-8'));record['expires_at']='2000-01-01T00:00:00+00:00';p.write_text(json.dumps(record),encoding='utf-8')
        self.assertEqual(self.maintenance()['deleted_requests'],1);self.assertEqual(self.records(),[])

    def test_public_storage_is_rejected(self):
        data=self.payload();public=ROOT/'audit-2026-10-23'/'temporary-public-storage-test'
        self.assertFalse(public.exists());self.config['storage_path']=str(public);self.saveconfig()
        try:
            status,_,body=self.submit(data);self.assertEqual(status,503);self.assertFalse(json.loads(body)['ok'])
            self.assertFalse((public/'leads').exists())
        finally:
            if public.exists():public.rmdir()

    def test_http_protection_and_no_private_records(self):
        for path in ['/config/hosting.example.php','/includes/bootstrap.php','/.git/HEAD','/audit-2026-10-23/AUDIT.md','/tools/maintenance.php','/.vscode/settings.json']:
            self.assertEqual(self.request(path)[0],403,path)
        self.assertEqual(self.request('/send-email.php')[0],410)
        self.assertEqual(self.request('/api/leads.php')[0],405)
        self.assertEqual(self.request('/nonexistent-page')[0],404)
        status,headers,_=self.request('/');self.assertEqual(status,200);self.assertIn('Content-Security-Policy',headers)

    def test_oversized_and_unsupported_payload(self):
        self.assertEqual(self.request('/api/leads.php',b'x'*9000,{'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'})[0],413)
        self.assertEqual(self.request('/api/leads.php',b'{}',{'Accept':'application/json','Content-Type':'application/json'})[0],415)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--php',required=True);ARGS,remaining=parser.parse_known_args()
    unittest.main(argv=[__file__]+remaining,verbosity=2)
