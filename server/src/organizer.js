import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
const types={Documents:['pdf','doc','docx','txt','md','rtf','odt'],Images:['jpg','jpeg','png','gif','webp','svg','heic'],Spreadsheets:['csv','xlsx','xls','ods'],Presentations:['ppt','pptx'],Videos:['mp4','mov','mkv','webm'],Audio:['mp3','wav','m4a','flac'],Archives:['zip','rar','7z','tar','gz'],Code:['js','ts','jsx','tsx','py','java','html','css','json','sql']};
export function category(name){const ext=path.posix.extname(name).slice(1).toLowerCase();return Object.keys(types).find(k=>types[k].includes(ext))||'Other';}
export function cleanName(name){const ext=path.posix.extname(name).toLowerCase();let stem=path.posix.basename(name,path.posix.extname(name)).normalize('NFKC').replace(/\b(copy|final|new)\b/gi,'').replace(/\(\d+\)/g,'').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').toLowerCase().slice(0,100)||'untitled';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem))stem='file-'+stem;return stem+ext.replace(/[^a-z0-9.]/g,'').slice(0,16);}
export function safeOriginal(input){if(typeof input!=='string'||!input||input.length>1000)throw Error('Invalid file path');const normalized=input.replaceAll('\\','/');if(normalized.startsWith('/')||/^[a-z]:/i.test(normalized))throw Error('Absolute file paths are not allowed');const parts=normalized.split('/');if(parts.length>20||parts.some(p=>!p||p==='.'||p==='..'))throw Error('Invalid folder path');return parts.map(s=>{let n=s.normalize('NFKC').replace(/[<>:"|?*\x00-\x1f\x7f]/g,'-').replace(/[. ]+$/,'').slice(0,160);if(!n||n==='.'||n==='..')n='file';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(n))n='file-'+n;return n;}).join('/');}
export async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
export function groups(files){const hashes=new Map(),names=new Map();for(const f of files){const h=hashes.get(f.hash)||[];h.push(f);hashes.set(f.hash,h);const key=cleanName(f.name);const n=names.get(key)||[];n.push(f);names.set(key,n);}return {exactGroups:[...hashes.values()].filter(g=>g.length>1).map(g=>g.map(f=>f.id)),similarGroups:[...names.values()].filter(g=>g.length>1&&new Set(g.map(f=>f.hash)).size>1).map(g=>g.map(f=>f.id))};}
// Case-insensitive uniqueness works on Windows and macOS as well as Linux.
export function uniquePaths(files){const used=new Set();for(const f of files){const candidate=f.category+'/'+cleanName(f.suggestedName);f.suggestedName=path.posix.basename(candidate);let result=candidate,i=2;const ext=path.posix.extname(candidate),stem=candidate.slice(0,candidate.length-ext.length);while(used.has(result.toLowerCase()))result=`${stem}-${i++}${ext}`;used.add(result.toLowerCase());f.suggestedPath=result;}}
export function exportEntries(files){
 const fileNames=new Set(),directories=new Set();
 return files.filter(f=>f.include).map(f=>{
 const parts=safeOriginal(f.organize?f.suggestedPath:f.originalPath).split('/');let parent='';
 for(const dir of parts.slice(0,-1)){let segment=dir,n=2;while(fileNames.has((parent+segment).toLowerCase()))segment=dir+'-'+n++;parent+=segment+'/';directories.add(parent.slice(0,-1).toLowerCase());}
 const base=parts.at(-1),ext=path.posix.extname(base),stem=base.slice(0,base.length-ext.length);let candidate=parent+base,n=2;
 while(fileNames.has(candidate.toLowerCase())||directories.has(candidate.toLowerCase()))candidate=parent+stem+'-'+(n++)+ext;
 fileNames.add(candidate.toLowerCase());return {id:f.id,storedName:f.storedName,name:candidate};
 });
}
export function metrics(jobs){const files=jobs.flatMap(j=>j.files||[]);let duplicates=0,recoverableBytes=0;for(const j of jobs)for(const g of j.exactGroups||[]){duplicates+=g.length-1;recoverableBytes+=g.slice(1).reduce((a,id)=>a+(j.files.find(f=>f.id===id)?.size||0),0);}return {files:files.length,bytes:files.reduce((a,f)=>a+f.size,0),suggestions:files.filter(f=>f.originalPath!==f.suggestedPath).length,duplicates,recoverableBytes,jobs:jobs.length};}
