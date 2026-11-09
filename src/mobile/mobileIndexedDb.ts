import { MobileRepository, MobileStorageError, randomRevision, type SnapshotBackend, type StoredSnapshot, type StoreState } from "./mobileRepository";

export const MOBILE_DB_NAME="vault-spend-mobile-v1";
const PROFILE_STORE="profiles",META_STORE="metadata";
function storageError():MobileStorageError {return new MobileStorageError("unavailable","This browser could not save or open encrypted snapshots. Storage may be blocked, private, or full. Your previous saved data was kept.");}

export class IndexedDbSnapshotBackend implements SnapshotBackend {
  private connection:Promise<IDBDatabase>|null=null;
  private listeners=new Set<(removed:boolean)=>void>();
  private channel:BroadcastChannel|null=null;
  constructor(private readonly factory:IDBFactory=globalThis.indexedDB,private readonly crypto:Crypto=globalThis.crypto,private readonly name=MOBILE_DB_NAME){
    if(typeof BroadcastChannel!=="undefined"){this.channel=new BroadcastChannel(`vault-mobile-storage-${name}`);this.channel.onmessage=e=>{if(e.data?.type==="changed")this.listeners.forEach(listener=>listener(e.data.removed===true));};}
  }
  subscribe(listener:(removed:boolean)=>void):()=>void{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private publish(removed=false):void{this.listeners.forEach(listener=>listener(removed));this.channel?.postMessage({type:"changed",removed});}
  private async database():Promise<IDBDatabase>{
    if(this.connection)return this.connection;
    const opening=new Promise<IDBDatabase>((resolve,reject)=>{
      if(!this.factory){reject(storageError());return;}
      let request:IDBOpenDBRequest;
      try{request=this.factory.open(this.name,1);}catch{reject(storageError());return;}
      let finished=false;
      const timer=setTimeout(()=>{finished=true;this.connection=null;reject(storageError());},5000);
      request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore(PROFILE_STORE,{keyPath:"id"});db.createObjectStore(META_STORE);};
      request.onerror=()=>{clearTimeout(timer);this.connection=null;reject(request.error?.name==="VersionError"?new MobileStorageError("version","A newer viewer has updated this device's storage. Reopen the current desktop web address."):storageError());};
      request.onsuccess=()=>{clearTimeout(timer);if(finished){request.result.close();return;}const db=request.result;db.onversionchange=()=>{db.close();this.connection=null;};resolve(db);};
    });
    this.connection=opening.then(async db=>{
      await this.transaction(db,"readwrite",(tx,done)=>{const meta=tx.objectStore(META_STORE),request=meta.get("fence");request.onsuccess=()=>{if(!request.result)meta.put(randomRevision(this.crypto),"fence");done(undefined);};});
      return db;
    }).catch(error=>{this.connection=null;throw error;});
    return this.connection;
  }
  private transaction<T>(db:IDBDatabase,mode:IDBTransactionMode,work:(tx:IDBTransaction,done:(result:T)=>void,reject:(error:Error)=>void)=>void):Promise<T>{
    return new Promise((resolve,reject)=>{
      let tx:IDBTransaction,result:T,error:Error|undefined;
      try{tx=db.transaction([PROFILE_STORE,META_STORE],mode);}catch{reject(storageError());return;}
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(error??storageError());
      tx.onerror=()=>{/* Abort settles the promise; it also rolls back keys, pointer and ciphertext. */};
      try{work(tx,value=>{result=value;},reason=>{error=reason;tx.abort();});}catch{tx.abort();}
    });
  }
  async state(id:string):Promise<StoreState>{const db=await this.database();return this.transaction(db,"readonly",(tx,done)=>{const record=tx.objectStore(PROFILE_STORE).get(id),meta=tx.objectStore(META_STORE),fence=meta.get("fence"),active=meta.get("active");let count=0;const finish=()=>{if(++count===3)done({record:record.result,fence:fence.result,active:active.result??null});};record.onsuccess=finish;fence.onsuccess=finish;active.onsuccess=finish;});}
  async remembered():Promise<boolean>{const db=await this.database();return this.transaction(db,"readonly",(tx,done)=>{const request=tx.objectStore(META_STORE).get("remembered");request.onsuccess=()=>done(request.result===true);});}
  async remember(fence?:string):Promise<void>{const db=await this.database();await this.transaction(db,"readwrite",(tx,done,reject)=>{const meta=tx.objectStore(META_STORE),generation=meta.get("fence");generation.onsuccess=()=>{if(fence!==undefined&&generation.result!==fence){reject(new MobileStorageError("changed","Pairing was cancelled because saved access was removed. Pair again."));return;}meta.put(true,"remembered");done(undefined);};});this.publish();}
  async list(){const db=await this.database();return this.transaction<{records:StoredSnapshot[];active:string|null}>(db,"readonly",(tx,done)=>{const records=tx.objectStore(PROFILE_STORE).getAll(),active=tx.objectStore(META_STORE).get("active");let count=0;const finish=()=>{if(++count===2)done({records:records.result,active:active.result??null});};records.onsuccess=finish;active.onsuccess=finish;});}
  async commit(record:StoredSnapshot,priorRevision:string|null,fence:string):Promise<void>{const db=await this.database();await this.transaction(db,"readwrite",(tx,done,reject)=>{const profiles=tx.objectStore(PROFILE_STORE),meta=tx.objectStore(META_STORE),prior=profiles.get(record.id),generation=meta.get("fence"),active=meta.get("active");let count=0;const finish=()=>{if(++count!==3)return;if((prior.result?.revision??null)!==priorRevision||generation.result!==fence){reject(new MobileStorageError("changed","Saved data changed while this refresh was prepared. Refresh again; removed data was not restored."));return;}profiles.put(record);if(!active.result)meta.put(record.id,"active");done(undefined);};prior.onsuccess=finish;generation.onsuccess=finish;active.onsuccess=finish;});this.publish();}
  async remove(id?:string):Promise<void>{const db=await this.database();await this.transaction(db,"readwrite",(tx,done)=>{const profiles=tx.objectStore(PROFILE_STORE),meta=tx.objectStore(META_STORE);if(id){profiles.delete(id);const active=meta.get("active");active.onsuccess=()=>{if(active.result===id)meta.delete("active");};}else{profiles.clear();meta.clear();}meta.put(randomRevision(this.crypto),"fence");done(undefined);});this.publish(true);}
  async select(id:string):Promise<void>{const db=await this.database();await this.transaction(db,"readwrite",(tx,done,reject)=>{const profile=tx.objectStore(PROFILE_STORE).get(id);profile.onsuccess=()=>{if(!profile.result){reject(new MobileStorageError("changed","That saved profile was removed. Reopen the viewer."));return;}tx.objectStore(META_STORE).put(id,"active");done(undefined);};});this.publish();}
  close():void {const connection=this.connection;this.connection=null;this.channel?.close();this.channel=null;if(connection)void connection.then(db=>db.close(),()=>undefined);}
}
export function createMobileRepository():MobileRepository{return new MobileRepository(new IndexedDbSnapshotBackend());}
