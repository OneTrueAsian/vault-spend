import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixture from "../core/tests/fixtures/mobile_snapshot_v1.json";
import { MobileRepository, type SnapshotBackend, type StoredSnapshot, type StoreState } from "./mobileRepository";

const crypto=webcrypto as unknown as Crypto;
const binding={installationId:fixture.installationId,profileId:fixture.profile.id,epoch:fixture.epoch};
function sample(sequence="1"){return JSON.stringify({...fixture,sequence});}
class MemoryBackend implements SnapshotBackend {
  entries=new Map<string,StoredSnapshot>();fence="generation-one";active:string|null=null;fail=false;
  async state(id:string):Promise<StoreState>{return {record:this.entries.get(id),fence:this.fence,active:this.active};}
  async list(){return {records:[...this.entries.values()],active:this.active};}
  async commit(record:StoredSnapshot,prior:string|null,fence:string){if(this.fail)throw new Error("write aborted");if(this.fence!==fence||(this.entries.get(record.id)?.revision??null)!==prior)throw new Error("storage changed");this.entries.set(record.id,structuredClone(record));this.active??=record.id;}
  async remove(id?:string){this.fence+="-next";if(id){this.entries.delete(id);if(this.active===id)this.active=null;}else{this.entries.clear();this.active=null;}}
  async select(id:string){if(!this.entries.has(id))throw new Error("missing");this.active=id;}
}
describe("encrypted mobile repository",()=>{
  it("persists non-extractable keys and ciphertext and decrypts after repository recreation",async()=>{
    const backend=new MemoryBackend(),repo=new MobileRepository(backend,crypto);
    await repo.replace(sample(),binding);
    const record=[...backend.entries.values()][0];
    expect(record.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw",record.key)).rejects.toThrow();
    expect(JSON.stringify(record)).not.toContain(fixture.profile.name);
    expect(new TextDecoder().decode(record.ciphertext)).not.toContain(fixture.accounts[0].name);
    const reopened=await new MobileRepository(backend,crypto).load();
    expect(reopened.snapshots[0]).toEqual(fixture);
    expect(reopened.errors).toEqual([]);
  });
  it("uses fresh IVs, monotonic uint64 sequence and identity validation",async()=>{
    const backend=new MemoryBackend(),repo=new MobileRepository(backend,crypto);
    await repo.replace(sample("9007199254740992"),binding);const first=[...backend.entries.values()][0];
    await repo.replace(sample("9007199254740993"),binding);const next=[...backend.entries.values()][0];
    expect(next.iv).not.toEqual(first.iv);
    await expect(repo.replace(sample("2"),binding)).rejects.toThrow(/older/);
    await expect(repo.replace(sample("9007199254740993"),binding)).resolves.toBe("unchanged");
    await expect(repo.replace(sample(),{...binding,profileId:"wrong"})).rejects.toThrow(/Invalid/);
    expect((await repo.load()).snapshots[0].sequence).toBe("9007199254740993");
  });
  it("requires an explicitly confirmed epoch transition and never trusts response identity",async()=>{
    const repo=new MobileRepository(new MemoryBackend(),crypto);await repo.replace(sample(),binding);
    const json=JSON.stringify({...fixture,epoch:"new-epoch"});
    await expect(repo.replace(json,binding)).rejects.toThrow(/epoch/);
    await expect(repo.replace(json,{...binding,epoch:"new-epoch"})).rejects.toThrow(/confirm/);
    await repo.replace(json,{...binding,epoch:"new-epoch"},{replaceEpoch:binding.epoch});
    expect((await repo.load()).snapshots[0].epoch).toBe("new-epoch");
  });
  it("retains old data on aborted writes and invalid/newer snapshots",async()=>{
    const backend=new MemoryBackend(),repo=new MobileRepository(backend,crypto);await repo.replace(sample(),binding);backend.fail=true;
    await expect(repo.replace(sample("2"),binding)).rejects.toThrow();
    expect((await repo.load()).snapshots[0].sequence).toBe("1");
    await expect(repo.replace(JSON.stringify({...fixture,minimumViewerVersion:2}),binding)).rejects.toThrow();
    await expect(repo.replace("truncated",binding)).rejects.toThrow();
    expect(backend.entries.size).toBe(1);
  });
  it("rejects missing keys, corrupt ciphertext, changed headers and future envelope versions without deleting records",async()=>{
    for(const change of ["key","cipher","identity","version"]){
      const backend=new MemoryBackend(),repo=new MobileRepository(backend,crypto);await repo.replace(sample(),binding);
      const record=[...backend.entries.values()][0];
      if(change==="key")Reflect.deleteProperty(record,"key");
      if(change==="cipher")new Uint8Array(record.ciphertext)[0]^=1;
      if(change==="identity")record.epoch="tampered";
      if(change==="version")record.envelopeVersion=2;
      const result=await repo.load();expect(result.snapshots).toEqual([]);expect(result.errors).toHaveLength(1);expect(backend.entries.size).toBe(1);
    }
  });
  it("selectively deletes profile keys/data and fences refreshes that were prepared before forgetting",async()=>{
    const backend=new MemoryBackend(),repo=new MobileRepository(backend,crypto);await repo.replace(sample(),binding);
    const second={...binding,profileId:"second"};await repo.replace(JSON.stringify({...fixture,profile:{...fixture.profile,id:"second"}}),second);
    const old=await backend.state(`${binding.installationId}/${binding.profileId}`);const record=old.record!;
    await repo.remove(record.id);expect((await repo.load()).snapshots.map(s=>s.profile.id)).toEqual(["second"]);
    await expect(backend.commit(record,null,old.fence)).rejects.toThrow(/changed/);
    await repo.forget();expect(backend.entries.size).toBe(0);expect(backend.active).toBeNull();
  });
  it("rejects refresh guards captured before removal, including another repository instance",async()=>{
    const backend=new MemoryBackend(),first=new MobileRepository(backend,crypto),second=new MobileRepository(backend,crypto);
    const guard=await first.prepareRefresh(binding);
    await second.forget();
    await expect(first.replace(sample(),binding,{guard})).rejects.toThrow(/before/);
    expect(backend.entries.size).toBe(0);
    const fresh=await first.prepareRefresh(binding);
    await expect(first.replace(sample(),binding,{guard:fresh})).resolves.toBe("saved");
  });
  it("allows one in-flight refresh per profile and atomically rejects cross-instance stale writes",async()=>{
    const backend=new MemoryBackend(),repo=new MobileRepository(backend,crypto);
    const first=repo.replace(sample(),binding);
    await expect(repo.replace(sample("2"),binding)).rejects.toThrow(/already/);
    await first;
    const other=new MobileRepository(backend,crypto);
    const outcomes=await Promise.allSettled([repo.replace(sample("2"),binding),other.replace(sample("3"),binding)]);
    expect(outcomes.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect(outcomes.filter(x=>x.status==="rejected")).toHaveLength(1);
    expect(["2","3"]).toContain((await repo.load()).snapshots[0].sequence);
  });

});
