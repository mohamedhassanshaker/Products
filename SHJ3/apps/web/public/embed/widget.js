"use strict";(()=>{var V=Object.defineProperty;var q=(s,t,r)=>t in s?V(s,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):s[t]=r;var d=(s,t,r)=>q(s,typeof t!="symbol"?t+"":t,r);var e={paper:"#F6F5F1",panel:"#FFFFFF",sand100:"#EFEDE7",sand200:"#E3E1DA",sand400:"#8F8B81",ink900:"#20242B",ink500:"#5B6270",green800:"#15584A",green600:"#1F6F5C",green300:"#8FD9C2",green100:"#DDEDE7",rust700:"#9E4230",rust600:"#B4553F",rust100:"#F5E3DD",slate950:"#14171C",slate900:"#1B1F26",slate800:"#232830",slate600:"#6A7280",slate200:"#A2A9B5",slate050:"#EDEEF0",spaceUnit:"0.25rem",radiusUnit:"0.5rem"};var P=Object.keys(e);var w=["background","foreground","surfaceSunken","card","cardForeground","popover","popoverForeground","muted","mutedForeground","border","borderStrong","input","ring","ringOffset","overlay","primary","primaryForeground","primaryHover","secondary","secondaryForeground","accent","accentForeground","success","successForeground","successSubtle","successStrong","warning","warningForeground","warningSubtle","warningStrong","destructive","destructiveForeground","destructiveSubtle","destructiveStrong","info","infoForeground","infoSubtle","infoStrong","chatUserBubble","chatUserBubbleForeground","chatAssistantBubble","chatAssistantBubbleForeground","chatMetaForeground","chatDisclaimer","chatDisclaimerForeground","chatComposer","chatTyping","sidebar","sidebarForeground","sidebarMutedForeground","sidebarAccent","sidebarActiveSurface","sidebarBorder","chart1","chart2","chart3","chart4","chart5","chart6","selection","selectionForeground","skeleton","codeSurface","codeForeground","disabledSurface","disabledForeground"],_=["overlay"],G={background:e.paper,foreground:e.ink900,surfaceSunken:e.sand100,card:e.panel,cardForeground:e.ink900,popover:e.panel,popoverForeground:e.ink900,muted:e.sand100,mutedForeground:e.ink500,border:e.sand200,borderStrong:e.sand400,input:e.panel,ring:e.green600,ringOffset:e.paper,overlay:"rgb(32 36 43 / 0.44)",primary:e.green600,primaryForeground:e.panel,primaryHover:"#1A5D4D",secondary:e.sand100,secondaryForeground:e.ink900,accent:e.green100,accentForeground:e.green800,success:e.green600,successForeground:e.panel,successSubtle:e.green100,successStrong:e.green800,warning:"#8A5A12",warningForeground:e.panel,warningSubtle:"#F7EBD4",warningStrong:"#6E4709",destructive:e.rust600,destructiveForeground:e.panel,destructiveSubtle:e.rust100,destructiveStrong:e.rust700,info:"#2A5D9F",infoForeground:e.panel,infoSubtle:"#DFE9F6",infoStrong:"#1F4C86",chatUserBubble:"#D7EFE7",chatUserBubbleForeground:e.ink900,chatAssistantBubble:"#F1EDE4",chatAssistantBubbleForeground:e.ink900,chatMetaForeground:e.ink500,chatDisclaimer:e.sand100,chatDisclaimerForeground:e.ink500,chatComposer:e.panel,chatTyping:e.ink500,sidebar:e.sand100,sidebarForeground:e.ink900,sidebarMutedForeground:e.ink500,sidebarAccent:e.green600,sidebarActiveSurface:e.green100,sidebarBorder:e.sand200,chart1:e.green600,chart2:"#2A5D9F",chart3:"#8A5A12",chart4:e.rust600,chart5:e.ink500,chart6:"#6E4B8F",selection:e.green100,selectionForeground:e.ink900,skeleton:e.sand100,codeSurface:e.sand100,codeForeground:e.ink900,disabledSurface:e.sand100,disabledForeground:"#8A8F99"},Y={background:e.slate950,foreground:e.slate050,surfaceSunken:"#101317",card:e.slate900,cardForeground:e.slate050,popover:"#20252D",popoverForeground:e.slate050,muted:e.slate800,mutedForeground:e.slate200,border:"#2E343E",borderStrong:e.slate600,input:e.slate900,ring:"#5FC7AA",ringOffset:e.slate950,overlay:"rgb(10 12 15 / 0.62)",primary:"#4FB79B",primaryForeground:e.slate950,primaryHover:"#63C6AB",secondary:e.slate800,secondaryForeground:e.slate050,accent:"#12332B",accentForeground:e.green300,success:"#4FB79B",successForeground:e.slate950,successSubtle:"#12332B",successStrong:e.green300,warning:"#E0A33E",warningForeground:e.slate950,warningSubtle:"#38290F",warningStrong:"#E0A33E",destructive:"#E08A70",destructiveForeground:e.slate950,destructiveSubtle:"#3A211A",destructiveStrong:"#F0B49F",info:"#76A9E8",infoForeground:e.slate950,infoSubtle:"#16283D",infoStrong:"#76A9E8",chatUserBubble:"#1E3A33",chatUserBubbleForeground:e.slate050,chatAssistantBubble:"#262B33",chatAssistantBubbleForeground:e.slate050,chatMetaForeground:e.slate200,chatDisclaimer:e.slate800,chatDisclaimerForeground:e.slate200,chatComposer:"#20252D",chatTyping:e.slate200,sidebar:"#141A18",sidebarForeground:e.slate050,sidebarMutedForeground:e.slate200,sidebarAccent:"#6FCDB0",sidebarActiveSurface:"#1E2B27",sidebarBorder:"#232B28",chart1:"#4FB79B",chart2:"#76A9E8",chart3:"#E0A33E",chart4:"#E08A70",chart5:e.slate200,chart6:"#B48FD6",selection:"#12332B",selectionForeground:e.slate050,skeleton:e.slate800,codeSurface:"#101317",codeForeground:e.slate050,disabledSurface:e.slate900,disabledForeground:"#6E7684"},p={light:G,dark:Y},O=["ibm-plex-sans","ibm-plex-mono","ibm-plex-sans-arabic","noto-sans","noto-sans-arabic","system-ui","dubai"],A={"ibm-plex-sans":'"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',"ibm-plex-mono":'"IBM Plex Mono", "Cascadia Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',"ibm-plex-sans-arabic":'"IBM Plex Sans Arabic", "Noto Sans Arabic", "Dubai", "Geeza Pro", Tahoma, sans-serif',"noto-sans":'"Noto Sans", "Segoe UI", system-ui, -apple-system, Arial, sans-serif',"noto-sans-arabic":'"Noto Sans Arabic", "IBM Plex Sans Arabic", "Dubai", Tahoma, sans-serif',"system-ui":'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',dubai:'"Dubai", "IBM Plex Sans Arabic", "Noto Sans Arabic", Tahoma, sans-serif'},b={fontSans:A["ibm-plex-sans"],fontMono:A["ibm-plex-mono"],fontArabic:A["ibm-plex-sans-arabic"],fontSizeBase:"0.875rem",fontScaleRatio:"1.2",text2xs:"0.6875rem",textXs:"0.75rem",textSm:"0.8125rem",textBase:"0.875rem",textMd:"1rem",textLg:"1.125rem",textXl:"1.375rem",text2xl:"1.75rem",text3xl:"2.125rem",leadingTight:"1.2",leadingSnug:"1.35",leadingNormal:"1.5",leadingRelaxed:"1.65",leadingArabic:"1.75",fontWeightRegular:"400",fontWeightMedium:"500",fontWeightSemibold:"600",fontWeightBold:"700",trackingTight:"-0.011em",trackingNormal:"0",trackingWide:"0.04em"},g={spaceUnit:"0.25rem",densityScale:"1",space0:"0",spacePx:"1px",space1:"calc(var(--space-unit) * 1 * var(--density-scale))",space2:"calc(var(--space-unit) * 2 * var(--density-scale))",space3:"calc(var(--space-unit) * 3 * var(--density-scale))",space4:"calc(var(--space-unit) * 4 * var(--density-scale))",space5:"calc(var(--space-unit) * 5 * var(--density-scale))",space6:"calc(var(--space-unit) * 6 * var(--density-scale))",space8:"calc(var(--space-unit) * 8 * var(--density-scale))",space10:"calc(var(--space-unit) * 10 * var(--density-scale))",space12:"calc(var(--space-unit) * 12 * var(--density-scale))",space16:"calc(var(--space-unit) * 16 * var(--density-scale))",space20:"calc(var(--space-unit) * 20 * var(--density-scale))",space24:"calc(var(--space-unit) * 24 * var(--density-scale))",controlHeightSm:"calc(1.5rem + var(--space-2))",controlHeightMd:"calc(1.75rem + var(--space-3))",controlHeightLg:"calc(2rem + var(--space-4))",rowHeight:"calc(2rem + var(--space-4))",pageGutter:"var(--space-6)"};var h={radiusRoot:"0.5rem",radiusXs:"calc(var(--radius-root) * 0.25)",radiusSm:"calc(var(--radius-root) * 0.5)",radiusMd:"calc(var(--radius-root) * 0.75)",radiusLg:"var(--radius-root)",radiusXl:"calc(var(--radius-root) * 1.5)",radius2xl:"calc(var(--radius-root) * 2)",radiusFull:"9999px"};var f={shadowDepth:"1",shadowColor:"32 36 43",shadowXs:"0 1px 1px rgb(var(--shadow-color) / calc(0.05 * var(--shadow-depth)))",shadowSm:"0 1px 2px rgb(var(--shadow-color) / calc(0.07 * var(--shadow-depth))), 0 1px 1px rgb(var(--shadow-color) / calc(0.04 * var(--shadow-depth)))",shadowMd:"0 2px 6px rgb(var(--shadow-color) / calc(0.08 * var(--shadow-depth))), 0 1px 2px rgb(var(--shadow-color) / calc(0.05 * var(--shadow-depth)))",shadowLg:"0 8px 20px rgb(var(--shadow-color) / calc(0.10 * var(--shadow-depth))), 0 2px 6px rgb(var(--shadow-color) / calc(0.06 * var(--shadow-depth)))",shadowXl:"0 18px 44px rgb(var(--shadow-color) / calc(0.14 * var(--shadow-depth))), 0 4px 12px rgb(var(--shadow-color) / calc(0.08 * var(--shadow-depth)))",shadowInset:"inset 0 1px 2px rgb(var(--shadow-color) / calc(0.06 * var(--shadow-depth)))"},H={light:f.shadowColor,dark:"4 6 9"};var R={zBase:"0",zDropdown:"1000",zSticky:"1100",zOverlay:"1200",zModal:"1300",zPopover:"1400",zToast:"1500",zTooltip:"1600"},N={durationInstant:"50ms",durationFast:"120ms",durationNormal:"200ms",durationSlow:"320ms",durationSlower:"480ms",easeStandard:"cubic-bezier(0.2, 0, 0, 1)",easeOut:"cubic-bezier(0, 0, 0.2, 1)",easeIn:"cubic-bezier(0.4, 0, 1, 1)",easeEmphasised:"cubic-bezier(0.3, 0, 0, 1)",motionScale:"1"};function F(s){return{...p[s],...b,...g,...h,...f,shadowColor:H[s],...R,...N}}var M=Object.keys(F("light"));var C={buttonRadius:"var(--radius-md)",buttonHeightSm:"var(--control-height-sm)",buttonHeightMd:"var(--control-height-md)",buttonHeightLg:"var(--control-height-lg)",buttonPaddingInline:"var(--space-4)",inputRadius:"var(--radius-sm)",inputBorder:"var(--border-strong)",inputHeight:"var(--control-height-md)",badgeRadius:"var(--radius-full)",badgePaddingInline:"var(--space-2)",badgeFontSize:"var(--text-2xs)",cardRadius:"var(--radius-lg)",cardBorder:"var(--border)",cardPadding:"var(--space-4)",cardShadow:"var(--shadow-sm)",sidebarWidth:"16rem",sidebarWidthCollapsed:"3.5rem",sidebarItemRadius:"var(--radius-md)",sidebarStyle:'"neutral"',chatBubbleRadius:"var(--radius-lg)",chatBubbleMaxInlineSize:"34rem",tableRowHeight:"var(--row-height)",tableHeaderSurface:"var(--muted)",tableCellPaddingInline:"var(--space-3)",tableBorder:"var(--border)",tableStickyShadow:"var(--shadow-xs)",matrixCellSize:"calc(var(--row-height) * 0.9)",matrixHeaderInlineSize:"14rem",graphNodeRadius:"var(--radius-sm)",graphEdgeStroke:"var(--border-strong)",graphCanvasSurface:"var(--card)",graphGridLine:"var(--border)",flowNodeInlineSize:"13rem",wizardStepIndicatorSize:"1.5rem",subtabUnderlineThickness:"2px",subtabGap:"var(--space-5)",summaryStripSurface:"var(--surface-sunken)",summaryStripBorderInlineStart:"3px solid var(--border-strong)",progressTrackHeight:"6px",focusRingWidth:"2px",focusRingOffset:"2px"};var k=Object.keys(C);var xe=new Set(w),ve=new Set(_),te=new Set([...M,...k]);var de=64*1024;var Ne=new Set(w),Fe=new Set(O);var I={border:"Decorative divider and card hairline only; never a control boundary (\xA74.1, \xA710.2)",sidebarBorder:"Decorative divider, same class as `border`",ringOffset:"The focus ring's halo. It tracks `background` and is not a foreground on a surface (\xA74.1, \xA710.3)",overlay:"Modal scrim; carries no text and no boundary (\xA710.2)",skeleton:"Loading placeholder; carries no text (\xA710.2)",disabledSurface:"WCAG 1.4.3 excludes disabled controls (\xA74.5, \xA710.2)",disabledForeground:"WCAG 1.4.3 excludes disabled controls, and a disabled control that looks enabled is the worse failure (\xA74.5)"},K=new Set(Object.keys(I));var $={schemaVersion:1,metadata:{name:"Sharjah Dark",author:"Platform",createdAt:"2026-09-08T00:00:00Z",readOnly:!0},mode:"dark",direction:"locale",assets:{appTitle:"SHJ3 Assistant"},typography:{fontSans:"ibm-plex-sans",fontMono:"ibm-plex-mono",fontArabic:"ibm-plex-sans-arabic",baseSize:"0.875rem",scaleRatio:1.2,baseWeight:400},geometry:{radiusRoot:"0.5rem",density:"comfortable",shadowDepth:1,sidebarStyle:"neutral",sidebarWidth:"16rem"},tokens:p.dark};var D={schemaVersion:1,metadata:{name:"Sharjah Default",author:"Platform",createdAt:"2026-09-08T00:00:00Z",readOnly:!0},mode:"light",direction:"locale",assets:{appTitle:"SHJ3 Assistant"},typography:{fontSans:"ibm-plex-sans",fontMono:"ibm-plex-mono",fontArabic:"ibm-plex-sans-arabic",baseSize:"0.875rem",scaleRatio:1.2,baseWeight:400},geometry:{radiusRoot:"0.5rem",density:"comfortable",shadowDepth:1,sidebarStyle:"neutral",sidebarWidth:"16rem"},tokens:p.light};var c=p.light,j=`
  --space-unit: ${g.spaceUnit};
  --density-scale: ${g.densityScale};
  --radius-root: ${h.radiusRoot};
  --shadow-color: ${f.shadowColor};
  --shadow-depth: ${f.shadowDepth};
  --space-1: ${g.space1};
  --space-2: ${g.space2};
  --space-3: ${g.space3};
  --radius-sm: ${h.radiusSm};
  --radius-md: ${h.radiusMd};
  --radius-lg: ${h.radiusLg};
  --radius-full: ${h.radiusFull};
  --shadow-lg: ${f.shadowLg};
  --shadow-xl: ${f.shadowXl};
  --text-xs: ${b.textXs};
  --text-sm: ${b.textSm};
  --text-base: ${b.textBase};
  --text-lg: ${b.textLg};
  --widget-hairline: 1px; /* design-gate-allow: a border hairline width has no dedicated token in this scale (packages/tokens/src/semantic.ts's own components/borders are all expressed the same way) \u2014 a structural CSS constant, not a brand-affecting design decision. */
  --card: ${c.card};
  --card-foreground: ${c.cardForeground};
  --border: ${c.border};
  --primary: ${c.primary};
  --primary-foreground: ${c.primaryForeground};
  --chat-user-bubble: ${c.chatUserBubble};
  --chat-user-bubble-foreground: ${c.chatUserBubbleForeground};
  --chat-assistant-bubble: ${c.chatAssistantBubble};
  --chat-assistant-bubble-foreground: ${c.chatAssistantBubbleForeground};
  --chat-meta-foreground: ${c.chatMetaForeground};
  --chat-disclaimer: ${c.chatDisclaimer};
  --chat-disclaimer-foreground: ${c.chatDisclaimerForeground};
  --chat-composer: ${c.chatComposer};
`,ce=c.primary,L=class{constructor(){d(this,"buffer","")}push(t){this.buffer+=t.replace(/\r\n/g,`
`);let r=[],o;for(;(o=this.buffer.indexOf(`

`))!==-1;){let a=this.buffer.slice(0,o);this.buffer=this.buffer.slice(o+2);let n=null,i=[];for(let l of a.split(`
`)){if(!l||l.startsWith(":"))continue;let y=l.indexOf(":"),m=y===-1?l:l.slice(0,y),x=y===-1?"":l.slice(y+1).replace(/^ /,"");m==="event"?n=x:m==="data"&&i.push(x)}i.length>0&&r.push({event:n,data:i.join(`
`)})}return r}};function le(){let s=document.currentScript;if(!s)throw new Error("SHJ3 widget: document.currentScript is unavailable \u2014 this bundle must be loaded via a plain <script> tag, not dynamically injected after the fact without `src` preserved.");return s}function ue(s){return new URL(s.src,window.location.href).origin}async function W(s,t){let r=await fetch(s,{...t,credentials:"include"});if(!r.ok){let o=`Request failed (${r.status})`;try{let a=await r.json();o=a.detail??a.code??o}catch{}throw new Error(o)}return await r.json()}function T(s){let t=document.createElement("div");return t.textContent=s,t.innerHTML}var B=class{constructor(t){d(this,"base");d(this,"channelKey");d(this,"bootstrap",null);d(this,"conversationId",null);d(this,"messages",[]);d(this,"open",!1);d(this,"expanded",!1);d(this,"disclaimerDismissed",!1);d(this,"busy",!1);d(this,"recognizing",!1);d(this,"recognition");d(this,"root");d(this,"container");if(this.base=ue(t),this.channelKey=t.dataset.channelKey??"",!this.channelKey)throw console.error("[SHJ3 widget] missing data-channel-key attribute \u2014 refusing to initialise."),new Error("SHJ3 widget: data-channel-key is required.");this.container=document.createElement("div"),this.container.setAttribute("data-shj3-widget-host",""),document.body.appendChild(this.container),this.root=this.container.attachShadow({mode:"open"})}async start(){try{this.bootstrap=await W(`${this.base}/api/public/v1/widget/bootstrap?channelKey=${encodeURIComponent(this.channelKey)}`,{headers:{accept:"application/json"}})}catch(t){console.error("[SHJ3 widget] bootstrap failed",t),this.renderUnavailable();return}this.open=this.bootstrap.defaultState==="Expanded",this.render()}renderUnavailable(){this.root.innerHTML=`
      <style>
        :host { all: initial; ${j} }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        .notice {
          position: fixed; inset-block-end: var(--space-3); inset-inline-end: var(--space-3);
          max-width: calc(var(--space-3) * 16);
          background: var(--card); color: var(--card-foreground);
          border: var(--widget-hairline) solid var(--border); /* design-gate-allow: --widget-hairline, see its declaration above. */
          font-size: var(--text-xs); line-height: 1.4;
          padding: var(--space-2) var(--space-3); border-radius: var(--radius-md);
          box-shadow: var(--shadow-lg);
          z-index: 2147483000;
        }
      </style>
      <div class="notice" role="status">SHJ3 Assistant is not available on this page.</div>
    `}async openConversation(){if(this.conversationId||!this.bootstrap)return;let t=await W(`${this.base}/api/public/v1/conversations`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({channelKey:this.channelKey})});this.conversationId=t.conversationId,this.messages=[{id:"greeting",role:"assistant",text:t.greeting.content}],this.render()}async send(t){let r=t.trim();if(!r||this.busy||!this.conversationId)return;this.busy=!0;let o=`u-${Date.now()}`,a=`a-${Date.now()}`;this.messages.push({id:o,role:"user",text:r}),this.messages.push({id:a,role:"assistant",text:"",streaming:!0}),this.render();try{let n=await fetch(`${this.base}/api/public/v1/conversations/${this.conversationId}/turns`,{method:"POST",credentials:"include",headers:{"content-type":"application/json",accept:"text/event-stream"},body:JSON.stringify({content:r,inputMode:"text",clientTurnId:o})});if(!n.ok||!n.body)throw new Error(`Turn failed (${n.status})`);let i=n.body.getReader(),l=new TextDecoder,y=new L,m=a,x="";for(;;){let{done:X,value:J}=await i.read();if(X)break;for(let v of y.push(l.decode(J,{stream:!0}))){let S={};try{S=JSON.parse(v.data)}catch{continue}if(v.event==="turn_started"&&typeof S.turnId=="string"){let u=this.messages.find(E=>E.id===m);u&&(u.id=S.turnId),m=S.turnId}else if(v.event==="token"){x+=String(S.text??"");let u=this.messages.find(E=>E.id===m);u&&(u.text=x),this.render()}else if(v.event==="done"||v.event==="error"){let u=this.messages.find(E=>E.id===m);u&&(u.streaming=!1,v.event==="error"&&typeof S.detail=="string"&&!x&&(u.text=S.detail)),this.render()}}}}catch(n){console.error("[SHJ3 widget] turn failed",n);let i=this.messages.find(l=>l.id===a);i&&(i.streaming=!1,i.text=i.text||"Something went wrong. Please try again.")}finally{this.busy=!1,this.render()}}async rate(t,r){let o=this.messages.find(a=>a.id===t);o&&(o.rating=o.rating===r?null:r,this.render());try{o?.rating?await fetch(`${this.base}/api/public/v1/turns/${t}/feedback`,{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({rating:o.rating})}):await fetch(`${this.base}/api/public/v1/turns/${t}/feedback`,{method:"DELETE",credentials:"include"})}catch{}}speak(t){if(!("speechSynthesis"in window))return;window.speechSynthesis.cancel();let r=new SpeechSynthesisUtterance(t);window.speechSynthesis.speak(r)}micAvailable(){return"webkitSpeechRecognition"in window||"SpeechRecognition"in window}toggleMic(t){if(!this.micAvailable())return;let r=window.SpeechRecognition??window.webkitSpeechRecognition;if(!r)return;if(this.recognizing){this.recognition?.stop(),this.recognizing=!1;return}let o=new r;o.continuous=!1,o.interimResults=!0,o.onresult=a=>{let i=a.results[a.results.length-1]?.[0]?.transcript??"";t.value=i},o.onend=()=>{this.recognizing=!1,this.render()},this.recognition=o,this.recognizing=!0,o.start(),this.render()}render(){if(!this.bootstrap)return;let t=this.bootstrap,r=t.direction==="RTL"?"rtl":"ltr",o=t.theme.colorTokens["color.brand.primary"]??ce,a=t.launcherPosition==="BottomLeft"?"left":"right";this.root.innerHTML=`
      <style>
        :host {
          all: initial;
          ${j}
          --primary: ${o};
        }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        .fab {
          position: fixed; bottom: var(--space-3); ${a}: var(--space-3);
          width: calc(var(--space-3) * 7); height: calc(var(--space-3) * 7);
          border-radius: var(--radius-full); background: var(--primary);
          color: var(--primary-foreground); border: none; cursor: pointer;
          box-shadow: var(--shadow-lg); font-size: var(--text-lg);
          z-index: 2147483000;
        }
        .panel {
          position: fixed; bottom: calc(var(--space-3) * 6); ${a}: var(--space-3);
          width: ${this.expanded?"560px":"400px"}; max-width: calc(100vw - var(--space-3) * 2); /* design-gate-allow: 400px/560px are FR-CONV-01's own literal, spec-mandated docked/expanded widths (SHJ3-wireframes-guide.md A1 "Docked... 400 px... Expanded... 560 px") \u2014 a product layout requirement, not a brand-able design-system value. */
          height: 70vh; max-height: 640px; /* design-gate-allow: 640px mirrors the same spec-mandated panel sizing as the width above, not a token candidate. */
          background: var(--card); border-radius: var(--radius-lg);
          box-shadow: var(--shadow-xl);
          display: ${this.open?"flex":"none"}; flex-direction: column; overflow: hidden;
          z-index: 2147483000; direction: ${r};
        }
        .header {
          background: var(--primary); color: var(--primary-foreground);
          padding: var(--space-3); display:flex; justify-content:space-between; align-items:center;
        }
        .header button { background: transparent; border: none; color: inherit; cursor: pointer; font-size: var(--text-base); }
        .disclaimer {
          background: var(--chat-disclaimer); color: var(--chat-disclaimer-foreground);
          font-size: var(--text-xs); padding: var(--space-2) var(--space-3);
          display:flex; justify-content:space-between; gap: var(--space-2);
        }
        .thread { flex: 1; overflow-y: auto; padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
        .msg { max-width: 85%; padding: var(--space-2) var(--space-3); border-radius: var(--radius-lg); font-size: var(--text-sm); white-space: pre-wrap; }
        .msg.user { align-self: flex-end; background: var(--chat-user-bubble); color: var(--chat-user-bubble-foreground); }
        .msg.assistant { align-self: flex-start; background: var(--chat-assistant-bubble); color: var(--chat-assistant-bubble-foreground); }
        .meta { display:flex; gap: var(--space-1); font-size: var(--text-xs); color: var(--chat-meta-foreground); margin-top: var(--space-1); }
        .meta button { background:none; border:none; cursor:pointer; color: inherit; font-size: var(--text-xs); }
        .chips { display:flex; flex-wrap:wrap; gap: var(--space-2); padding: 0 var(--space-3) var(--space-2); }
        .chip {
          border: var(--widget-hairline) solid var(--primary); color: var(--primary); background: var(--card); /* design-gate-allow: --widget-hairline is the local, non-token border-width constant declared and justified above. */
          border-radius: var(--radius-full); padding: var(--space-1) var(--space-2);
          font-size: var(--text-xs); cursor:pointer;
        }
        .composer { display:flex; gap: var(--space-2); padding: var(--space-2); border-top: var(--widget-hairline) solid var(--border); } /* design-gate-allow: --widget-hairline, see its declaration above. */
        .composer textarea {
          flex:1; resize:none; border: var(--widget-hairline) solid var(--border); border-radius: var(--radius-md); /* design-gate-allow: --widget-hairline, see its declaration above. */
          padding: var(--space-2); font-size: var(--text-sm); min-height: 2.25rem;
        }
        .composer button {
          border:none; border-radius: var(--radius-md); padding: 0 var(--space-3); cursor:pointer;
          background: var(--primary); color: var(--primary-foreground);
        }
        .composer button[disabled] { opacity:.5; cursor:not-allowed; }
      </style>
      <button class="fab" aria-label="${this.open?"Close":"Open"} SHJ3 Assistant" title="SHJ3 Assistant">${this.open?"\xD7":"\u2726"}</button>
      <div class="panel" role="dialog" aria-label="SHJ3 Assistant">
        <div class="header">
          <strong>SHJ3 Assistant</strong>
          <div>
            <button class="expand-btn" title="Expand/collapse">${this.expanded?"\u25AD":"\u25A2"}</button>
            <button class="close-btn" title="Close">\xD7</button>
          </div>
        </div>
        ${t.disclaimerText&&!this.disclaimerDismissed?`<div class="disclaimer"><span>${T(t.disclaimerText)}</span>${t.showDisclaimerDismiss?'<button class="dismiss-disclaimer">\xD7</button>':""}</div>`:""}
        <div class="thread" role="log" aria-live="polite">
          ${this.messages.map(n=>`
            <div class="msg ${n.role}" data-turn-id="${n.id}">
              <span class="sr-only">${n.role==="user"?"You said:":"SHJ3 Assistant said:"}</span>
              ${T(n.text)}
              ${n.role==="assistant"&&!n.streaming?`<div class="meta">
                      <button class="speak-btn" data-turn-id="${n.id}" title="Read aloud">\u{1F50A}</button>
                      <button class="rate-btn" data-turn-id="${n.id}" data-rating="up" title="Thumbs up">${n.rating==="up"?"\u{1F44D}\u2713":"\u{1F44D}"}</button>
                      <button class="rate-btn" data-turn-id="${n.id}" data-rating="down" title="Thumbs down">${n.rating==="down"?"\u{1F44E}\u2713":"\u{1F44E}"}</button>
                    </div>`:""}
            </div>`).join("")}
        </div>
        <div class="chips">
          ${t.chips.map(n=>`<button class="chip" data-chip='${T(JSON.stringify(n))}'>${T(n.label)}</button>`).join("")}
        </div>
        <div class="composer">
          <button class="mic-btn" title="${this.micAvailable()?"Start voice input":"Voice input unavailable in this browser (reason: mic.unsupported_browser)"}" ${this.micAvailable()?"":"disabled"}>${this.recognizing?"\u23FA":"\u{1F3A4}"}</button>
          <textarea class="composer-input" placeholder="${T(t.composerPlaceholder)}" rows="1" ${this.busy?"disabled":""}></textarea>
          <button class="send-btn" ${this.busy?"disabled":""}>Send</button>
        </div>
      </div>
    `,this.wireEvents()}wireEvents(){this.root.querySelector(".fab")?.addEventListener("click",()=>{this.open=!this.open,this.open&&this.openConversation(),this.render()}),this.root.querySelector(".close-btn")?.addEventListener("click",()=>{this.open=!1,this.render()}),this.root.querySelector(".expand-btn")?.addEventListener("click",()=>{this.expanded=!this.expanded,this.render()}),this.root.querySelector(".dismiss-disclaimer")?.addEventListener("click",()=>{this.disclaimerDismissed=!0,this.render()});let r=this.root.querySelector(".composer-input"),o=()=>{if(!r)return;let a=r.value;r.value="",this.send(a)};this.root.querySelector(".send-btn")?.addEventListener("click",o),r?.addEventListener("keydown",a=>{a.key==="Enter"&&!a.shiftKey&&!a.isComposing&&(a.preventDefault(),o())}),this.root.querySelector(".mic-btn")?.addEventListener("click",()=>{r&&this.toggleMic(r)});for(let a of this.root.querySelectorAll(".chip"))a.addEventListener("click",()=>{let n=a.getAttribute("data-chip");if(!n)return;let i=JSON.parse(n);this.send(i.label)});for(let a of this.root.querySelectorAll(".speak-btn"))a.addEventListener("click",()=>{let n=a.getAttribute("data-turn-id"),i=this.messages.find(l=>l.id===n);i&&this.speak(i.text)});for(let a of this.root.querySelectorAll(".rate-btn"))a.addEventListener("click",()=>{let n=a.getAttribute("data-turn-id"),i=a.getAttribute("data-rating");n&&i&&this.rate(n,i)})}};(function(){let t=le();new B(t).start()})();})();
//# sourceMappingURL=widget.js.map
