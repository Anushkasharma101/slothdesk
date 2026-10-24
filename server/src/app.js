import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import archiver from 'archiver';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {User,Session,Job,Summary} from './models.js';
import {authenticate,validateCredentials,passwordHash,verifyPassword,createSession,cookieOptions,publicUser} from './auth.js';
import {category,cleanName,safeOriginal,hash,groups,uniquePaths,exportEntries,metrics} from './organizer.js';
import {enhance} from './ai.js';
import {LIMITS,locks,jobDir,diskStorage,reserve,unreserve,removeJob,makeSummary} from './storage.js';
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function jobQuery(owner,id){return {_id:id,owner,state:'ready',expiresAt:{$gt:new Date()}};}
export function publicJob(j){const o=j.toObject?j.toObject():j;return {...o,owner:undefined,files:o.files.map(({storedName,...f})=>f),exportEntries:exportEntries(o.files).map(({storedName,...e})=>e)};}
export function createApp({storage,origin,production=false,trustProxy=0,rateLimits=true}){
 const app=express();app.disable('x-powered-by');if(trustProxy)app.set('trust proxy',trustProxy);
 app.use(helmet({contentSecurityPolicy:{directives:{'default-src':["'self'"],'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],'font-src':["'self'",'https://fonts.gstatic.com'],'img-src':["'self'",'data:'],'connect-src':["'self'"],'object-src':["'none'"],'frame-ancestors':["'none'"],'upgrade-insecure-requests':production?[]:null}},strictTransportSecurity:production?undefined:false}));
 app.use(cookieParser());app.use(express.json({limit:'64kb'}));
 app.get('/api/health',(req,res)=>res.status(mongoose.connection.readyState===1?200:503).json({ok:mongoose.connection.readyState===1}));
 if(rateLimits)app.use('/api',rateLimit({windowMs:60000,limit:200,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many requests; try again in a minute.'}}));
 // Strict same-origin mutation checks also protect login/register before a session exists.
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('origin')!==origin)return res.status(403).json({error:'Request origin is not allowed. Use the configured APP_ORIGIN URL.'});next();});
 const authLimiter=rateLimits?rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many sign-in attempts. Wait 15 minutes.'}}):(req,res,next)=>next();
 app.post('/api/auth/register',authLimiter,route(async(req,res)=>{const {email,password,name}=validateCredentials(req.body,true);const salt=randomBytes(16).toString('hex');const user=await User.create({email,name,salt,passwordHash:await passwordHash(password,salt)});const csrf=await createSession(res,user,production);res.status(201).json({user:publicUser(user),csrf});}));
 app.post('/api/auth/login',authLimiter,route(async(req,res)=>{const {email,password}=validateCredentials(req.body);const user=await User.findOne({email}).select('+salt +passwordHash');if(!await verifyPassword(password,user))throw fail('Incorrect email or password.',401);const csrf=await createSession(res,user,production);res.json({user:publicUser(user),csrf});}));
 app.use('/api',authenticate);
 app.get('/api/auth/me',(req,res)=>res.json({user:publicUser(req.user),csrf:req.session.csrf,limits:LIMITS}));
 app.post('/api/auth/logout',route(async(req,res)=>{await Session.deleteOne({_id:req.session._id});res.clearCookie('sloth_session',{...cookieOptions(production),maxAge:undefined});res.json({ok:true});}));
 app.put('/api/settings',route(async(req,res)=>{if(typeof req.body.dailyDigest!=='boolean')throw fail('dailyDigest must be boolean.');req.user.dailyDigest=req.body.dailyDigest;await req.user.save();res.json({user:publicUser(req.user)});}));
 const owned=async req=>{if(!mongoose.isValidObjectId(req.params.id))throw fail('Upload not found.',404);const j=await Job.findOne(jobQuery(req.user._id,req.params.id));if(!j)throw fail('Upload not found or expired.',404);return j;};
 app.get('/api/jobs',route(async(req,res)=>{const jobs=await Job.find({owner:req.user._id,state:'ready',expiresAt:{$gt:new Date()}}).sort({createdAt:-1});res.json(jobs.map(publicJob));}));
 let uploads=0;
 const upload=multer({storage:diskStorage(),limits:{files:LIMITS.files,fileSize:LIMITS.fileBytes,fields:2,fieldSize:64*1024,parts:LIMITS.files+2}}).array('files',LIMITS.files);
 app.post('/api/jobs',route(async(req,res)=>{
 if(uploads>=LIMITS.concurrentUploads)throw fail('Other uploads are processing. Please retry shortly.',503);
 uploads++;let reserved=false,job,success=false;
 try{
 await reserve(req.user._id);reserved=true;
 job=await Job.create({owner:req.user._id,name:'Upload',expiresAt:new Date(Date.now()+LIMITS.retentionHours*3600000)});
 locks.add(String(job._id));req.uploadDir=jobDir(storage,job._id);req.uploadBytes=0;await fs.mkdir(req.uploadDir,{mode:0o700});
 await new Promise((resolve,reject)=>upload(req,res,e=>e?reject(e):resolve()));
 if(!req.files?.length)throw fail('Choose at least one file.');
 let paths;try{paths=JSON.parse(req.body.paths);}catch{throw fail('Upload manifest is missing or invalid.');}
 if(!Array.isArray(paths)||paths.length!==req.files.length)throw fail('Upload manifest does not match the files.');
 const name=typeof req.body.name==='string'?req.body.name.trim().slice(0,80):'';job.name=name||'My upload';
 const files=[];for(let i=0;i<req.files.length;i++){const file=req.files[i],originalPath=(()=>{try{return safeOriginal(paths[i]);}catch(e){throw fail(e.message);}})(),name=path.posix.basename(originalPath);files.push({id:randomUUID(),storedName:file.filename,originalPath,name,size:file.size,hash:await hash(file.path),category:category(name),suggestedName:cleanName(name),source:'rules',include:true,organize:true});}
 const ai=await enhance(files);uniquePaths(files);Object.assign(job,groups(files));job.files=files;job.mode=ai.mode;job.warnings=ai.warning?[ai.warning]:[];job.state='ready';await job.save();success=true;
 // A summary failure must not discard an otherwise completed upload.
 await makeSummary(req.user._id,metrics(await Job.find({owner:req.user._id,state:'ready',expiresAt:{$gt:new Date()}}))).catch(e=>console.error('Summary:',e.message));
 res.status(201).json(publicJob(job));
 }finally{
 uploads--;if(job)locks.delete(String(job._id));
 if(!success){if(job){await removeJob(storage,job);}else if(reserved)await unreserve(req.user._id);}
 }
 }));
 app.put('/api/jobs/:id/plan',route(async(req,res)=>{const job=await owned(req);const key=String(job._id);if(locks.has(key))throw fail('Upload is busy.',409);locks.add(key);try{const choices=req.body.choices;if(!Array.isArray(choices)||choices.length!==job.files.length||new Set(choices.map(c=>c?.id)).size!==job.files.length)throw fail('Provide one choice for every file.');for(const f of job.files){const c=choices.find(c=>c?.id===f.id);if(!c||typeof c.include!=='boolean'||typeof c.organize!=='boolean')throw fail('Invalid review choices.');f.include=c.include;f.organize=c.organize;}await job.save();res.json(publicJob(job));}finally{locks.delete(key);}}));
 app.get('/api/jobs/:id/download',route(async(req,res)=>{
 const job=await owned(req),key=String(job._id);if(locks.has(key))throw fail('Upload is busy.',409);locks.add(key);
 try{
 const entries=exportEntries(job.files);if(!entries.length)throw fail('Include at least one file in your download.');
 // Files stay private, and only database-controlled generated storage names are opened.
 for(const e of entries){if(!/^[a-f0-9-]{36}$/.test(e.storedName))throw fail('Invalid stored file.',500);const stat=await fs.stat(path.join(jobDir(storage,job._id),e.storedName)).catch(()=>null);if(!stat?.isFile())throw fail('Upload data is unavailable. Please upload the files again.',410);}
 res.attachment('slothdesk-organized.zip');res.set('Cache-Control','no-store');
 const archive=archiver('zip',{zlib:{level:5}});
 await new Promise((resolve,reject)=>{
 const finish=()=>{archive.abort();resolve();};res.once('close',finish);res.once('finish',resolve);
 archive.once('error',e=>{if(res.headersSent)res.destroy(e);reject(e);});archive.once('warning',e=>{archive.abort();if(res.headersSent)res.destroy(e);reject(e);});
 archive.pipe(res);for(const e of entries)archive.file(path.join(jobDir(storage,job._id),e.storedName),{name:e.name,date:job.createdAt});archive.finalize().catch(reject);
 });
 }finally{locks.delete(key);}
 }));
 app.delete('/api/jobs/:id',route(async(req,res)=>{const j=await owned(req);await removeJob(storage,j);res.json({ok:true});}));
 app.get('/api/summaries',route(async(req,res)=>res.json(await Summary.find({owner:req.user._id,expiresAt:{$gt:new Date()}}).sort({day:-1}).limit(30))));
 app.post('/api/summaries',route(async(req,res)=>{const jobs=await Job.find({owner:req.user._id,state:'ready',expiresAt:{$gt:new Date()}});res.json(await makeSummary(req.user._id,metrics(jobs)));}));
 app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));
 const dist=fileURLToPath(new URL('../../client/dist',import.meta.url));app.use(express.static(dist));app.get('*',route(async(req,res)=>{try{await fs.access(path.join(dist,'index.html'));}catch{throw fail('Frontend build is missing. Run npm run build or use the Vite development URL.',503);}res.sendFile(path.join(dist,'index.html'));}));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.code===11000)return res.status(409).json({error:'An account already exists for this email.'});if(err instanceof multer.MulterError)return res.status(413).json({error:`Upload limit exceeded (${err.code}). Maximum 50 files, 10 MB per file and 50 MB total.`});const status=err.status||500;console.error('Request:',err.message);res.status(status).json({error:status>=500?'The request could not be completed. Please try again.':err.message});});
 return app;
}
