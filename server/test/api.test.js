import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import yauzl from 'yauzl';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {createApp} from '../src/app.js';
import {User,Session,Job,Summary,Slots} from '../src/models.js';
import {reconcile,cleanup} from '../src/storage.js';
let mongo,storage,app,a,b,csrfA,csrfB;
const origin='http://localhost:5173';
before(async()=>{
 mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri());await Promise.all([User.init(),Session.init(),Job.init(),Summary.init(),Slots.init()]);await reconcile();storage=await fs.mkdtemp(path.join(os.tmpdir(),'sloth-public-'));app=createApp({storage,origin,rateLimits:false});a=request.agent(app);b=request.agent(app);
 const first=await a.post('/api/auth/register').set('Origin',origin).send({name:'Alice',email:'alice@example.com',password:'a-secure-password-123'}).expect(201);csrfA=first.body.csrf;
 const second=await b.post('/api/auth/register').set('Origin',origin).send({name:'Bob',email:'bob@example.com',password:'another-password-123'}).expect(201);csrfB=second.body.csrf;
});
after(async()=>{await mongoose.disconnect();await mongo?.stop();if(storage)await fs.rm(storage,{recursive:true,force:true});});
function upload(agent,csrf,paths=['Photos/Report.txt','Photos/Report copy.txt']){let req=agent.post('/api/jobs').set('Origin',origin).set('X-CSRF-Token',csrf).field('name','Test upload').field('paths',JSON.stringify(paths));for(const name of paths)req=req.attach('files',Buffer.from('same document bytes'),{filename:path.basename(name)});return req;}
async function zipNames(buffer){return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(err,zip)=>{if(err)return reject(err);const names=[];zip.on('entry',e=>{names.push(e.fileName);zip.readEntry();});zip.on('error',reject);zip.on('end',()=>resolve(names));zip.readEntry();}));}
test('health, cookie authentication, session reload, login and logout work',async()=>{
 await request(app).get('/api/health').expect(200);await request(app).get('/api/jobs').expect(401);
 const me=await a.get('/api/auth/me').expect(200);assert.equal(me.body.user.email,'alice@example.com');assert.equal(me.body.csrf,csrfA);assert.equal(me.body.user.passwordHash,undefined);
 await request(app).post('/api/auth/login').set('Origin',origin).send({email:'alice@example.com',password:'incorrect-password'}).expect(401);
 const agent=request.agent(app);const login=await agent.post('/api/auth/login').set('Origin',origin).send({email:'alice@example.com',password:'a-secure-password-123'}).expect(200);assert.match(login.headers['set-cookie'][0],/HttpOnly/);await agent.post('/api/auth/logout').set('Origin',origin).set('X-CSRF-Token',login.body.csrf).expect(200);await agent.get('/api/jobs').expect(401);
});
test('origin and CSRF checks reject mutations before touching user data',async()=>{
 await a.put('/api/settings').set('Origin','https://attacker.example').set('X-CSRF-Token',csrfA).send({dailyDigest:false}).expect(403);
 await a.put('/api/settings').set('Origin',origin).send({dailyDigest:false}).expect(403);
 await a.put('/api/settings').set('Origin',origin).set('X-CSRF-Token',csrfA).send({dailyDigest:false}).expect(200);
});
test('upload, owner isolation, reviewed ZIP bytes, summaries, and deletion',async()=>{
 const res=await upload(a,csrfA).expect(201),job=res.body;assert.equal(job.files.length,2);assert.equal(job.files[0].storedName,undefined);assert.equal(job.exactGroups.length,1);assert.equal(new Set(job.files.map(f=>f.suggestedPath)).size,2);
 const other=await b.get('/api/jobs').expect(200);assert.equal(other.body.length,0);
 await b.get(`/api/jobs/${job._id}/download`).expect(404);
 await b.put(`/api/jobs/${job._id}/plan`).set('Origin',origin).set('X-CSRF-Token',csrfB).send({choices:job.files.map(f=>({id:f.id,include:true,organize:false}))}).expect(404);
 await b.delete(`/api/jobs/${job._id}`).set('Origin',origin).set('X-CSRF-Token',csrfB).expect(404);
 const choices=job.files.map((f,i)=>({id:f.id,include:i===0,organize:true}));await a.put(`/api/jobs/${job._id}/plan`).set('Origin',origin).set('X-CSRF-Token',csrfA).send({choices}).expect(200);
 const zip=await a.get(`/api/jobs/${job._id}/download`).buffer(true).parse((res,cb)=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>cb(null,Buffer.concat(chunks)));}).expect(200);assert.deepEqual(await zipNames(zip.body),['Documents/report.txt']);
 const digest=await a.get('/api/summaries').expect(200);assert.equal(digest.body[0].metrics.files,2);assert.equal((await b.get('/api/summaries')).body.length,0);
 await a.delete(`/api/jobs/${job._id}`).set('Origin',origin).set('X-CSRF-Token',csrfA).expect(200);await assert.rejects(fs.stat(path.join(storage,job._id)));assert.equal(await Job.countDocuments(),0);assert.equal((await User.findOne({email:'alice@example.com'})).jobCount,0);
});
test('invalid manifests and oversize files leave no retained bytes or quota slots',async()=>{
 await upload(a,csrfA,['../secret.txt']).expect(400);
 await a.post('/api/jobs').set('Origin',origin).set('X-CSRF-Token',csrfA).field('paths','["large.bin"]').attach('files',Buffer.alloc(10*1024*1024+1),{filename:'large.bin'}).expect(413);
 assert.equal(await Job.countDocuments(),0);assert.equal((await Slots.findById('global')).value,0);assert.deepEqual(await fs.readdir(storage),[]);
});
test('per-user quotas and expiry prevent reads and remove disk copies',async()=>{
 const j=(await upload(a,csrfA,['a.txt']).expect(201)).body;
 await User.updateOne({email:'alice@example.com'},{$set:{jobCount:5}});await upload(a,csrfA,['extra.txt']).expect(429);await reconcile();
 await Job.updateOne({_id:j._id},{$set:{expiresAt:new Date(Date.now()-1000)}});await a.get(`/api/jobs/${j._id}/download`).expect(404);await cleanup(storage);assert.equal(await Job.countDocuments(),0);assert.deepEqual(await fs.readdir(storage),[]);assert.equal((await Slots.findById('global')).value,0);
});
