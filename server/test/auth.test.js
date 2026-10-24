import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCredentials,passwordHash,verifyPassword,digest,cookieOptions} from '../src/auth.js';
test('registration validates email and password length',()=>{
 assert.throws(()=>validateCredentials({name:'A',email:'not-an-email',password:'long-password-123'},true));
 assert.throws(()=>validateCredentials({name:'A',email:'a@example.com',password:'short'},true));
 const result=validateCredentials({name:' Alice ',email:' Alice@Example.com ',password:'long-password-123'},true);assert.equal(result.name,'Alice');assert.equal(result.email,'alice@example.com');
});
test('salted passwords verify correctly and wrong credentials fail',async()=>{
 const password='long-password-123',salt='salt-one';const first=await passwordHash(password,salt);assert.notEqual(first,await passwordHash(password,'salt-two'));assert.equal(await verifyPassword(password,{salt,passwordHash:first}),true);assert.equal(await verifyPassword('wrong-password-123',{salt,passwordHash:first}),false);assert.equal(await verifyPassword(password,null),false);assert.equal(digest('token').length,64);
});
test('production sessions use secure HttpOnly same-site cookies',()=>{
 const options=cookieOptions(true);assert.equal(options.secure,true);assert.equal(options.httpOnly,true);assert.equal(options.sameSite,'strict');assert.equal(cookieOptions(false).secure,false);
});
