import{R}from"./index-5n03dmb9.js";import{e,t,j,x,u,T,d,f,p,m,g,b,v,A,E}from"./index-nwsya6dj.js";import"./index-v119nznk.js";import{D}from"./index-zx0j3a2z.js";var xt=e(()=>({domains:new Map,transitions:[]}),"createDefaultData"),at=xt(),Mt=e(()=>at.domains,"getDomains"),zt=e(()=>at.transitions,"getTransitions"),Lt=e((n)=>{if(!n)return;for(let o of n){let a=o.domain,r=(o.items??[]).map((l)=>({label:l.label}));at.domains.set(a,{name:a,items:r})}},"setDomains"),Nt=e((n)=>{if(!n)return;at.transitions=n.filter((o)=>{if(o.from===o.to)return t.warn(`Cynefin: self-loop transition on domain "${o.from}" is not meaningful and will be skipped.`),!1;return!0}).map((o)=>({from:o.from,to:o.to,label:o.label||void 0}))},"setTransitions"),Pt=e(()=>E({...x.cynefin,...u().cynefin}),"getConfig"),It=e(()=>{d(),at=xt()},"clear"),st={getDomains:Mt,getTransitions:zt,setDomains:Lt,setTransitions:Nt,getConfig:Pt,clear:It,setAccTitle:f,getAccTitle:p,setDiagramTitle:b,getDiagramTitle:v,getAccDescription:g,setAccDescription:m},Wt=e((n)=>{R(n,st),st.setDomains(n.domains),st.setTransitions(n.transitions)},"populate"),Rt={parse:e(async(n)=>{let o=await D("cynefin",n);t.debug(o),Wt(o)},"parse")};function ot(n){let o=n+1831565813|0;return o=Math.imul(o^o>>>15,o|1),o^=o+Math.imul(o^o>>>7,o|61),((o^o>>>14)>>>0)/4294967296}e(ot,"seededRandom");function $t(n){let o=0;for(let a=0;a<n.length;a++){let r=n.charCodeAt(a);o=(o<<5)-o+r,o|=0}return o}e($t,"hashString");function bt(n,o){if(typeof n==="number"&&Number.isFinite(n)&&n!==0)return n;return $t(o)}e(bt,"resolveSeed");function wt(n,o,a,r){let l=n/2,C=r??n*0.015,rt=7,J=o/7,h=[];for(let i=0;i<=7;i++){let k=ot(a+i*17)*C*2-C;h.push({x:l+k,y:i*J})}let F=`M${h[0].x},${h[0].y}`;for(let i=0;i<h.length-1;i++){let k=h[i],c=h[i+1],w=(k.y+c.y)/2,P=i%2===0?1:-1,M=C*1.5*P*ot(a+i*31+7),K=k.x+M,tt=w,et=c.x-M;F+=` C${K},${tt} ${et},${w} ${c.x},${c.y}`}return F}e(wt,"generateFoldPath");function Ct(n,o,a,r){let l=o/2,C=r??o*0.015,rt=7,J=n/7,h=[];for(let i=0;i<=7;i++){let k=ot(a+i*23)*C*2-C;h.push({x:i*J,y:l+k})}let F=`M${h[0].x},${h[0].y}`;for(let i=0;i<h.length-1;i++){let k=h[i],c=h[i+1],w=(k.x+c.x)/2,P=i%2===0?1:-1,M=C*1.5*P*ot(a+i*37+11),K=w,tt=k.y+M,et=w,X=c.y-M;F+=` C${K},${tt} ${et},${X} ${c.x},${c.y}`}return F}e(Ct,"generateHorizontalBoundary");function vt(n,o){let a=n/2,r=o*0.5,l=o,C=n*0.03;return[`M${a},${r}`,`C${a+C},${r+(l-r)*0.2}`,`${a-C*1.5},${r+(l-r)*0.55}`,`${a+C*0.5},${r+(l-r)*0.75}`,`C${a-C},${r+(l-r)*0.85}`,`${a+C*0.3},${r+(l-r)*0.95}`,`${a},${l}`].join(" ")}e(vt,"generateCliffPath");function Dt(n,o,a,r){return[`M${n-a},${o}`,`A${a},${r} 0 1,1 ${n+a},${o}`,`A${a},${r} 0 1,1 ${n-a},${o}`,"Z"].join(" ")}e(Dt,"generateConfusionPath");var ht={complex:{model:"Probe → Sense → Respond",practice:"Emergent Practices"},complicated:{model:"Sense → Analyse → Respond",practice:"Good Practices"},clear:{model:"Sense → Categorise → Respond",practice:"Best Practices"},chaotic:{model:"Act → Sense → Respond",practice:"Novel Practices"},confusion:{model:"",practice:"Disorder"}},Ft=e((n,o)=>{let a=n/2,r=o/2;return{complex:{cx:a/2,cy:r/2,x:0,y:0,w:a,h:r},complicated:{cx:a+a/2,cy:r/2,x:a,y:0,w:a,h:r},chaotic:{cx:a/2,cy:r+r/2,x:0,y:r,w:a,h:r},clear:{cx:a+a/2,cy:r+r/2,x:a,y:r,w:a,h:r},confusion:{cx:a,cy:r,x:a*0.7,y:r*0.7,w:a*0.6,h:r*0.6}}},"getDomainLayouts"),Vt=e(()=>{let n=j(),o=u();return E(n,o.themeVariables).cynefin},"getCynefinDomainColors"),dt=3,_t=e((n,o,a,r)=>{let l=r.db,C=l.getDomains(),rt=l.getTransitions(),J=l.getDiagramTitle(),h=l.getAccTitle(),F=l.getAccDescription(),i=l.getConfig(),k=Vt();t.debug("Rendering Cynefin diagram");let{width:c,height:w,padding:P,showDomainDescriptions:M,boundaryAmplitude:K}=i,tt=c+P*2,et=w+P*2,X={complex:k.complexBg,complicated:k.complicatedBg,clear:k.clearBg,chaotic:k.chaoticBg,confusion:k.confusionBg},V=A(o);if(T(V,et,tt,i.useMaxWidth??!0),V.attr("viewBox",`0 0 ${tt} ${et}`),h)V.append("title").text(h);if(F)V.append("desc").text(F);let _=V.append("g").attr("transform",`translate(${P}, ${P})`),nt=Ft(c,w),ft=bt(i.seed,o),kt=_.append("g").attr("class","cynefin-backgrounds"),ct=["complex","complicated","chaotic","clear"];for(let y of ct){let s=nt[y];kt.append("rect").attr("class","cynefinDomain").attr("x",s.x).attr("y",s.y).attr("width",s.w).attr("height",s.h).attr("fill",X[y]).attr("fill-opacity",0.4).attr("stroke","none")}let lt=_.append("g").attr("class","cynefin-boundaries");lt.append("path").attr("class","cynefinBoundary").attr("d",wt(c,w,ft,K)).attr("fill","none"),lt.append("path").attr("class","cynefinBoundary").attr("d",Ct(c,w,ft+100,K)).attr("fill","none"),lt.append("path").attr("class","cynefinCliff").attr("d",vt(c,w)).attr("fill","none");let Tt=c*0.15,At=w*0.15;_.append("path").attr("class","cynefinConfusion").attr("d",Dt(c/2,w/2,Tt,At)).attr("fill",X.confusion).attr("fill-opacity",0.5);let mt=_.append("g").attr("class","cynefin-labels");for(let y of ct){let s=nt[y];mt.append("text").attr("class","cynefinDomainLabel").attr("x",s.cx).attr("y",M?s.cy-30:s.cy).attr("text-anchor","middle").attr("dominant-baseline","middle").text(y.charAt(0).toUpperCase()+y.slice(1))}if(mt.append("text").attr("class","cynefinDomainLabel").attr("x",c/2).attr("y",M?w/2-10:w/2).attr("text-anchor","middle").attr("dominant-baseline","middle").text("Confusion"),M){let y=_.append("g").attr("class","cynefin-subtitles");for(let s of ct){let S=nt[s],B=ht[s];y.append("text").attr("class","cynefinSubtitle").attr("x",S.cx).attr("y",S.cy-10).attr("text-anchor","middle").attr("dominant-baseline","middle").text(B.model),y.append("text").attr("class","cynefinSubtitle").attr("x",S.cx).attr("y",S.cy+5).attr("text-anchor","middle").attr("dominant-baseline","middle").text(B.practice)}y.append("text").attr("class","cynefinSubtitle").attr("x",c/2).attr("y",w/2+8).attr("text-anchor","middle").attr("dominant-baseline","middle").text(ht.confusion.practice)}let pt=_.append("g").attr("class","cynefin-items"),H=26,yt=10,Bt=["complex","complicated","chaotic","clear","confusion"];for(let y of Bt){let s=C.get(y);if(!s||s.items.length===0)continue;let S=nt[y],B=y==="confusion",q=s.items,U=0;if(B&&s.items.length>dt)U=s.items.length-dt,q=s.items.slice(0,dt);let G;if(B){let L=M?22:14;G=S.cy+L}else G=S.cy+(M?25:15);if([...q].forEach((L,Y)=>{let I=G+Y*(H+4),O=pt.append("g"),Q=O.append("text").attr("class","cynefinItemText").attr("x",0).attr("y",H/2).attr("text-anchor","middle").attr("dominant-baseline","central").text(L.label),N=L.label.length*7,z=Q.node();if(z&&typeof z.getBBox==="function"){let it=z.getBBox();if(it.width>0)N=it.width}let W=N+yt*2,Z=S.cx-W/2;O.attr("transform",`translate(${Z}, ${I})`),O.insert("rect","text").attr("class","cynefinItem").attr("x",0).attr("y",0).attr("width",W).attr("height",H).attr("rx",4).attr("ry",4).attr("fill",X[y]).attr("fill-opacity",0.95),Q.attr("x",W/2).attr("y",H/2)}),U>0){let L=G+q.length*(H+4),Y=`+${U} more`,I=pt.append("g"),O=I.append("text").attr("class","cynefinItemText").attr("x",0).attr("y",H/2).attr("text-anchor","middle").attr("dominant-baseline","central").text(Y),Q=Y.length*7,N=O.node();if(N&&typeof N.getBBox==="function"){let Z=N.getBBox();if(Z.width>0)Q=Z.width}let z=Q+yt*2,W=S.cx-z/2;I.attr("transform",`translate(${W}, ${L})`),I.insert("rect","text").attr("class","cynefinItemOverflow").attr("x",0).attr("y",0).attr("width",z).attr("height",H).attr("rx",4).attr("ry",4).attr("fill",X[y]).attr("fill-opacity",0.6),O.attr("x",z/2).attr("y",H/2)}}if(rt.length>0){let y=V.select("defs").empty()?V.append("defs"):V.select("defs"),s=`cynefin-arrow-${o}`;y.append("marker").attr("id",s).attr("viewBox","0 0 10 10").attr("refX",9).attr("refY",5).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto-start-reverse").append("path").attr("d","M 0 0 L 10 5 L 0 10 z").attr("class","cynefinArrowHead");let S=_.append("g").attr("class","cynefin-arrows");rt.forEach((B)=>{let q=nt[B.from],U=nt[B.to];if(!q||!U)return;if(B.from===B.to){t.warn(`Cynefin renderer: skipping self-loop on domain "${B.from}"`);return}let{cx:G,cy:L}=q,{cx:Y,cy:I}=U,O=(G+Y)/2,Q=(L+I)/2,N=Y-G,z=I-L,W=Math.sqrt(N*N+z*z),Z=W*0.15,it=-z/W,St=N/W,ut=O+it*Z,gt=Q+St*Z;if(S.append("path").attr("class","cynefinArrowLine").attr("d",`M${G},${L} Q${ut},${gt} ${Y},${I}`).attr("fill","none").attr("marker-end",`url(#${s})`),B.label)S.append("text").attr("class","cynefinArrowLabel").attr("x",ut).attr("y",gt-6).attr("text-anchor","middle").attr("dominant-baseline","auto").text(B.label)})}if(J)_.append("text").attr("class","cynefinTitle").attr("x",c/2).attr("y",-P/2).attr("text-anchor","middle").attr("dominant-baseline","middle").text(J)},"draw"),Et={draw:_t},Ht=e(()=>{let n=j(),o=u();return E(n,o.themeVariables).cynefin},"getCynefinTheme"),Gt=e(()=>{let n=Ht();return`
	.cynefinDomain {
		stroke: none;
	}
	.cynefinDomainLabel {
		font-size: ${n.domainFontSize}px;
		font-weight: bold;
		fill: ${n.labelColor};
	}
	.cynefinSubtitle {
		font-size: ${n.itemFontSize-1}px;
		fill: ${n.textColor};
		font-style: italic;
	}
	.cynefinItem {
		fill-opacity: 0.95;
		stroke: ${n.boundaryColor};
		stroke-width: 1;
	}
	.cynefinItemText {
		font-size: ${n.itemFontSize}px;
		fill: ${n.textColor};
	}
	.cynefinItemOverflow {
		fill-opacity: 0.6;
		stroke: ${n.boundaryColor};
		stroke-width: 1;
		stroke-dasharray: 3 2;
	}
	.cynefinBoundary {
		stroke: ${n.boundaryColor};
		stroke-width: ${n.boundaryWidth};
		stroke-dasharray: 6 3;
	}
	.cynefinCliff {
		stroke: ${n.cliffColor};
		stroke-width: ${n.cliffWidth};
	}
	.cynefinConfusion {
		stroke: ${n.boundaryColor};
		stroke-width: 1.5;
		stroke-dasharray: 4 2;
	}
	.cynefinArrowLine {
		stroke: ${n.arrowColor};
		stroke-width: ${n.arrowWidth};
		fill: none;
	}
	.cynefinArrowHead {
		fill: ${n.arrowColor};
		stroke: none;
	}
	.cynefinArrowLabel {
		font-size: ${n.itemFontSize-1}px;
		fill: ${n.textColor};
	}
	.cynefinTitle {
		font-size: ${n.domainFontSize+2}px;
		font-weight: bold;
		fill: ${n.labelColor};
	}
	`},"styles"),Yt=Gt,Jt={parser:Rt,db:st,renderer:Et,styles:Yt};export{Jt as diagram};
