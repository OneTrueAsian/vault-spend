import type { CorpusCase } from "./manifest";

/** Counting only; never rewrite execution text or use parser normalization. VP-03:55-68. */
export const countKey = (text: string): string => text.normalize("NFC").replace(/\r\n/g,"\n").trim().replace(/\s+/gu," ").toLowerCase();

/** Exact full semantic/result keys: object key order is immaterial; arrays and values are not. */
export function canonical(value: unknown): string {
  const walk = (x: unknown): unknown => {
    if (typeof x === "number" && !Number.isFinite(x)) throw Error("Non-finite evidence value");
    if (x === undefined || typeof x === "bigint" || typeof x === "function" || typeof x === "symbol") throw Error("Non-JSON evidence value");
    if (Array.isArray(x)) return x.map(walk);
    if (x !== null && typeof x === "object") return Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,walk(v)]));
    return x;
  };
  return JSON.stringify(walk(value));
}

export function validateManifest(cases: CorpusCase[]): void {
  const ids=new Set<string>(),populations=new Map<string,Set<string>>();
  for(const c of cases) {
    if(ids.has(c.id))throw Error(`Duplicate case ID: ${c.id}`);ids.add(c.id);
    // CG-09 includes authored empty-input refusal fixtures. They never earn supported/financial credit.
    const emptyUnsafeStop=c.population==="P-UNSAFE"&&c.required.length>0&&c.required.every(r=>r.requestId===null&&r.referenceId===null&&r.stop==="refusal");
    if((!c.text.trim()&&!emptyUnsafeStop)||!c.family||!c.cluster||!c.required.length)throw Error(`Incomplete case: ${c.id}`);
    const key=countKey(c.text),seen=populations.get(key)??new Set<string>();seen.add(c.population);populations.set(key,seen);
    if(seen.has("P-CORE")&&seen.has("P-LT"))throw Error(`Core/long-tail overlap: ${c.id}`);
    const contexts=new Set<string>(),seeds=new Set<number>();
    for(const r of c.required) {
      const context=`${r.seed}|${r.contextId}`;
      if(contexts.has(context))throw Error(`Duplicate required seed/context: ${c.id}`);contexts.add(context);seeds.add(r.seed);
      if((r.requestId===null)!==(r.referenceId===null))throw Error(`Partial financial link: ${c.id}`);
    }
    if(c.required.some(r=>r.referenceId!==null)&&seeds.size<3)throw Error(`Financial case needs at least three seeds: ${c.id}`);
  }
}
