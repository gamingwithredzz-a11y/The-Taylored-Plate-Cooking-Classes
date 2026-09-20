import hashlib
import hmac
import json
import logging
import os
import sqlite3
from .common import Error, uid, clean
from .db import Database
from .attendance import checkin
from .admin import command

class Application:
    def __init__(self, path, devices, admins):
        self.db = Database(path)
        self.devices = devices
        self.admins = {uid(a) for a in admins}
        if not self.admins or not devices:
            raise ValueError('At least one admin and one device required.')
        tokens = []
        for device in devices:
            if device['role'] not in ('student','admin') or len(device['token']) < 32:
                raise ValueError('Devices need role student/admin and unique tokens of at least 32 characters.')
            clean(device['terminal'])
            tokens.append(device['token'])
        if len(set(tokens)) != len(tokens):
            raise ValueError('Device tokens must be unique.')

    def dispatch(self, path, token, data):
        device=next((d for d in self.devices if hmac.compare_digest(token,d['token'])),None)
        if not device:
            raise Error('Unauthorized device.',401)
        if not isinstance(data,dict):
            raise Error('JSON object required.')
        if data.get('terminal') != device['terminal']:
            raise Error('Device is not authorized for this terminal.',403)
        actor = None
        if path == '/v1/admin/command':
            if device['role'] != 'admin':
                raise Error('Admin device required.',403)
            actor=uid(data.get('actor'))
            if actor not in self.admins:
                raise Error('Unauthorized instructor.',403)
        elif path == '/v1/check-in':
            if device['role'] != 'student':
                raise Error('Student device required.',403)
        else:
            raise Error('Endpoint not found.',404)
        request_id=uid(data.get('request_id'))
        fingerprint=hashlib.sha256((path+token+json.dumps(data,sort_keys=True)).encode()).hexdigest()
        with self.db.transaction() as con:
            previous=con.execute('SELECT * FROM requests WHERE id=?',(request_id,)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint:
                    raise Error('Request ID reused with different content.',409)
                return json.loads(previous['response'])
            if actor:
                result=dict(message=command(con,actor,device['terminal'],data.get('command')))
            else:
                result=checkin(con,data)
            result['ok']=True
            # Keep responses inside Mono HTTP limits; large data is accessed in pages.
            if len(json.dumps(result,ensure_ascii=False).encode()) > 15000:
                raise Error('Response too large. Narrow the query.')
            con.execute('INSERT INTO requests VALUES(?,?,?)',(request_id,fingerprint,json.dumps(result)))
            return result

    def __call__(self, env, start_response):
        status=200
        try:
            if env.get('REQUEST_METHOD') != 'POST':
                raise Error('Use POST.',405)
            if env.get('CONTENT_TYPE','').split(';')[0] != 'application/json':
                raise Error('Content-Type must be application/json.',415)
            try:
                length=int(env.get('CONTENT_LENGTH','0'))
            except ValueError:
                raise Error('Invalid Content-Length.')
            if not 0 < length <= 8192:
                raise Error('Request body must be 1-8192 bytes.',413)
            try:
                data=json.loads(env['wsgi.input'].read(length))
            except (ValueError,UnicodeError):
                raise Error('Invalid JSON.')
            result=self.dispatch(env.get('PATH_INFO',''),env.get('HTTP_X_PLATE_TOKEN',''),data)
        except Error as e:
            status,result=e.status,dict(ok=False,message=e.message)
        except sqlite3.IntegrityError:
            status,result=409,dict(ok=False,message='Record conflicts with existing data.')
        except Exception:
            logging.exception('Backend request failed')
            status,result=503,dict(ok=False,message='Backend temporarily unavailable. Please try again.')
        body=json.dumps(result,ensure_ascii=False).encode('utf-8')
        start_response(f'{status} Response',[('Content-Type','application/json; charset=utf-8'),('Content-Length',str(len(body))),('Cache-Control','no-store')])
        return [body]

def from_environment():
    return Application(os.environ.get('PLATE_DB','plate.sqlite3'),json.loads(os.environ['PLATE_DEVICES']),os.environ['PLATE_ADMINS'].split(','))
