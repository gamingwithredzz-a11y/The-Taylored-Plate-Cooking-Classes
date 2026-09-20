from uuid import uuid4
from .common import Error, uid, clean, number, now, audit, cohort_exists

def vacancy(con, cohort, station, exclude=None, override=False):
    occupied = con.execute('''SELECT 1 FROM enrollments e JOIN reservations r ON r.id=e.reservation
        WHERE e.cohort=? AND r.station=? AND e.status='Active' AND r.id<>? LIMIT 1''', (cohort, station, exclude or '')).fetchone()
    if occupied and not override:
        raise Error('Station occupied. Use explicit OVERRIDE only if deliberate.', 409)

def enroll(con, admin, cohort, station, people, override=False):
    cohort_exists(con, cohort)
    station = number(station, 1, 6)
    if len(people) not in (1, 2):
        raise Error('Provide one individual or two partners.')
    people = [(uid(p[0]), clean(p[1]), clean(p[2] or p[1])) for p in people]
    if len(set(p[0] for p in people)) != len(people):
        raise Error('Partners must be different avatars.')
    for avatar, _, _ in people:
        if con.execute('SELECT 1 FROM enrollments WHERE cohort=? AND avatar=?', (cohort, avatar)).fetchone():
            raise Error('Avatar already has enrollment in this cohort; update status instead.', 409)
    vacancy(con, cohort, station, override=override)
    reservation = str(uuid4())
    con.execute('INSERT INTO reservations VALUES(?,?,?,?)', (reservation, cohort, station, 'Couple' if len(people) == 2 else 'Individual'))
    for avatar, legacy, display in people:
        con.execute('INSERT INTO avatars VALUES(?,?,?) ON CONFLICT(uuid) DO UPDATE SET legacy=excluded.legacy,display=excluded.display', (avatar, legacy, display))
    for i, (avatar, _, _) in enumerate(people):
        partner = people[1-i][0] if len(people) == 2 else None
        con.execute('INSERT INTO enrollments(cohort,avatar,reservation,partner,status,enrolled) VALUES(?,?,?,?,?,?)', (cohort, avatar, reservation, partner, 'Active', now()))
    audit(con, admin, 'enroll', dict(cohort=cohort, reservation=reservation, people=people, station=station, override=override))
    return 'Enrollment saved.'

def change(con, admin, cohort, avatar, station=None, status=None, override=False):
    avatar = uid(avatar)
    row = con.execute('SELECT e.*,r.station FROM enrollments e JOIN reservations r ON r.id=e.reservation WHERE e.cohort=? AND e.avatar=?', (cohort, avatar)).fetchone()
    if not row:
        raise Error('Student not found.', 404)
    if station is not None:
        station = number(station, 1, 6)
        vacancy(con, cohort, station, row['reservation'], override)
        con.execute('UPDATE reservations SET station=? WHERE id=?', (station, row['reservation']))
    if status is not None:
        if status not in ('Active', 'Completed', 'Withdrawn'):
            raise Error('Status must be Active, Completed, or Withdrawn.')
        if status == 'Active':
            vacancy(con, cohort, row['station'], row['reservation'], override)
        con.execute('UPDATE enrollments SET status=? WHERE cohort=? AND avatar=?', (status, cohort, avatar))
    audit(con, admin, 'enrollment_change', dict(before=dict(row), station=station, status=status, override=override))
    return 'Enrollment updated. Station changes apply to both partners.'
