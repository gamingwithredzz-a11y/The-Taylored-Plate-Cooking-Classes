from .common import Error, uid, clean, number, now, audit

def mark(con, cohort, avatar, week, status, admin=None):
    avatar, week = uid(avatar), number(week, 1, 4)
    if status not in ('Present', 'Absent', 'Unmarked'):
        raise Error('Use Present, Absent, or Unmarked.')
    if not con.execute('SELECT 1 FROM enrollments WHERE cohort=? AND avatar=?', (cohort, avatar)).fetchone():
        raise Error('Student not found.', 404)
    old = con.execute('SELECT * FROM attendance WHERE cohort=? AND avatar=? AND week=?', (cohort, avatar, week)).fetchone()
    if old and old['status'] == status:
        return False
    record = dict(cohort=cohort, avatar=avatar, week=week, status=status, checked_at=now() if status == 'Present' else None, source='Manual/Admin' if admin else 'Student', admin=admin)
    con.execute('INSERT INTO attendance VALUES(:cohort,:avatar,:week,:status,:checked_at,:source,:admin) ON CONFLICT(cohort,avatar,week) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,source=excluded.source,admin=excluded.admin', record)
    audit(con, admin, 'attendance', dict(before=dict(old) if old else None, after=record))
    return True

def checkin(con, data):
    avatar = uid(data.get('avatar'))
    clean(data.get('legacy'))
    terminal = con.execute('SELECT * FROM terminals WHERE id=?', (clean(data.get('terminal')),)).fetchone()
    if not terminal or not terminal['cohort']:
        raise Error('No active cohort. Please see an instructor.', 409)
    if not terminal['week']:
        raise Error('No active week. Please see an instructor.', 409)
    if not terminal['opened']:
        raise Error('Check-in is closed. Please see an instructor.', 409)
    student = con.execute('''SELECT a.display,r.station FROM enrollments e JOIN avatars a ON a.uuid=e.avatar
        JOIN reservations r ON r.id=e.reservation WHERE e.cohort=? AND e.avatar=? AND e.status='Active' ''', (terminal['cohort'], avatar)).fetchone()
    if not student:
        raise Error("We couldn't find an active enrollment for you.\n\nPlease see a Taylored Plate instructor for assistance.", 404)
    station = student['station']
    changed = mark(con, terminal['cohort'], avatar, terminal['week'], 'Present')
    if not changed:
        return dict(message=f"You're already checked in for today's class.\n\nCooking Station: {station}", duplicate=True)
    title = con.execute('SELECT title FROM weeks WHERE cohort=? AND week=?', (terminal['cohort'], terminal['week'])).fetchone()[0]
    display = data.get('display') or student['display']
    display = clean(display)
    return dict(message=f"THE TAYLORED PLATE\nCOOKING CLASS CHECK-IN\n\nWelcome, {display}.\n\nYou're checked in for:\n\nWeek {terminal['week']}: {title}\n\nCooking Station: {station}\n\nEnjoy today's class!", duplicate=False)
