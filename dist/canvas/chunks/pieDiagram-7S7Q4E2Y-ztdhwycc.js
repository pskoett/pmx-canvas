import{R}from"./index-353m7b0p.js";import{e,t,x,k,d,f,p,m,g,b,v,r,z,qt,Vr,A,he,E}from"./index-1r72hdzb.js";import"./index-6qmsnxwy.js";import{D}from"./index-tb1wf525.js";import{De}from"./index-rh7nv68n.js";import{pe}from"./index-gf4e0et4.js";function at(a,l){return l<a?-1:l>a?1:l>=a?0:NaN}function nt(a){return a}function it(){var a=nt,l=at,H=null,I=z(0),h=z(qt),C=z(0);function s(n){var o,u=(n=Vr(n)).length,T,N,G=0,M=Array(u),c=Array(u),B=+I.apply(this,arguments),j=Math.min(qt,Math.max(-qt,h.apply(this,arguments)-B)),V,q=Math.min(Math.abs(j)/u,C.apply(this,arguments)),y=q*(j<0?-1:1),P;for(o=0;o<u;++o)if((P=c[M[o]=o]=+a(n[o],o,n))>0)G+=P;if(l!=null)M.sort(function(X,L){return l(c[X],c[L])});else if(H!=null)M.sort(function(X,L){return H(n[X],n[L])});for(o=0,N=G?(j-u*y)/G:0;o<u;++o,B=V)T=M[o],P=c[T],V=B+(P>0?P*N:0)+y,c[T]={data:n[T],index:o,value:P,startAngle:B,endAngle:V,padAngle:q};return c}return s.value=function(n){return arguments.length?(a=typeof n==="function"?n:z(+n),s):a},s.sortValues=function(n){return arguments.length?(l=n,H=null,s):l},s.sort=function(n){return arguments.length?(H=n,l=null,s):H},s.startAngle=function(n){return arguments.length?(I=typeof n==="function"?n:z(+n),s):I},s.endAngle=function(n){return arguments.length?(h=typeof n==="function"?n:z(+n),s):h},s.padAngle=function(n){return arguments.length?(C=typeof n==="function"?n:z(+n),s):C},s}var dt=x.pie,ot={sections:new Map,showData:!1,config:dt},{sections:Q,showData:lt}=ot,St=structuredClone(dt),yt=e(()=>structuredClone(St),"getConfig"),wt=e(()=>{Q=new Map,lt=ot.showData,d()},"clear"),At=e(({label:a,value:l})=>{if(l<0)throw Error(`"${a}" has invalid value: ${l}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);if(!Q.has(a))Q.set(a,l),t.debug(`added new section: ${a}, with value: ${l}`)},"addSection"),Ct=e(()=>Q,"getSections"),$t=e((a)=>{lt=a},"setShowData"),Dt=e(()=>lt,"getShowData"),pt={getConfig:yt,clear:wt,setDiagramTitle:b,getDiagramTitle:v,setAccTitle:f,getAccTitle:p,setAccDescription:m,getAccDescription:g,addSection:At,getSections:Ct,setShowData:$t,getShowData:Dt},Tt=e((a,l)=>{R(a,l),l.setShowData(a.showData),a.sections.map(l.addSection)},"populateDb"),bt={parse:e(async(a)=>{let l=await D("pie",a);t.debug(l),Tt(l,pt)},"parse")},kt=e((a)=>`
  .pieCircle{
    stroke: ${a.pieStrokeColor};
    stroke-width : ${a.pieStrokeWidth};
    opacity : ${a.pieOpacity};
  }
  .pieCircle.highlighted{
    scale: 1.05;
    opacity: 1;
  }
  .pieCircle.highlightedOnHover:hover{
    transition-duration: 250ms;
    scale: 1.05;
    opacity: 1;
  }
  .pieOuterCircle{
    stroke: ${a.pieOuterStrokeColor};
    stroke-width: ${a.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${a.pieTitleTextSize};
    fill: ${a.pieTitleTextColor};
    font-family: ${a.fontFamily};
  }
  .slice {
    font-family: ${a.fontFamily};
    fill: ${a.pieSectionTextColor};
    font-size:${a.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${a.pieLegendTextColor};
    font-family: ${a.fontFamily};
    font-size: ${a.pieLegendTextSize};
  }
`,"getStyles"),zt=kt,Et=e((a)=>{let l=[...a.values()].reduce((h,C)=>h+C,0),H=[...a.entries()].map(([h,C])=>({label:h,value:C})).filter((h)=>h.value/l*100>=1);return it().value((h)=>h.value).sort(null)(H)},"createPieArcs"),Mt=e((a,l,H,I)=>{t.debug(`rendering pie chart
`+a);let h=I.db,C=r(),s=E(h.getConfig(),C.pie),n=40,o=18,u=4,T=450,N=T,G=A(l),M=G.append("g");M.attr("transform","translate("+N/2+","+T/2+")");let{themeVariables:c}=C,[B]=he(c.pieOuterStrokeWidth);B??=2;let{legendPosition:j,textPosition:V}=s,q=s.donutHole>0&&s.donutHole<=0.9?s.donutHole:0,y=Math.min(N,T)/2-n,P=De().innerRadius(q*y).outerRadius(y),X=De().innerRadius(y*V).outerRadius(y*V),L=M.append("g");L.append("circle").attr("cx",0).attr("cy",0).attr("r",y+B/2).attr("class","pieOuterCircle");let J=h.getSections(),ft=Et(J),ht=[c.pie1,c.pie2,c.pie3,c.pie4,c.pie5,c.pie6,c.pie7,c.pie8,c.pie9,c.pie10,c.pie11,c.pie12],Y=0;J.forEach((i)=>{Y+=i});let st=ft.filter((i)=>(i.data.value/Y*100).toFixed(0)!=="0"),tt=pe(ht).domain([...J.keys()]);L.selectAll("mySlices").data(st).enter().append("path").attr("d",P).attr("fill",(i)=>tt(i.data.label)).attr("class",(i)=>{let S="pieCircle";if(s.highlightSlice==="hover")S+=" highlightedOnHover";else if(s.highlightSlice===i.data.label)S+=" highlighted";return S}),L.selectAll("mySlices").data(st).enter().append("text").text((i)=>(i.data.value/Y*100).toFixed(0)+"%").attr("transform",(i)=>"translate("+X.centroid(i)+")").style("text-anchor","middle").attr("class","slice");let mt=M.append("text").text(h.getDiagramTitle()).attr("x",0).attr("y",-(T-50)/2).attr("class","pieTitleText"),Z=[...J.entries()].map(([i,S])=>({label:i,value:S})),_=M.selectAll(".legend").data(Z).enter().append("g").attr("class","legend");_.append("rect").attr("width",o).attr("height",o).style("fill",(i)=>tt(i.label)).style("stroke",(i)=>tt(i.label)),_.append("text").attr("x",o+u).attr("y",o-u).text((i)=>{if(h.getShowData())return`${i.label} [${i.value}]`;return i.label});let U=Math.max(..._.selectAll("text").nodes().map((i)=>i?.getBoundingClientRect().width??0)),K=T,et=N+n,w=o+u,rt=Z.length*w;switch(j){case"center":_.attr("transform",(i,S)=>{let O=w*Z.length/2,W=-U/2-(o+u),F=S*w-O;return"translate("+W+","+F+")"});break;case"top":K+=rt,_.attr("transform",(i,S)=>{let O=y,W=-U/2-(o+u),F=S*w-O;return`translate(${W}, ${F})`}),L.attr("transform",()=>`translate(0, ${rt+w})`);break;case"bottom":K+=rt,_.attr("transform",(i,S)=>{let O=-y-w,W=-U/2-(o+u),F=S*w-O;return"translate("+W+","+F+")"});break;case"left":et+=o+u+U,_.attr("transform",(i,S)=>{let O=w*Z.length/2,W=-y-(o+u),F=S*w-O;return"translate("+W+","+F+")"}),L.attr("transform",()=>`translate(${U+o+u}, 0)`);break;case"right":default:et+=o+u+U,_.attr("transform",(i,S)=>{let O=w*Z.length/2,W=12*o,F=S*w-O;return"translate("+W+","+F+")"});break}let ct=mt.node()?.getBoundingClientRect().width??0,vt=N/2-ct/2,xt=N/2+ct/2,ut=Math.min(0,vt),gt=Math.max(et,xt)-ut;G.attr("viewBox",`${ut} 0 ${gt} ${K}`),k(G,K,gt,s.useMaxWidth)},"draw"),Rt={draw:Mt},Kt={parser:bt,db:pt,renderer:Rt,styles:zt};export{Kt as diagram};
