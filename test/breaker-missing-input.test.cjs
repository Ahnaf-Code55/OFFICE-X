'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CircuitBreaker}=require('./load-ts.cjs')('src/main/breaker.ts');
test('missing tool arguments cannot be evidence of identical calls, while real identical calls still trip',()=>{
 const b=new CircuitBreaker(()=>({enabled:true,hardStop:false,repeatedToolLimit:8,errorStormLimit:5,tokenVelocityPerMin:60000}));
 for(let i=0;i<10;i++)b.recordToolUse('missing','bash',undefined,1000000+i);
 const tick=id=>b.tick([{agentId:id,sample:null,progressing:true}],2000000)[0];
 assert.equal(tick('missing').state.level,'healthy');
 for(let i=0;i<8;i++)b.recordToolUse('loop','bash',{command:'same'},1000000+i);
 assert.equal(tick('loop').state.level,'steering');
});
