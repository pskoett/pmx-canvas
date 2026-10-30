import{e,t,j,u,w,T,d,r,A}from"./index-nwsya6dj.js";var E="",W="",_="",B=[],O=new Map,R=e((i)=>w(i,r()),"sanitizeText"),N=e((i)=>{switch(i.type){case"terminal":return{...i,value:R(i.value)};case"nonterminal":return{...i,name:R(i.name)};case"sequence":return{...i,elements:i.elements.map(N)};case"choice":return{...i,alternatives:i.alternatives.map(N)};case"optional":return{...i,element:N(i.element)};case"repetition":return{...i,element:N(i.element),separator:i.separator?N(i.separator):void 0};case"special":return{...i,text:R(i.text)}}},"sanitizeAstNode"),K=e(()=>{E="",W="",_="",B.length=0,O.clear(),d(),t.debug("[Railroad] Database cleared")},"clear"),X=e((i)=>{E=R(i),t.debug("[Railroad] Title set:",i)},"setTitle"),H=e(()=>E,"getTitle"),J=e((i)=>{let o={...i,name:R(i.name),definition:N(i.definition),comment:i.comment?R(i.comment):void 0};if(t.debug("[Railroad] Adding rule:",o.name),O.has(o.name))t.warn(`[Railroad] Rule '${o.name}' is already defined. Overwriting.`);B.push(o),O.set(o.name,o)},"addRule"),Q=e(()=>B,"getRules"),Z=e((i)=>O.get(i),"getRule"),V=e((i)=>{W=R(i).replace(/^\s+/g,""),t.debug("[Railroad] Accessibility title set:",i)},"setAccTitle"),ee=e(()=>W,"getAccTitle"),te=e((i)=>{_=R(i).replace(/\n\s+/g,`
`),t.debug("[Railroad] Accessibility description set:",i)},"setAccDescription"),re=e(()=>_,"getAccDescription"),ie=X,ne=H,P={clear:K,setTitle:X,getTitle:H,addRule:J,getRules:Q,getRule:Z,setAccTitle:V,getAccTitle:ee,setAccDescription:te,getAccDescription:re,setDiagramTitle:ie,getDiagramTitle:ne},k={compactMode:!1,padding:10,verticalSeparation:8,horizontalSeparation:10,arcRadius:10,fontSize:14,fontFamily:"monospace",terminalFill:"#FFFFC0",terminalStroke:"#000000",terminalTextColor:"#000000",nonTerminalFill:"#FFFFFF",nonTerminalStroke:"#000000",nonTerminalTextColor:"#000000",lineColor:"#000000",strokeWidth:2,markerFill:"#000000",commentFill:"#E8E8E8",commentStroke:"#888888",commentTextColor:"#666666",specialFill:"#F0E0FF",specialStroke:"#8800CC",ruleNameColor:"#000066",showMarkers:!0,markerRadius:5},ae=/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$|^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([\d\s%+,./-]+\)$|^[a-z]+$/i,oe=/^[\w "',.-]+$/,le=new Set(["compactMode","padding","verticalSeparation","horizontalSeparation","arcRadius","fontSize","fontFamily","terminalFill","terminalStroke","terminalTextColor","nonTerminalFill","nonTerminalStroke","nonTerminalTextColor","lineColor","strokeWidth","markerFill","commentFill","commentStroke","commentTextColor","specialFill","specialStroke","ruleNameColor","showMarkers","markerRadius"]),q=e((i)=>{if(!i)return!1;return Object.keys(i).every((o)=>o==="railroad"||le.has(o))},"isRailroadStyleOptions"),se=e((i)=>{if(!i)return{};if("railroad"in i&&i.railroad)return i.railroad;return q(i)?i:{}},"extractRailroadOverrides"),de=e((i)=>{if(!i||q(i))return{};let{railroad:o,svgId:s,theme:a,look:n,...l}=i;return l},"extractThemeOverrides"),f=e((i,o)=>{if(typeof i!=="string")return o;let s=i.trim();return ae.test(s)?s:o},"sanitizeColorValue"),G=e((i,o)=>{if(typeof i!=="string")return o;let s=i.trim();return oe.test(s)?s:o},"sanitizeFontFamilyValue"),b=e((i,o)=>{let s=typeof i==="number"?i:typeof i==="string"?Number.parseFloat(i):Number.NaN;return Number.isFinite(s)&&s>=0?s:o},"sanitizeNumberValue"),ce=e((i)=>{let o=typeof i==="number"?i:typeof i==="string"?Number.parseFloat(i):Number.NaN;return Number.isFinite(o)&&o>0?o:void 0},"parseThemeFontSize"),me=e((i)=>{let o=G(i.fontFamily,k.fontFamily),s=ce(i.fontSize)??k.fontSize;return{...k,fontFamily:o,fontSize:s,terminalFill:f(i.secondBkg??i.secondaryColor,k.terminalFill),terminalStroke:f(i.secondaryBorderColor??i.lineColor,k.terminalStroke),terminalTextColor:f(i.secondaryTextColor??i.textColor,k.terminalTextColor),nonTerminalFill:f(i.mainBkg??i.background,k.nonTerminalFill),nonTerminalStroke:f(i.primaryBorderColor??i.lineColor,k.nonTerminalStroke),nonTerminalTextColor:f(i.primaryTextColor??i.textColor,k.nonTerminalTextColor),lineColor:f(i.lineColor,k.lineColor),markerFill:f(i.lineColor,k.markerFill),commentFill:f(i.labelBackground??i.tertiaryColor,k.commentFill),commentStroke:f(i.tertiaryBorderColor??i.lineColor,k.commentStroke),commentTextColor:f(i.tertiaryTextColor??i.textColor,k.commentTextColor),specialFill:f(i.tertiaryColor??i.secondaryColor,k.specialFill),specialStroke:f(i.tertiaryBorderColor??i.secondaryBorderColor,k.specialStroke),ruleNameColor:f(i.titleColor??i.textColor,k.ruleNameColor)}},"buildThemeDefaults"),Y=e((i)=>{let o=u(),s={...j(),...o.themeVariables??{},...de(i)},a=me(s),n={...o.railroad??{},...se(i)};return{compactMode:n.compactMode??a.compactMode,padding:b(n.padding,a.padding),verticalSeparation:b(n.verticalSeparation,a.verticalSeparation),horizontalSeparation:b(n.horizontalSeparation,a.horizontalSeparation),arcRadius:b(n.arcRadius,a.arcRadius),fontSize:b(n.fontSize,a.fontSize),fontFamily:G(n.fontFamily,a.fontFamily),terminalFill:f(n.terminalFill,a.terminalFill),terminalStroke:f(n.terminalStroke,a.terminalStroke),terminalTextColor:f(n.terminalTextColor,a.terminalTextColor),nonTerminalFill:f(n.nonTerminalFill,a.nonTerminalFill),nonTerminalStroke:f(n.nonTerminalStroke,a.nonTerminalStroke),nonTerminalTextColor:f(n.nonTerminalTextColor,a.nonTerminalTextColor),lineColor:f(n.lineColor,a.lineColor),strokeWidth:b(n.strokeWidth,a.strokeWidth),markerFill:f(n.markerFill,a.markerFill),commentFill:f(n.commentFill,a.commentFill),commentStroke:f(n.commentStroke,a.commentStroke),commentTextColor:f(n.commentTextColor,a.commentTextColor),specialFill:f(n.specialFill,a.specialFill),specialStroke:f(n.specialStroke,a.specialStroke),ruleNameColor:f(n.ruleNameColor,a.ruleNameColor),showMarkers:n.showMarkers??a.showMarkers,markerRadius:b(n.markerRadius,a.markerRadius)}},"buildRailroadStyleOptions"),ze=e((i)=>{let{fontFamily:o,fontSize:s,terminalFill:a,terminalStroke:n,terminalTextColor:l,nonTerminalFill:x,nonTerminalStroke:h,nonTerminalTextColor:c,lineColor:C,strokeWidth:g,markerFill:p,commentFill:F,commentStroke:m,commentTextColor:v,specialFill:M,specialStroke:z,ruleNameColor:y}=Y(i);return`
  .railroad-diagram {
    font-family: ${o};
    font-size: ${s}px;
  }

  .railroad-terminal rect {
    fill: ${a};
    stroke: ${n};
    stroke-width: ${g}px;
  }

  .railroad-terminal text {
    fill: ${l};
    font-family: ${o};
    font-size: ${s}px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .railroad-nonterminal rect {
    fill: ${x};
    stroke: ${h};
    stroke-width: ${g}px;
  }

  .railroad-nonterminal text {
    fill: ${c};
    font-family: ${o};
    font-size: ${s}px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .railroad-line {
    stroke: ${C};
    stroke-width: ${g}px;
    fill: none;
  }

  .railroad-start circle,
  .railroad-end circle {
    fill: ${p};
  }

  .railroad-comment ellipse {
    fill: ${F};
    stroke: ${m};
    stroke-width: ${g}px;
  }

  .railroad-comment text {
    fill: ${v};
    font-style: italic;
    font-family: ${o};
    font-size: ${s}px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .railroad-special rect {
    fill: ${M};
    stroke: ${z};
    stroke-width: ${g}px;
    stroke-dasharray: 5,3;
  }

  .railroad-special text {
    fill: ${c};
    font-family: ${o};
    font-size: ${s}px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .railroad-rule-name {
    font-weight: bold;
    fill: ${y};
    font-family: ${o};
    font-size: ${s}px;
  }

  .railroad-group {
    /* Grouping container, no specific styles */
  }
`},"getStyles"),S=class{constructor(){this.d=""}static{e(this,"PathBuilder")}moveTo(i,o){return this.d+=`M ${i} ${o} `,this}lineTo(i,o){return this.d+=`L ${i} ${o} `,this}horizontalTo(i){return this.d+=`H ${i} `,this}verticalTo(i){return this.d+=`V ${i} `,this}arcTo(i,o,s,a,n,l,x){return this.d+=`A ${i} ${o} ${s} ${a?1:0} ${n?1:0} ${l} ${x} `,this}build(){return this.d.trim()}},he=class{constructor(i,o=Y()){this.textCache=new Map,this.svg=i,this.config=o}static{e(this,"RailroadRenderer")}measureText(i){if(this.textCache.has(i))return this.textCache.get(i);let o=this.svg.append("text").attr("font-family",this.config.fontFamily).attr("font-size",this.config.fontSize).text(i),s=o.node().getBBox(),a={width:s.width,height:s.height};return o.remove(),this.textCache.set(i,a),a}renderTerminal(i,o){let s=this.measureText(o),a=s.width+this.config.padding*2,n=s.height+this.config.padding*2,l=i.append("g").attr("class","railroad-terminal");return l.append("rect").attr("x",0).attr("y",0).attr("width",a).attr("height",n).attr("rx",10).attr("ry",10),l.append("text").attr("x",a/2).attr("y",n/2).text(o),{element:l.node(),dimensions:{width:a,height:n,up:n/2,down:n/2}}}renderNonTerminal(i,o){let s=this.measureText(o),a=s.width+this.config.padding*2,n=s.height+this.config.padding*2,l=i.append("g").attr("class","railroad-nonterminal");return l.append("rect").attr("x",0).attr("y",0).attr("width",a).attr("height",n),l.append("text").attr("x",a/2).attr("y",n/2).text(o),{element:l.node(),dimensions:{width:a,height:n,up:n/2,down:n/2}}}renderSequence(i,o){let s=o.map((c)=>this.renderExpression(i,c)),a=0,n=0,l=0;for(let c of s)a+=c.dimensions.width,n=Math.max(n,c.dimensions.up),l=Math.max(l,c.dimensions.down);a+=(s.length-1)*this.config.horizontalSeparation;let x=i.append("g").attr("class","railroad-sequence"),h=0;for(let c=0;c<s.length;c++){let C=s[c],g=n-C.dimensions.up;if(x.node().appendChild(C.element).setAttribute("transform",`translate(${h}, ${g})`),c<s.length-1){let F=h+C.dimensions.width,m=F+this.config.horizontalSeparation,v=n;x.append("path").attr("class","railroad-line").attr("d",new S().moveTo(F,v).lineTo(m,v).build())}h+=C.dimensions.width+this.config.horizontalSeparation}return{element:x.node(),dimensions:{width:a,height:n+l,up:n,down:l}}}renderChoice(i,o){let s=o.map((p)=>this.renderExpression(i,p)),a=0,n=0;for(let p of s)a=Math.max(a,p.dimensions.width),n+=p.dimensions.height;n+=(s.length-1)*this.config.verticalSeparation;let l=this.config.arcRadius,x=l*4,h=a+x,c=i.append("g").attr("class","railroad-choice"),C=0,g=n/2;for(let p of s){let F=C,m=F+p.dimensions.up,v=l*2+(a-p.dimensions.width)/2;c.node().appendChild(p.element).setAttribute("transform",`translate(${v}, ${F})`);let z=new S,y=m>g;if(m===g)z.moveTo(0,g).lineTo(v,m);else z.moveTo(0,g).arcTo(l,l,0,!1,y,l,g+(y?l:-l)).lineTo(l,m-(y?l:-l)).arcTo(l,l,0,!1,!y,l*2,m).lineTo(v,m);c.append("path").attr("class","railroad-line").attr("d",z.build());let D=new S,L=v+p.dimensions.width,U=h-l*2;if(m===g)D.moveTo(L,m).lineTo(h,g);else D.moveTo(L,m).lineTo(U,m).arcTo(l,l,0,!1,!y,h-l,m+(y?-l:l)).lineTo(h-l,g+(y?l:-l)).arcTo(l,l,0,!1,y,h,g);c.append("path").attr("class","railroad-line").attr("d",D.build()),C+=p.dimensions.height+this.config.verticalSeparation}return{element:c.node(),dimensions:{width:h,height:n,up:g,down:n-g}}}renderOptional(i,o){let s=this.renderExpression(i,o),a=this.config.arcRadius,n=a*2,l=s.dimensions.width+a*4,x=s.dimensions.height+n,h=i.append("g").attr("class","railroad-optional"),c=a*2,C=n;h.node().appendChild(s.element).setAttribute("transform",`translate(${c}, ${C})`);let p=C+s.dimensions.up,F=new S().moveTo(0,p).lineTo(a*2,p);h.append("path").attr("class","railroad-line").attr("d",F.build());let m=new S().moveTo(c+s.dimensions.width,p).lineTo(l,p);h.append("path").attr("class","railroad-line").attr("d",m.build());let v=new S().moveTo(0,p).arcTo(a,a,0,!1,!1,a,p-a).lineTo(a,a).arcTo(a,a,0,!1,!0,a*2,0).lineTo(l-a*2,0).arcTo(a,a,0,!1,!0,l-a,a).lineTo(l-a,p-a).arcTo(a,a,0,!1,!1,l,p);return h.append("path").attr("class","railroad-line").attr("d",v.build()),{element:h.node(),dimensions:{width:l,height:x,up:p,down:x-p}}}renderRepetition(i,o,s){let a=this.renderExpression(i,o),n=this.config.arcRadius,l=n*2,x=a.dimensions.width+n*4,h=s===0,c=a.dimensions.height+l+(h?l:0),C=i.append("g").attr("class","railroad-repetition"),g=n*2,p=h?l:0;C.node().appendChild(a.element).setAttribute("transform",`translate(${g}, ${p})`);let m=p+a.dimensions.up;C.append("path").attr("class","railroad-line").attr("d",new S().moveTo(0,m).lineTo(n*2,m).build()),C.append("path").attr("class","railroad-line").attr("d",new S().moveTo(g+a.dimensions.width,m).lineTo(x,m).build());let v=p+a.dimensions.height+n,M=new S().moveTo(g+a.dimensions.width,m).arcTo(n,n,0,!1,!0,g+a.dimensions.width+n,m+n).lineTo(g+a.dimensions.width+n,v).arcTo(n,n,0,!1,!0,g+a.dimensions.width,v+n).lineTo(n*2,v+n).arcTo(n,n,0,!1,!0,n,v).lineTo(n,m+n).arcTo(n,n,0,!1,!0,n*2,m);if(C.append("path").attr("class","railroad-line").attr("d",M.build()),h){let z=new S().moveTo(0,m).arcTo(n,n,0,!1,!1,n,m-n).lineTo(n,n).arcTo(n,n,0,!1,!0,n*2,0).lineTo(x-n*2,0).arcTo(n,n,0,!1,!0,x-n,n).lineTo(x-n,m-n).arcTo(n,n,0,!1,!1,x,m);C.append("path").attr("class","railroad-line").attr("d",z.build())}return{element:C.node(),dimensions:{width:x,height:c,up:m,down:c-m}}}renderSpecial(i,o){let s=this.measureText("? "+o+" ?"),a=s.width+this.config.padding*2,n=s.height+this.config.padding*2,l=i.append("g").attr("class","railroad-special");return l.append("rect").attr("x",0).attr("y",0).attr("width",a).attr("height",n),l.append("text").attr("x",a/2).attr("y",n/2).text("? "+o+" ?"),{element:l.node(),dimensions:{width:a,height:n,up:n/2,down:n/2}}}renderExpression(i,o){switch(o.type){case"terminal":return this.renderTerminal(i,o.value);case"nonterminal":return this.renderNonTerminal(i,o.name);case"sequence":return this.renderSequence(i,o.elements);case"choice":return this.renderChoice(i,o.alternatives);case"optional":return this.renderOptional(i,o.element);case"repetition":return this.renderRepetition(i,o.element,o.min);case"special":return this.renderSpecial(i,o.text);default:throw Error(`Unknown node type: ${o.type}`)}}renderRule(i,o){let s=this.svg.append("g").attr("class","railroad-rule").attr("transform",`translate(0, ${o})`),a=i.name+" =",n=this.measureText(a).width+20,l=n+20,x=s.append("g"),h=this.renderExpression(x,i.definition),c=Math.max(20,h.dimensions.up),C=c-h.dimensions.up;return x.attr("transform",`translate(${l}, ${C})`),s.append("g").attr("class","railroad-rule-name-group").append("text").attr("class","railroad-rule-name").attr("x",0).attr("y",c).text(a),s.append("g").attr("class","railroad-start").append("circle").attr("cx",n).attr("cy",c).attr("r",this.config.markerRadius),s.append("g").attr("class","railroad-end").append("circle").attr("cx",l+h.dimensions.width+10).attr("cy",c).attr("r",this.config.markerRadius),s.append("path").attr("class","railroad-line").attr("d",new S().moveTo(n+this.config.markerRadius,c).lineTo(l,c).build()),s.append("path").attr("class","railroad-line").attr("d",new S().moveTo(l+h.dimensions.width,c).lineTo(l+h.dimensions.width+10-this.config.markerRadius,c).build()),{height:Math.max(40,C+h.dimensions.height+this.config.padding*2),width:l+h.dimensions.width+10+this.config.markerRadius}}renderDiagram(i){let o=this.config.padding,s=0;for(let a of i){let n=this.renderRule(a,o);o+=n.height+this.config.verticalSeparation,s=Math.max(s,n.width)}return{width:s+this.config.padding*2,height:o+this.config.padding}}},I=e((i,o,s)=>{T(i,o.height,o.width,s),i.attr("viewBox",`0 0 ${o.width} ${o.height}`)},"configureRailroadSvgSize"),pe=e((i,o,s)=>{t.debug(`[Railroad] Rendering diagram
`+i);try{let a=A(o);a.attr("class","railroad-diagram");let l=u().railroad?.useMaxWidth??!0,x=P.getRules();if(t.debug(`[Railroad] Rendering ${x.length} rules`),x.length===0){t.warn("[Railroad] No rules to render"),I(a,{height:100,width:200},l);return}let c=new he(a,Y()).renderDiagram(x);I(a,c,l),t.debug("[Railroad] Render complete")}catch(a){throw t.error("[Railroad] Render error:",a),a}},"draw"),Ge={draw:pe};
export{P,ze,Ge};
