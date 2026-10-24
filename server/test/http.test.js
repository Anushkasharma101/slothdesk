import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createApp} from '../src/app.js';
const app=createApp({storage:'/tmp/unused-sloth-storage',origin:'http://localhost:5173',rateLimits:false});
test('public health reports disconnected database without exposing private config',async()=>{const r=await request(app).get('/api/health').expect(503);assert.deepEqual(r.body,{ok:false});});
test('private APIs reject unsigned requests and cross-origin writes',async()=>{await request(app).get('/api/jobs').expect(401);await request(app).post('/api/auth/register').set('Origin','https://another.example').send({}).expect(403);});
test('malformed credentials return JSON validation errors and security headers',async()=>{const r=await request(app).post('/api/auth/register').set('Origin','http://localhost:5173').send({name:'A',email:'bad',password:'short'}).expect(400);assert.match(r.body.error,/valid email/);assert.ok(r.headers['content-security-policy']);assert.equal(r.headers['x-content-type-options'],'nosniff');assert.equal(r.headers['cache-control'],'no-store');});
