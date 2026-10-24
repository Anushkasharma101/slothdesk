import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeOriginal,cleanName,category,groups,uniquePaths,exportEntries,metrics} from '../src/organizer.js';
test('normalizes names, protects Windows reserved names and rejects traversal',()=>{
 assert.equal(cleanName('Report FINAL (1).TXT'),'report.txt');assert.equal(cleanName('CON.txt'),'file-con.txt');assert.equal(category('X.PDF'),'Documents');
 for(const p of ['../secret','a/../../x','/etc/passwd','C:\\secret','a//x'])assert.throws(()=>safeOriginal(p));
 assert.equal(safeOriginal('Photos\\holiday.png'),'Photos/holiday.png');assert.equal(safeOriginal('CON.txt'),'file-CON.txt');
});
test('separates exact duplicates from similar names and generates collision-free paths',()=>{
 const f=[{id:'a',name:'Report.txt',suggestedName:'report.txt',category:'Documents',hash:'same',size:5},{id:'b',name:'Report copy.txt',suggestedName:'report.txt',category:'Documents',hash:'same',size:5},{id:'c',name:'Report FINAL.txt',suggestedName:'report.txt',category:'Documents',hash:'different',size:9}];
 const g=groups(f);assert.deepEqual(g.exactGroups,[['a','b']]);assert.deepEqual(g.similarGroups,[['a','b','c']]);uniquePaths(f);assert.deepEqual(f.map(x=>x.suggestedPath),['Documents/report.txt','Documents/report-2.txt','Documents/report-3.txt']);assert.equal(metrics([{files:f,...g}]).recoverableBytes,5);
});
test('export excludes choices, preserves chosen paths, prevents file/directory collisions',()=>{
 const f=['A','a/file.txt','a/FILE.txt','A-2','a-2/child.txt'].map((name,i)=>({id:String(i),storedName:'private-'+i,originalPath:name,include:true,organize:false}));f.push({id:'excluded',include:false});const entries=exportEntries(f);assert.equal(entries.length,5);const names=entries.map(e=>e.name.toLowerCase());assert.equal(new Set(names).size,5);for(const a of names)for(const b of names)if(a!==b)assert.ok(!b.startsWith(a+'/'));
});
