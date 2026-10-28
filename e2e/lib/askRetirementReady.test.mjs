import {it,expect} from 'vitest';
import {askHelpers} from './askRetirement.mjs';
function page(){
 let release,typed='',submitted=0;const actions=[];
 const pending=new Promise(resolve=>{release=resolve;});
 const input={click:async()=>actions.push('focus'),setValue:async value=>{typed=value;actions.push('type');},getValue:async()=>typed};
 const button={click:async()=>{submitted++;}};
 const browser={execute:async()=>{},$:async selector=>{
   if(selector.includes('aria-busy="false"'))return{waitForExist:async()=>pending};
   if(selector==='.ledger-qa-card input')return input;
   if(selector==='.ledger-qa-card')return{$:async()=>button};
   throw Error('Unexpected selector '+selector);
 }};
 return{browser,release:()=>release(),actions,submits:()=>submitted};
}
it('the shared retirement/scenario helper waits for live roster readiness before typing or submitting',async()=>{
 const p=page(),work=askHelpers(p.browser).ask('extra $50 a month for retirement');
 for(let i=0;i<20;i++)await Promise.resolve();
 const before=[...p.actions],submittedBefore=p.submits();p.release();await work;
 expect(before).toEqual([]);expect(submittedBefore).toBe(0);expect(p.submits()).toBe(1);
});
it('a readiness failure propagates without submitting a question',async()=>{
 const p=page(),error=new Error('Roster unavailable'),original=p.browser.$;
 p.browser.$=async selector=>selector.includes('aria-busy="false"')?{waitForExist:async()=>{throw error;}}:original(selector);
 const result=await askHelpers(p.browser).ask('extra $50').then(()=>null,e=>e);
 expect(result).toBe(error);expect(p.actions).toEqual([]);expect(p.submits()).toBe(0);
});
