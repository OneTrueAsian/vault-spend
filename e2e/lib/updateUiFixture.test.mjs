import {describe,it,expect,vi} from 'vitest';
import {installUpdaterFixture} from './updateUiFixture.mjs';
function fixture(){
  const native=async command=>({native:command}),internals={};
  Object.defineProperty(internals,'invoke',{value:native});
  const fetch=vi.fn(async()=>new Response('original'));
  return {win:{__TAURI_INTERNALS__:internals,fetch,Response},native,fetch};
}
describe('compiled update fixture at the actual mutable fetch seam',()=>{
  it('works with immutable Tauri invoke and returns protocol-shaped publisher metadata',async()=>{
    const {win,native,fetch}=fixture();installUpdaterFixture(win);
    expect(win.__TAURI_INTERNALS__.invoke).toBe(native);
    const response=await win.fetch('http://ipc.localhost/fetch_latest_release',{body:'{}'});
    expect(response.headers.get('Tauri-Response')).toBe('ok');
    expect((await response.json()).tag_name).toBe('v1.3.2');expect(fetch).not.toHaveBeenCalled();
  });
  it('leaves financial calls and non-IPC URLs untouched',async()=>{
    const {win,fetch}=fixture();installUpdaterFixture(win);
    for(const url of ['http://ipc.localhost/list_accounts','https://example.invalid/fetch_latest_release']){
      const init={body:'original payload'};expect(await (await win.fetch(url,init)).text()).toBe('original');expect(fetch).toHaveBeenLastCalledWith(url,init);
    }
    expect(win.__qaUpdateFixture.calls).toEqual([]);
  });
  it('records simulated operations and refuses an unexpected simulated installer token',async()=>{
    const {win,fetch}=fixture();installUpdaterFixture(win);
    const call=async(cmd,args={})=>win.fetch('http://ipc.localhost/'+cmd,{body:JSON.stringify(args)});
    const offer=await (await call('prepare_signed_update')).json();
    expect(await (await call('download_signed_update',{handle:offer.handle})).json()).toBe(offer.handle);
    await expect(call('install_signed_update',{token:'wrong'})).rejects.toThrow(/fixture token/);
    expect(await (await call('install_signed_update',{token:offer.handle})).json()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
