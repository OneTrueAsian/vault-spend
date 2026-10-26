// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { askPreparedQuestion } from "./askPreparedQuestion.mjs";

const question = "Extra $50 a month into IRA until January 2056";
const card = (busy, value = "") => '<div class="ledger-qa-card"><form aria-busy="' + busy + '"><input value="' + value + '"><button type="submit" ' + (busy ? "disabled" : "") + '>Ask</button></form></div>';
const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
function harness({ busy = false, afterType } = {}) {
  document.body.innerHTML = card(busy);
  let attempts = 0, submitted = 0, waits = [], failed;
  document.body.addEventListener("submit", e => { e.preventDefault(); submitted++; }, { once: true });
  const notify = () => { for(const r of waits.splice(0))r(); };
  const changed = () => new Promise(r=>waits.push(r));
  const until = async predicate => { while(!await predicate()) { if(failed)throw failed; await changed(); } };
  const wrapper = selector => ({
    waitForExist: () => until(()=>!!document.querySelector(selector)),
    click: async () => { const e=document.querySelector(selector);if(e.tagName==='BUTTON')attempts++;e.click(); },
    setValue: async value => { document.querySelector(selector).value=value;afterType?.(); },
    getValue: async () => document.querySelector(selector).value,
  });
  const browser = {
    $: async selector => wrapper(selector),
    execute: async (fn,...args) => fn(...args.map(a=>a?.getValue?document.querySelector('.ledger-qa-card input'):a)),
    waitUntil: async predicate => until(predicate),
  };
  return { browser, get attempts(){return attempts;}, get submitted(){return submitted;},
    ready(){const f=document.querySelector('form');f.setAttribute('aria-busy','false');f.querySelector('button').disabled=false;notify();},
    busy(){const f=document.querySelector('form');f.setAttribute('aria-busy','true');f.querySelector('button').disabled=true;},
    replace(){const value=document.querySelector('input').value;document.body.innerHTML=card(false,value);notify();},
    fail(){failed=new Error('readiness failed');notify();},
  };
}
beforeEach(()=>{document.body.innerHTML='';});
describe('actual compiled-question helper respects the current ready form',()=>{
 it('does not click a disabled Ask while the input already exists, then submits once when ready',async()=>{
  const h=harness({busy:true});const work=askPreparedQuestion(h.browser,question);await flush();
  try{expect(h.attempts).toBe(0);}finally{h.ready();}await work;expect(h.attempts).toBe(1);expect(h.submitted).toBe(1);
 });
 it('rechecks readiness after typing when a delayed reload makes the form busy again',async()=>{
  let h;h=harness({afterType:()=>h.busy()});const work=askPreparedQuestion(h.browser,question);await flush();
  try{expect(h.attempts).toBe(0);}finally{h.ready();}await work;expect(h.attempts).toBe(1);expect(h.submitted).toBe(1);
 });
 it('uses the connected current card after a remount with the same intended question',async()=>{
  let h;h=harness({afterType:()=>h.replace()});await askPreparedQuestion(h.browser,question);expect(h.attempts).toBe(1);expect(h.submitted).toBe(1);expect(document.querySelector('input').value).toBe(question);
 });
 it('immediate readiness still submits exactly once',async()=>{const h=harness();await askPreparedQuestion(h.browser,question);expect(h.submitted).toBe(1);expect(h.attempts).toBe(1);});
 it('readiness failure prevents submission and propagates',async()=>{const h=harness({busy:true});const work=askPreparedQuestion(h.browser,question);const check=expect(work).rejects.toThrow('readiness failed');await flush();h.fail();await check;expect(h.attempts).toBe(0);});
});
