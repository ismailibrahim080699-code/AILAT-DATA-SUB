/* AILAT DATA SUB shared branded notification + confirmation dialogs */
(()=> {
 if(window.AILAT?.dialogReady)return;
 let root,resolveCurrent=null;
 function ensure(){
  if(root)return;
  root=document.createElement("div");root.id="ailat-dialog-backdrop";
  root.innerHTML='<section id="ailat-dialog" role="dialog" aria-modal="true" aria-labelledby="ailat-dialog-title" aria-describedby="ailat-dialog-message"><div class="ailat-dialog-icon" id="ailat-dialog-icon">i</div><h2 id="ailat-dialog-title">AILAT DATA SUB</h2><p id="ailat-dialog-message"></p><div class="ailat-dialog-actions" id="ailat-dialog-actions"></div></section>';
  document.body.append(root);
  root.addEventListener("click",e=>{if(e.target===root)finish(false)});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&root.classList.contains("open"))finish(false)});
 }
 function finish(value){if(!root)return;root.classList.remove("open");const r=resolveCurrent;resolveCurrent=null;if(r)r(value)}
 function show(message,{title="AILAT DATA SUB",kind="info",confirm=false,okText="OK",cancelText="Cancel"}={}){
  ensure();if(resolveCurrent)finish(false);
  const panel=root.querySelector("#ailat-dialog");panel.dataset.kind=kind;
  root.querySelector("#ailat-dialog-title").textContent=title;
  root.querySelector("#ailat-dialog-message").textContent=String(message??"");
  root.querySelector("#ailat-dialog-icon").textContent=kind==="success"?"✓":kind==="error"?"!":kind==="confirm"?"?":"i";
  const actions=root.querySelector("#ailat-dialog-actions");actions.replaceChildren();
  if(confirm){const cancel=document.createElement("button");cancel.className="ailat-dialog-cancel";cancel.textContent=cancelText;cancel.onclick=()=>finish(false);actions.append(cancel)}
  const ok=document.createElement("button");ok.className="ailat-dialog-ok";ok.textContent=okText;ok.onclick=()=>finish(true);actions.append(ok);
  root.classList.add("open");ok.focus();
  return new Promise(resolve=>{resolveCurrent=resolve});
 }
 window.AILAT=window.AILAT||{};
 window.AILAT.dialogReady=true;
 window.AILAT.notify=(message,kind="info",title)=>show(message,{kind,title:title||({success:"Success",error:"Something went wrong",warning:"Please Note"}[kind]||"AILAT DATA SUB")});
 window.AILAT.confirm=(message,options={})=>show(message,{...options,kind:"confirm",confirm:true,okText:options.okText||"Yes, Continue"});\n window.AILAT.choose=(message,options={})=>new Promise(resolve=>{ensure();if(resolveCurrent)finish(null);const panel=root.querySelector("#ailat-dialog");panel.dataset.kind="info";root.querySelector("#ailat-dialog-title").textContent=options.title||"Choose Approval Method";root.querySelector("#ailat-dialog-message").textContent=String(message??"");root.querySelector("#ailat-dialog-icon").textContent="↔";const actions=root.querySelector("#ailat-dialog-actions");actions.replaceChildren();(options.choices||[]).forEach(choice=>{const button=document.createElement("button");button.className="ailat-dialog-ok";button.textContent=choice.label;button.onclick=()=>{root.classList.remove("open");resolve(choice.value)};actions.append(button)});root.classList.add("open");});
 // Native alert calls now use the AILAT branded dialog; alert is informational only.
 window.alert=(message)=>{show(message,{kind:"info",title:"AILAT DATA SUB"});};
})();