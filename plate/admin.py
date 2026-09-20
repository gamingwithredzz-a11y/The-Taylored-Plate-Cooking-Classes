import json
from .common import Error, clean, number, uid, now, audit, cohort_exists
from .enrollment import enroll, change
from .attendance import mark

TITLES = ['Orientation & Fundamentals', 'Building Skills', 'The Complete Meal', 'Final Kitchen & Graduation']

def command(con, actor, terminal, text):
    parts = [p.strip() for p in clean(text, 2000).split('|')]
    op, args = parts[0].lower(), parts[1:]
    def count(n):
        if len(args) != n:
            raise Error('Wrong number of fields. See README command reference.')
    result = None
    if op == 'create':
        count(2)
        cohort, name = clean(args[0], 40), clean(args[1])
        con.execute('INSERT INTO cohorts VALUES(?,?,?)', (cohort, name, now()))
        con.executemany('INSERT INTO weeks VALUES(?,?,?)', [(cohort, i+1, t) for i,t in enumerate(TITLES)])
        result = 'Cohort created.'
    elif op == 'cohorts':
        count(1)
        page = number(args[0], 0, 100000)
        result = '\n'.join(f"{r['id']}: {r['name']}" for r in con.execute('SELECT * FROM cohorts ORDER BY created,id LIMIT 5 OFFSET ?', (page*5,))) or 'No cohorts on this page.'
    elif op in ('cohort', 'week', 'open', 'close'):
        count(0 if op in ('open','close') else 1)
        con.execute('INSERT OR IGNORE INTO terminals(id) VALUES(?)', (terminal,))
        if op == 'cohort':
            cohort_exists(con, args[0])
            con.execute('UPDATE terminals SET cohort=?,week=NULL,opened=0 WHERE id=?', (args[0],terminal))
        elif op == 'week':
            con.execute('UPDATE terminals SET week=?,opened=0 WHERE id=?', (number(args[0],1,4),terminal))
        elif op == 'open':
            row = con.execute('SELECT * FROM terminals WHERE id=?', (terminal,)).fetchone()
            if not row['cohort'] or not row['week']:
                raise Error('Select cohort and week before opening.')
            con.execute('UPDATE terminals SET opened=1 WHERE id=?', (terminal,))
        else:
            con.execute('UPDATE terminals SET opened=0 WHERE id=?', (terminal,))
        result = 'Course configuration saved.'
    elif op == 'title':
        count(3)
        cohort_exists(con,args[0])
        con.execute('UPDATE weeks SET title=? WHERE cohort=? AND week=?', (clean(args[2]),args[0],number(args[1],1,4)))
        result = 'Week title saved.'
    elif op in ('individual','couple'):
        count(6 if op == 'individual' else 9)
        if args[-1] not in ('NORMAL','OVERRIDE'):
            raise Error('Last field must be NORMAL or OVERRIDE.')
        people = [args[2:5]] if op == 'individual' else [args[2:5],args[5:8]]
        result = enroll(con, actor, args[0], args[1], people, args[-1]=='OVERRIDE')
    elif op in ('station','status'):
        count(4)
        if args[3] not in ('NORMAL','OVERRIDE'):
            raise Error('Last field must be NORMAL or OVERRIDE.')
        result = change(con, actor,args[0],args[1], **{op:args[2]},override=args[3]=='OVERRIDE')
    elif op == 'mark':
        count(4)
        mark(con,args[0],args[1],args[2],args[3],actor)
        result = 'Attendance saved.'
    elif op == 'course':
        count(0)
        t = con.execute('SELECT t.*,c.name,w.title FROM terminals t LEFT JOIN cohorts c ON c.id=t.cohort LEFT JOIN weeks w ON w.cohort=t.cohort AND w.week=t.week WHERE t.id=?',(terminal,)).fetchone()
        if not t:
            return 'No active cohort.'
        enrolled = con.execute("SELECT COUNT(*) FROM enrollments WHERE cohort=? AND status='Active'",(t['cohort'],)).fetchone()[0]
        present = con.execute("SELECT COUNT(*) FROM attendance a JOIN enrollments e ON e.cohort=a.cohort AND e.avatar=a.avatar WHERE a.cohort=? AND a.week=? AND a.status='Present' AND e.status='Active'",(t['cohort'],t['week'])).fetchone()[0]
        return f"Cohort: {t['name']} ({t['cohort']})\nWeek: {t['week']} - {t['title']}\nCheck-in open: {bool(t['opened'])}\nEnrolled: {enrolled}\nChecked in: {present}\nNot checked in: {enrolled-present}"
    elif op == 'roster':
        count(3)
        cohort_exists(con,args[0])
        week,page = number(args[1],1,4),number(args[2],0,100000)
        rows = con.execute('''SELECT a.display,e.avatar,e.status,r.station,r.type,COALESCE(t.status,'Unmarked') attendance
            FROM enrollments e JOIN avatars a ON a.uuid=e.avatar JOIN reservations r ON r.id=e.reservation
            LEFT JOIN attendance t ON t.cohort=e.cohort AND t.avatar=e.avatar AND t.week=?
            WHERE e.cohort=? ORDER BY r.station,e.avatar LIMIT 5 OFFSET ?''',(week,args[0],page*5))
        title = con.execute('SELECT title FROM weeks WHERE cohort=? AND week=?',(args[0],week)).fetchone()[0]
        return f'Week {week}: {title}\n' + ('\n'.join(f"{r['attendance']} - {r['display']} - Station {r['station']} ({r['type']}, {r['status']})\n{r['avatar']}" for r in rows) or 'No students on this page.')
    elif op == 'stations':
        count(2)
        cohort_exists(con,args[0])
        station=number(args[1],1,6)
        rows = con.execute("SELECT a.display,r.type FROM enrollments e JOIN avatars a ON a.uuid=e.avatar JOIN reservations r ON r.id=e.reservation WHERE e.cohort=? AND r.station=? AND e.status='Active' ORDER BY e.avatar",(args[0],station)).fetchall()
        return f'STATION {station}\n' + ('\n'.join(f"{r['display']} - {r['type']}" for r in rows) or 'AVAILABLE')
    elif op in ('student','history'):
        count(2 if op=='student' else 3)
        avatar=uid(args[1])
        row=con.execute('SELECT e.*,a.legacy,a.display,r.station,r.type FROM enrollments e JOIN avatars a ON a.uuid=e.avatar JOIN reservations r ON r.id=e.reservation WHERE e.cohort=? AND e.avatar=?',(args[0],avatar)).fetchone()
        if not row:
            raise Error('Student not found.',404)
        if op=='student':
            attendance=[dict(r) for r in con.execute('SELECT * FROM attendance WHERE cohort=? AND avatar=? ORDER BY week',(args[0],avatar))]
            return json.dumps(dict(enrollment=dict(row),attendance=attendance),ensure_ascii=False)
        page=number(args[2],0,100000)
        rows=con.execute("SELECT * FROM audit WHERE action='attendance' AND json_extract(payload,'$.after.cohort')=? AND json_extract(payload,'$.after.avatar')=? ORDER BY id DESC LIMIT 3 OFFSET ?",(args[0],avatar,page*3))
        return '\n'.join(json.dumps(dict(r),ensure_ascii=False) for r in rows) or 'No history on this page.'
    else:
        raise Error('Unknown command. See README command reference.')
    if op not in ('individual','couple','station','status','mark','cohorts'):
        audit(con,actor,op,dict(terminal=terminal,args=args))
    return result
