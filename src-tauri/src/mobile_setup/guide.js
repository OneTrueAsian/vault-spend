let phone='ios',step=0;
const guide=document.getElementById('guide');
function render(){
 const ios=phone==='ios';
 const steps=[
 {title:'First, check your connection',body:'<p>Keep your computer awake with Vault Spend open. Your phone and computer must use the same private home network.</p><p>The certificate helps your browser recognize your computer. It trusts certificates signed by this installation. Remove it in phone Settings when you stop using mobile access.</p>',next:'Get the certificate'},
 {title:'Download the certificate',body:'<p>Tap the download below. '+(ios?'If iPhone asks to allow the profile download, tap Allow. A profile is the file Settings uses to install the certificate.':'Save the file in Downloads so you can find it.')+'</p><a class="download" href="certificate.'+(ios?'mobileconfig':'crt')+'">Download certificate</a><p>Before installing, verify the actual certificate against the fingerprint shown in Vault Spend on your computer.</p>',next:'Check before installing'},
 {title:'Verify the actual certificate',body:'<p>Compare the actual certificate file’s SHA-256 fingerprint with the full fingerprint shown on your computer. A matching name or text on this download page is not enough.</p><div class="warning">If your phone does not let you inspect that fingerprint, stop here. Use the computer’s Export public certificate option and transfer it through a method you control, such as a direct cable. Do not treat this page as proof of identity.</div><label class="check"><input id="verified" type="checkbox">I verified the actual certificate, or used a trusted direct transfer from my computer.</label>',next:'Open phone Settings',gate:true},
 {title:ios?'Open Profile Downloaded':'Find CA certificate installation',body:ios?'<p>Leave this browser and open iPhone <b>Settings</b>. Tap <b>Profile Downloaded</b> near the top.</p><details><summary>Profile Downloaded is missing</summary><p>Return here and download the profile again, then open Settings promptly. A downloaded profile expires after eight minutes if not installed.</p></details>':'<p>Leave this browser and open phone <b>Settings</b>. Look under <b>Security → Encryption & credentials → Install a certificate → CA certificate</b>.</p><p>Names vary by phone. Try searching Settings for “certificate” or “credentials.” Do not choose a Wi-Fi client certificate instead.</p>',next:'I found the installation screen'},
 {title:'Install the verified certificate',body:ios?'<p>In the Vault Spend profile screen, tap <b>Install</b> in the upper-right corner. Follow the phone’s prompts.</p><p>If asked for your phone passcode, enter it only in Settings, never in this page.</p>':'<p>Choose the verified <b>vault-spend-local-root.crt</b> file from Downloads. Follow the phone’s prompts to install it.</p><p>If your phone is managed by work or school and installation is blocked, pause rather than changing its management or security settings.</p>',next:ios?'Enable browser trust':'Return to the browser'},
 ...(ios?[{title:'Turn on certificate trust',body:'<p>In iPhone Settings, open <b>General → About → Certificate Trust Settings</b>.</p><p>Under <b>Enable full trust for root certificates</b>, enable the verified Vault Spend local certificate. Confirm the phone’s prompt.</p><details><summary>There is no Vault Spend switch</summary><p>Check that you installed the profile. Downloading it alone is not enough.</p></details>',next:'Return to the browser'}]:[]),
 {title:'Open the secure viewer',body:'<p>Return to this browser tab. Open the viewer below. It must open without a certificate warning.</p><p>Then return to Vault Spend on your computer and create a pairing QR. Approve this phone there and choose its profiles. This certificate page cannot approve your phone.</p><p>If you want a home-screen shortcut, add and open it before pairing. Its storage may be separate.</p><p>After pairing, save your first snapshot and wait for <b>Ready offline</b>.</p><a class="download" href="'+document.getElementById('viewer').getAttribute('href')+'">Open secure viewer</a>',next:'Review these instructions'}
 ];
 step=Math.min(step,steps.length-1);const s=steps[step];
 guide.innerHTML='<p class="small">Step '+(step+1)+' of '+steps.length+'</p><h2 tabindex="-1">'+s.title+'</h2>'+s.body+'<div class="actions"><button id="back" '+(step===0?'disabled':'')+'>Back</button><button id="next" class="primary" '+(s.gate?'disabled':'')+'>'+s.next+'</button></div>';
 document.getElementById('back').onclick=()=>{step--;render();};
 document.getElementById('next').onclick=()=>{step=(step+1)%steps.length;render();};
 const verified=document.getElementById('verified');if(verified)verified.onchange=()=>{document.getElementById('next').disabled=!verified.checked;};
 guide.querySelector('h2').focus();
}
for(const value of ['ios','android'])document.getElementById(value).onclick=()=>{phone=value;step=0;document.getElementById('ios').setAttribute('aria-pressed',value==='ios');document.getElementById('android').setAttribute('aria-pressed',value==='android');render();};
render();

// Only appearance choices are stored; this certificate page has no financial access.
function appearance(kind,value){
 document.documentElement.dataset[kind]=value;
 document.querySelectorAll('[data-'+kind+'-choice]').forEach(button=>button.setAttribute('aria-pressed',button.dataset[kind+'Choice']===value));
 try{localStorage.setItem('vault-setup-'+kind,value);}catch{ /* Choices still work when storage is unavailable. */ }
}
for(const [kind,allowed,fallback] of [['palette',['transparent','futuristic','retro'],'transparent'],['mode',['system','light','dark'],'system']]){
 let value=fallback;try{const saved=localStorage.getItem('vault-setup-'+kind);if(allowed.includes(saved))value=saved;}catch{ /* No stored preference. */ }
 appearance(kind,value);
 document.querySelectorAll('[data-'+kind+'-choice]').forEach(button=>button.addEventListener('click',()=>appearance(kind,button.dataset[kind+'Choice'])));
}
