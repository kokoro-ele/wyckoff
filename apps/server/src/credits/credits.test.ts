import {describe,it,expect} from 'vitest';
import {creditPacks} from './catalog.js';
import {beginWorkspaceUsage} from '../billing/workspace.js';
describe('permanent credit catalog',()=>{
 it('does not invent packs without merchant pricing',()=>expect(creditPacks({})).toEqual([]));
 it('validates price units, credits and unique identifiers',()=>{
  const pack={id:'ten',name:'10 次',credits:10,amount:1000,currency:'CNY'};
  expect(creditPacks({ANALYSIS_CREDIT_PACKS:JSON.stringify([pack])})).toEqual([pack]);
  for(const invalid of [[pack,pack],[{...pack,amount:0}],[{...pack,credits:1.5}],[{...pack,currency:'XXX'}],{}])expect(()=>creditPacks({ANALYSIS_CREDIT_PACKS:JSON.stringify(invalid)})).toThrow();
 });
 it('never bypasses authentication when billing is disabled',async()=>{
  await expect(beginWorkspaceUsage('request-key')).rejects.toMatchObject({code:'AUTH_REQUIRED'});
 });
});
