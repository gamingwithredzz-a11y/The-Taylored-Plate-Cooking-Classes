import io
import json
import tempfile
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4
from plate.api import Application
from plate.common import Error

ADMIN='11111111-1111-4111-8111-111111111111'
A='22222222-2222-4222-8222-222222222222'
B='33333333-3333-4333-8333-333333333333'
C='44444444-4444-4444-8444-444444444444'
ST='s'*40
AT='a'*40

class SystemTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.app=Application(str(Path(self.temp.name)/'test.sqlite'),[
            dict(token=ST,role='student',terminal='room'),dict(token=AT,role='admin',terminal='room')],[ADMIN])
        self.cmd('create|oct|October 2026')
        self.cmd('cohort|oct')
        self.cmd('week|1')

    def tearDown(self):
        self.temp.cleanup()

    def cmd(self,command,actor=ADMIN,token=AT):
        return self.app.dispatch('/v1/admin/command',token,dict(request_id=str(uuid4()),terminal='room',actor=actor,command=command))

    def student(self,avatar=A,**extra):
        return dict(request_id=str(uuid4()),terminal='room',avatar=avatar,legacy='Student Resident',display='Student',**extra)

    def check(self,avatar=A):
        return self.app.dispatch('/v1/check-in',ST,self.student(avatar))

    def individual(self,avatar=A,station=1,override='NORMAL'):
        return self.cmd(f'individual|oct|{station}|{avatar}|Student Resident|Student|{override}')

    def test_couple_shared_station_independent_attendance(self):
        self.cmd(f'couple|oct|2|{A}|A Resident|A|{B}|B Resident|B|NORMAL')
        self.cmd('open')
        self.check(A)
        self.assertIn('Not checked in: 1',self.cmd('course')['message'])
        self.cmd(f'station|oct|{A}|3|NORMAL')
        self.assertIn('Station: 3',self.check(B)['message'])
        self.assertIn('Station: 3',self.check(A)['message'])

    def test_station_conflict_override_and_reactivation(self):
        self.individual()
        with self.assertRaises(Error): self.individual(B)
        self.individual(B,override='OVERRIDE')
        self.cmd(f'status|oct|{A}|Withdrawn|NORMAL')
        with self.assertRaises(Error): self.cmd(f'status|oct|{A}|Active|NORMAL')
        self.cmd(f'status|oct|{A}|Active|OVERRIDE')

    def test_closed_missing_week_and_cohort_switch(self):
        self.individual()
        with self.assertRaises(Error): self.check()
        self.cmd('open')
        self.check()
        self.cmd('create|nov|November 2026')
        self.cmd('cohort|nov')
        with self.assertRaises(Error): self.cmd('open')
        with self.assertRaises(Error): self.check()
        self.cmd('week|2')
        self.cmd('open')
        with self.assertRaises(Error): self.check()
        self.assertIn('Present',self.cmd(f'student|oct|{A}')['message'])

    def test_security(self):
        with self.assertRaises(Error): self.cmd('open',actor=A)
        with self.assertRaises(Error): self.cmd('open',token=ST)
        with self.assertRaises(Error): self.cmd('open',token='wrong')
        body=self.student(); body['terminal']='other'
        with self.assertRaises(Error): self.app.dispatch('/v1/check-in',ST,body)

    def test_concurrent_checkin_and_audit(self):
        self.individual(); self.cmd('open')
        with ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda _: self.check(),range(16)))
        self.assertEqual(sum(not r['duplicate'] for r in results),1)
        with closing(self.app.db.connect()) as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM audit WHERE action='attendance'").fetchone()[0],1)

    def test_corrections_keep_history(self):
        self.individual(); self.cmd('open'); self.check()
        self.cmd(f'mark|oct|{A}|1|Absent')
        self.cmd(f'mark|oct|{A}|1|Unmarked')
        self.cmd(f'mark|oct|{A}|1|Present')
        with closing(self.app.db.connect()) as con:
            rows=con.execute("SELECT * FROM audit WHERE action='attendance'").fetchall()
            self.assertEqual(len(rows),4)
            self.assertEqual(rows[-1]['admin'],ADMIN)
            with self.assertRaises(Exception): con.execute('DELETE FROM audit')
        self.assertIn('Manual/Admin',self.cmd(f'history|oct|{A}|0')['message'])

    def test_idempotent_request_and_mismatched_reuse(self):
        self.individual(); self.cmd('open')
        data=self.student()
        first=self.app.dispatch('/v1/check-in',ST,data)
        self.assertEqual(first,self.app.dispatch('/v1/check-in',ST,data))
        data['avatar']=B
        with self.assertRaises(Error): self.app.dispatch('/v1/check-in',ST,data)

    def test_couple_failure_is_atomic(self):
        with self.assertRaises(Error): self.cmd(f'couple|oct|1|{A}|A|A|{A}|A|A|NORMAL')
        self.individual()
        with closing(self.app.db.connect()) as con:
            self.assertEqual(con.execute('SELECT COUNT(*) FROM reservations').fetchone()[0],1)

    def test_rename_and_completed_student(self):
        self.individual(); self.cmd('title|oct|1|Knife Skills'); self.cmd('open')
        self.assertIn('Knife Skills',self.check()['message'])
        self.cmd(f'status|oct|{A}|Completed|NORMAL')
        with self.assertRaises(Error): self.check()
        record=json.loads(self.cmd(f'student|oct|{A}')['message'])
        self.assertIsNone(record['enrollment']['graduation_eligible'])

    def test_http_clean_errors(self):
        for raw,token,status in [(b'{',AT,400),(b'[]',AT,400),(b'{}','bad',401)]:
            captured=[]
            response=self.app(dict(REQUEST_METHOD='POST',CONTENT_TYPE='application/json',CONTENT_LENGTH=str(len(raw)),PATH_INFO='/v1/admin/command',HTTP_X_PLATE_TOKEN=token,**{'wsgi.input':io.BytesIO(raw)}),lambda s,h:captured.append(s))
            self.assertTrue(captured[0].startswith(str(status)))
            self.assertFalse(json.loads(b''.join(response))['ok'])

    def test_concurrent_station_reservations(self):
        def enroll(avatar):
            try: self.individual(avatar); return True
            except Error: return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sum(pool.map(enroll,[A,B])),1)

    def test_invalid_station_and_week(self):
        for station in (0,7,'1.0'):
            with self.assertRaises(Error): self.individual(station=station)
        for week in (0,5):
            with self.assertRaises(Error): self.cmd(f'week|{week}')

if __name__=='__main__': unittest.main()
