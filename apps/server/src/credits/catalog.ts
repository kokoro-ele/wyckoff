import {BillingError} from '../billing/catalog.js';
export interface CreditPack {id:string;name:string;credits:number;amount:number;currency:'USD'|'CNY'}
export function creditPacks(env:NodeJS.ProcessEnv=process.env):CreditPack[] {
 if(!env.ANALYSIS_CREDIT_PACKS?.trim()) return [];
 try {
  const packs:unknown=JSON.parse(env.ANALYSIS_CREDIT_PACKS);
  if(!Array.isArray(packs)||packs.length>50)throw new Error();
  const ids=new Set<string>();
  return packs.map(p=>{
   if(!p||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||!Number.isSafeInteger(p.credits)||p.credits<=0||p.credits>1000000||!Number.isSafeInteger(p.amount)||p.amount<=0||p.amount>100000000||!['USD','CNY'].includes(p.currency))throw new Error();
   ids.add(p.id);return {id:p.id,name:p.name,credits:p.credits,amount:p.amount,currency:p.currency};
  });
 }catch{throw new BillingError('INVALID_CREDIT_CONFIGURATION','充值次数包配置无效',503);}
}
