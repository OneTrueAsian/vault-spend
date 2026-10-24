/** Test-only independent oracle input, matching M2/oracle/worlds.ts's fixture fields. */
export type Tx = { id:number;accountId:number;date:string;description:string;cents:number;category:string|null;memberId:number|null;
  splits?: {category:string;cents:number}[] };
export type World = {name:string;today:string;members:{id:number;name:string}[];accounts:{id:number;name:string;memberId:number|null}[];categories:string[];ledger:Tx[]};
