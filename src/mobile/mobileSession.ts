import { MobileConnectionError, readMobileStatus, refreshMobileSnapshot, logoutMobile, type MobileStatus } from "./mobileConnection";
import { MobileRepository, MobileStorageError } from "./mobileRepository";
import { MobileSnapshotVersionError } from "./mobileSnapshot";
export class MobileEpochApproval extends Error {
 constructor(public readonly status:MobileStatus, public readonly key:string,public readonly previous:string){super("Confirm replacing this profile’s saved snapshot after its desktop identity changed.");}
}
/** Status supplies the binding; a snapshot cannot grant access or authorize an epoch reset. */
export async function refreshSelectedMobile(repository:MobileRepository,key:string|null,fetcher:typeof fetch=fetch,approval?:string,onStatus?:(status:MobileStatus)=>void):Promise<MobileStatus>{
 const fence=await repository.accessFence();
 if(!await repository.remembered())throw new MobileConnectionError("mobile_access_forgotten");
 const status=await readMobileStatus(fetcher);
 if(!await repository.remembered()||await repository.accessFence()!==fence)throw new MobileConnectionError("mobile_access_forgotten");
 onStatus?.(status);
 const profile=key?status.profiles.find(p=>`${status.installationId}/${p.id}`===key):status.profiles.find(p=>p.refreshable===true)??status.profiles[0];
 if(!profile)throw new MobileConnectionError("mobile_access_denied");
 if(profile.refreshable===false)throw new MobileConnectionError("mobile_profile_unavailable");
 const saved=(await repository.load()).snapshots.find(s=>s.installationId===status.installationId&&s.profile.id===profile.id);
 if(saved&&saved.epoch!==profile.epoch&&approval!==saved.epoch)throw new MobileEpochApproval(status,`${status.installationId}/${profile.id}`,saved.epoch);
 await refreshMobileSnapshot(repository,{installationId:status.installationId,profileId:profile.id,epoch:profile.epoch},{accessFence:fence,...(approval?{replaceEpoch:approval}:{})},fetcher);
 return {...status,profiles:[profile,...status.profiles.filter(p=>p.id!==profile.id)]};
}
export async function forgetMobileAccess(repository:MobileRepository,fetcher:typeof fetch=fetch):Promise<boolean>{
 // Clear the local authorization intent and refresh fence before any network request.
 await repository.forget();
 try{const status=await readMobileStatus(fetcher);await logoutMobile(status.csrf,fetcher);return true;}catch{return false;}
}
export function mobileConnectionMessage(error:unknown):string{
 if(error instanceof MobileStorageError)return error.message;
 if(error instanceof MobileSnapshotVersionError)return error.message;
 if(error instanceof MobileEpochApproval)return error.message;
 if(error instanceof MobileConnectionError){
  switch(error.code){
   case "mobile_access_denied":return "Phone access has expired or was revoked. Pair again on your desktop. Your saved snapshots remain available.";
   case "mobile_access_forgotten":return "Pair this phone on your desktop to download saved snapshots.";
   case "mobile_profile_unavailable":case "mobile_profile_changed":return "Open and unlock this profile on your desktop, then refresh. Your saved snapshot was kept.";
   case "mobile_refresh_limited":return "Wait 30 seconds before refreshing this profile again. Your saved snapshot was kept.";
   case "mobile_confirmation_pending":return "Waiting for you to approve this phone and choose profiles on the desktop…";
   case "mobile_refresh_busy":return "This profile is already refreshing.";
   case "mobile_pairing_invalid":return "Enter the current one-time pairing code and a phone name of up to 60 characters.";
  }
 }
 return "Desktop unavailable. Keep Vault Spend open on the same Wi-Fi network and try again. Your saved snapshot was kept.";
}
