import{e,k,d,f,p,m,g,b,v,r,n}from"./index-1r72hdzb.js";import"./index-6qmsnxwy.js";import{dt,Br,Mi,ne}from"./index-qj8fxwsf.js";import{De}from"./index-rh7nv68n.js";import{we}from"./index-nprm96xp.js";var nt=function(){var t=e(function(y,a,l,c){for(l=l||{},c=y.length;c--;l[y[c]]=a);return l},"o"),i=[6,8,10,11,12,14,16,17,18],o=[1,9],T=[1,10],s=[1,11],x=[1,12],S=[1,13],h=[1,14],M={trace:e(function(){},"trace"),yy:{},symbols_:{error:2,start:3,journey:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NEWLINE:10,title:11,acc_title:12,acc_title_value:13,acc_descr:14,acc_descr_value:15,acc_descr_multiline_value:16,section:17,taskName:18,taskData:19,$accept:0,$end:1},terminals_:{2:"error",4:"journey",6:"EOF",8:"SPACE",10:"NEWLINE",11:"title",12:"acc_title",13:"acc_title_value",14:"acc_descr",15:"acc_descr_value",16:"acc_descr_multiline_value",17:"section",18:"taskName",19:"taskData"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,2]],performAction:e(function(a,l,c,_,w,u,A){var P=u.length-1;switch(w){case 1:return u[P-1];case 2:this.$=[];break;case 3:u[P-1].push(u[P]),this.$=u[P-1];break;case 4:case 5:this.$=u[P];break;case 6:case 7:this.$=[];break;case 8:_.setDiagramTitle(u[P].substr(6)),this.$=u[P].substr(6);break;case 9:this.$=u[P].trim(),_.setAccTitle(this.$);break;case 10:case 11:this.$=u[P].trim(),_.setAccDescription(this.$);break;case 12:_.addSection(u[P].substr(8)),this.$=u[P].substr(8);break;case 13:_.addTask(u[P-1],u[P]),this.$="task";break}},"anonymous"),table:[{3:1,4:[1,2]},{1:[3]},t(i,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:o,12:T,14:s,16:x,17:S,18:h},t(i,[2,7],{1:[2,1]}),t(i,[2,3]),{9:15,11:o,12:T,14:s,16:x,17:S,18:h},t(i,[2,5]),t(i,[2,6]),t(i,[2,8]),{13:[1,16]},{15:[1,17]},t(i,[2,11]),t(i,[2,12]),{19:[1,18]},t(i,[2,4]),t(i,[2,9]),t(i,[2,10]),t(i,[2,13])],defaultActions:{},parseError:e(function(a,l){if(l.recoverable)this.trace(a);else{var c=Error(a);throw c.hash=l,c}},"parseError"),parse:e(function(a){var l=this,c=[0],_=[],w=[null],u=[],A=this.table,P="",z=0,ot=0,ct=0,vt=2,ht=1,wt=u.slice.call(arguments,1),I=Object.create(this.lexer),O={yy:{}};for(var Q in this.yy)if(Object.prototype.hasOwnProperty.call(this.yy,Q))O.yy[Q]=this.yy[Q];if(I.setInput(a,O.yy),O.yy.lexer=I,O.yy.parser=this,typeof I.yylloc>"u")I.yylloc={};var D=I.yylloc;u.push(D);var Tt=I.options&&I.options.ranges;if(typeof O.yy.parseError==="function")this.parseError=O.yy.parseError;else this.parseError=Object.getPrototypeOf(this).parseError;function St(R){c.length=c.length-2*R,w.length=w.length-R,u.length=u.length-R}e(St,"popStack");function ut(){var R=_.pop()||I.lex()||ht;if(typeof R!=="number"){if(R instanceof Array)_=R,R=_.pop();R=l.symbols_[R]||R}return R}e(ut,"lex");var F,tt,Y,V,Gt,et,q={},Z,j,yt,J;while(!0){if(Y=c[c.length-1],this.defaultActions[Y])V=this.defaultActions[Y];else{if(F===null||typeof F>"u")F=ut();V=A[Y]&&A[Y][F]}if(typeof V>"u"||!V.length||!V[0]){var rt="";J=[];for(Z in A[Y])if(this.terminals_[Z]&&Z>vt)J.push("'"+this.terminals_[Z]+"'");if(I.showPosition)rt="Parse error on line "+(z+1)+`:
`+I.showPosition()+`
Expecting `+J.join(", ")+", got '"+(this.terminals_[F]||F)+"'";else rt="Parse error on line "+(z+1)+": Unexpected "+(F==ht?"end of input":"'"+(this.terminals_[F]||F)+"'");this.parseError(rt,{text:I.match,token:this.terminals_[F]||F,line:I.yylineno,loc:D,expected:J})}if(V[0]instanceof Array&&V.length>1)throw Error("Parse Error: multiple actions possible at state: "+Y+", token: "+F);switch(V[0]){case 1:if(c.push(F),w.push(I.yytext),u.push(I.yylloc),c.push(V[1]),F=null,!tt){if(ot=I.yyleng,P=I.yytext,z=I.yylineno,D=I.yylloc,ct>0)ct--}else F=tt,tt=null;break;case 2:if(j=this.productions_[V[1]][1],q.$=w[w.length-j],q._$={first_line:u[u.length-(j||1)].first_line,last_line:u[u.length-1].last_line,first_column:u[u.length-(j||1)].first_column,last_column:u[u.length-1].last_column},Tt)q._$.range=[u[u.length-(j||1)].range[0],u[u.length-1].range[1]];if(et=this.performAction.apply(q,[P,ot,z,O.yy,V[1],w,u].concat(wt)),typeof et<"u")return et;if(j)c=c.slice(0,-1*j*2),w=w.slice(0,-1*j),u=u.slice(0,-1*j);c.push(this.productions_[V[1]][0]),w.push(q.$),u.push(q._$),yt=A[c[c.length-2]][c[c.length-1]],c.push(yt);break;case 3:return!0}}return!0},"parse")},E=function(){var y={EOF:1,parseError:e(function(l,c){if(this.yy.parser)this.yy.parser.parseError(l,c);else throw Error(l)},"parseError"),setInput:e(function(a,l){if(this.yy=l||this.yy||{},this._input=a,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges)this.yylloc.range=[0,0];return this.offset=0,this},"setInput"),input:e(function(){var a=this._input[0];this.yytext+=a,this.yyleng++,this.offset++,this.match+=a,this.matched+=a;var l=a.match(/(?:\r\n?|\n).*/g);if(l)this.yylineno++,this.yylloc.last_line++;else this.yylloc.last_column++;if(this.options.ranges)this.yylloc.range[1]++;return this._input=this._input.slice(1),a},"input"),unput:e(function(a){var l=a.length,c=a.split(/(?:\r\n?|\n)/g);this._input=a+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-l),this.offset-=l;var _=this.match.split(/(?:\r\n?|\n)/g);if(this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),c.length-1)this.yylineno-=c.length-1;var w=this.yylloc.range;if(this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:c?(c.length===_.length?this.yylloc.first_column:0)+_[_.length-c.length].length-c[0].length:this.yylloc.first_column-l},this.options.ranges)this.yylloc.range=[w[0],w[0]+this.yyleng-l];return this.yyleng=this.yytext.length,this},"unput"),more:e(function(){return this._more=!0,this},"more"),reject:e(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:e(function(a){this.unput(this.match.slice(a))},"less"),pastInput:e(function(){var a=this.matched.substr(0,this.matched.length-this.match.length);return(a.length>20?"...":"")+a.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:e(function(){var a=this.match;if(a.length<20)a+=this._input.substr(0,20-a.length);return(a.substr(0,20)+(a.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:e(function(){var a=this.pastInput(),l=Array(a.length+1).join("-");return a+this.upcomingInput()+`
`+l+"^"},"showPosition"),test_match:e(function(a,l){var c,_,w;if(this.options.backtrack_lexer){if(w={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges)w.yylloc.range=this.yylloc.range.slice(0)}if(_=a[0].match(/(?:\r\n?|\n).*/g),_)this.yylineno+=_.length;if(this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:_?_[_.length-1].length-_[_.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+a[0].length},this.yytext+=a[0],this.match+=a[0],this.matches=a,this.yyleng=this.yytext.length,this.options.ranges)this.yylloc.range=[this.offset,this.offset+=this.yyleng];if(this._more=!1,this._backtrack=!1,this._input=this._input.slice(a[0].length),this.matched+=a[0],c=this.performAction.call(this,this.yy,this,l,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input)this.done=!1;if(c)return c;else if(this._backtrack){for(var u in w)this[u]=w[u];return!1}return!1},"test_match"),next:e(function(){if(this.done)return this.EOF;if(!this._input)this.done=!0;var a,l,c,_;if(!this._more)this.yytext="",this.match="";var w=this._currentRules();for(var u=0;u<w.length;u++)if(c=this._input.match(this.rules[w[u]]),c&&(!l||c[0].length>l[0].length)){if(l=c,_=u,this.options.backtrack_lexer)if(a=this.test_match(c,w[u]),a!==!1)return a;else if(this._backtrack){l=!1;continue}else return!1;else if(!this.options.flex)break}if(l){if(a=this.test_match(l,w[_]),a!==!1)return a;return!1}if(this._input==="")return this.EOF;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:e(function(){var l=this.next();if(l)return l;else return this.lex()},"lex"),begin:e(function(l){this.conditionStack.push(l)},"begin"),popState:e(function(){var l=this.conditionStack.length-1;if(l>0)return this.conditionStack.pop();else return this.conditionStack[0]},"popState"),_currentRules:e(function(){if(this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1])return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules;else return this.conditions.INITIAL.rules},"_currentRules"),topState:e(function(l){if(l=this.conditionStack.length-1-Math.abs(l||0),l>=0)return this.conditionStack[l];else return"INITIAL"},"topState"),pushState:e(function(l){this.begin(l)},"pushState"),stateStackSize:e(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:e(function(l,c,_,w){var u=w;switch(_){case 0:break;case 1:break;case 2:return 10;case 3:break;case 4:break;case 5:return 4;case 6:return 11;case 7:return this.begin("acc_title"),12;break;case 8:return this.popState(),"acc_title_value";break;case 9:return this.begin("acc_descr"),14;break;case 10:return this.popState(),"acc_descr_value";break;case 11:this.begin("acc_descr_multiline");break;case 12:this.popState();break;case 13:return"acc_descr_multiline_value";case 14:return 17;case 15:return 18;case 16:return 19;case 17:return":";case 18:return 6;case 19:return"INVALID"}},"anonymous"),rules:[/^(?:%(?!\{)[^\n]*)/i,/^(?:[^\}]%%[^\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:#[^\n]*)/i,/^(?:journey\b)/i,/^(?:title\s[^#\n;]+)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:section\s[^#:\n;]+)/i,/^(?:[^#:\n;]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[12,13],inclusive:!1},acc_descr:{rules:[10],inclusive:!1},acc_title:{rules:[8],inclusive:!1},INITIAL:{rules:[0,1,2,3,4,5,6,7,9,11,14,15,16,17,18,19],inclusive:!0}}};return y}();M.lexer=E;function C(){this.yy={}}return e(C,"Parser"),C.prototype=M,M.Parser=C,new C}();nt.parser=nt;var $t=nt,X="",at=[],G=[],H=[],Mt=e(function(){at.length=0,G.length=0,X="",H.length=0,d()},"clear"),Et=e(function(t){X=t,at.push(t)},"addSection"),Ct=e(function(){return at},"getSections"),Pt=e(function(){let t=ft(),i=100,o=0;while(!t&&o<i)t=ft(),o++;return G.push(...H),G},"getTasks"),It=e(function(){let t=[];return G.forEach((o)=>{if(o.people)t.push(...o.people)}),[...new Set(t)].sort()},"updateActors"),At=e(function(t,i){let o=i.substr(1).split(":"),T=0,s=[];if(o.length===1)T=Number(o[0]),s=[];else T=Number(o[0]),s=o[1].split(",");let x=s.map((h)=>h.trim()),S={section:X,type:X,people:x,task:t,score:T};H.push(S)},"addTask"),Ft=e(function(t){let i={section:X,type:X,description:t,task:t,classes:[]};G.push(i)},"addTaskOrg"),ft=e(function(){let t=e(function(o){return H[o].processed},"compileTask"),i=!0;for(let[o,T]of H.entries())t(o),i=i&&T.processed;return i},"compileTasks"),Vt=e(function(){return It()},"getActors"),pt={getConfig:e(()=>r().journey,"getConfig"),clear:Mt,setDiagramTitle:b,getDiagramTitle:v,setAccTitle:f,getAccTitle:p,setAccDescription:m,getAccDescription:g,addSection:Et,getSections:Ct,getTasks:Pt,addTask:At,addTaskOrg:Ft,getActors:Vt},Rt=e((t)=>`.label {
    font-family: ${t.fontFamily};
    color: ${t.textColor};
  }
  .mouth {
    stroke: #666;
  }

  line {
    stroke: ${t.textColor}
  }

  .legend {
    fill: ${t.textColor};
    font-family: ${t.fontFamily};
  }

  .label text {
    fill: #333;
  }
  .label {
    color: ${t.textColor}
  }

  .face {
    ${t.faceColor?`fill: ${t.faceColor}`:"fill: #FFF8DC"};
    stroke: #999;
  }

  .node rect,
  .node circle,
  .node ellipse,
  .node polygon,
  .node path {
    fill: ${t.mainBkg};
    stroke: ${t.nodeBorder};
    stroke-width: 1px;
  }

  .node .label {
    text-align: center;
  }
  .node.clickable {
    cursor: pointer;
  }

  .arrowheadPath {
    fill: ${t.arrowheadColor};
  }

  .edgePath .path {
    stroke: ${t.lineColor};
    stroke-width: 1.5px;
  }

  .flowchart-link {
    stroke: ${t.lineColor};
    fill: none;
  }

  .edgeLabel {
    background-color: ${t.edgeLabelBackground};
    rect {
      opacity: 0.5;
    }
    text-align: center;
  }

  .cluster rect {
  }

  .cluster text {
    fill: ${t.titleColor};
  }

  div.mermaidTooltip {
    position: absolute;
    text-align: center;
    max-width: 200px;
    padding: 2px;
    font-family: ${t.fontFamily};
    font-size: 12px;
    background: ${t.tertiaryColor};
    border: 1px solid ${t.border2};
    border-radius: 2px;
    pointer-events: none;
    z-index: 100;
  }

  .task-type-0, .section-type-0  {
    ${t.fillType0?`fill: ${t.fillType0}`:""};
  }
  .task-type-1, .section-type-1  {
    ${t.fillType0?`fill: ${t.fillType1}`:""};
  }
  .task-type-2, .section-type-2  {
    ${t.fillType0?`fill: ${t.fillType2}`:""};
  }
  .task-type-3, .section-type-3  {
    ${t.fillType0?`fill: ${t.fillType3}`:""};
  }
  .task-type-4, .section-type-4  {
    ${t.fillType0?`fill: ${t.fillType4}`:""};
  }
  .task-type-5, .section-type-5  {
    ${t.fillType0?`fill: ${t.fillType5}`:""};
  }
  .task-type-6, .section-type-6  {
    ${t.fillType0?`fill: ${t.fillType6}`:""};
  }
  .task-type-7, .section-type-7  {
    ${t.fillType0?`fill: ${t.fillType7}`:""};
  }

  .actor-0 {
    ${t.actor0?`fill: ${t.actor0}`:""};
  }
  .actor-1 {
    ${t.actor1?`fill: ${t.actor1}`:""};
  }
  .actor-2 {
    ${t.actor2?`fill: ${t.actor2}`:""};
  }
  .actor-3 {
    ${t.actor3?`fill: ${t.actor3}`:""};
  }
  .actor-4 {
    ${t.actor4?`fill: ${t.actor4}`:""};
  }
  .actor-5 {
    ${t.actor5?`fill: ${t.actor5}`:""};
  }
  ${we()}
`,"getStyles"),Lt=Rt,lt=e(function(t,i){return dt(t,i)},"drawRect"),Bt=e(function(t,i){let T=t.append("circle").attr("cx",i.cx).attr("cy",i.cy).attr("class","face").attr("r",15).attr("stroke-width",2).attr("overflow","visible"),s=t.append("g");s.append("circle").attr("cx",i.cx-5).attr("cy",i.cy-5).attr("r",1.5).attr("stroke-width",2).attr("fill","#666").attr("stroke","#666"),s.append("circle").attr("cx",i.cx+5).attr("cy",i.cy-5).attr("r",1.5).attr("stroke-width",2).attr("fill","#666").attr("stroke","#666");function x(M){let E=De().startAngle(Math.PI/2).endAngle(3*(Math.PI/2)).innerRadius(7.5).outerRadius(6.8181818181818175);M.append("path").attr("class","mouth").attr("d",E).attr("transform","translate("+i.cx+","+(i.cy+2)+")")}e(x,"smile");function S(M){let E=De().startAngle(3*Math.PI/2).endAngle(5*(Math.PI/2)).innerRadius(7.5).outerRadius(6.8181818181818175);M.append("path").attr("class","mouth").attr("d",E).attr("transform","translate("+i.cx+","+(i.cy+7)+")")}e(S,"sad");function h(M){M.append("line").attr("class","mouth").attr("stroke",2).attr("x1",i.cx-5).attr("y1",i.cy+7).attr("x2",i.cx+5).attr("y2",i.cy+7).attr("class","mouth").attr("stroke-width","1px").attr("stroke","#666")}if(e(h,"ambivalent"),i.score>3)x(s);else if(i.score<3)S(s);else h(s);return T},"drawFace"),xt=e(function(t,i){let o=t.append("circle");if(o.attr("cx",i.cx),o.attr("cy",i.cy),o.attr("class","actor-"+i.pos),o.attr("fill",i.fill),o.attr("stroke",i.stroke),o.attr("r",i.r),o.class!==void 0)o.attr("class",o.class);if(i.title!==void 0)o.append("title").text(i.title);return o},"drawCircle"),kt=e(function(t,i){return Mi(t,i)},"drawText"),jt=e(function(t,i){function o(s,x,S,h,M){return s+","+x+" "+(s+S)+","+x+" "+(s+S)+","+(x+h-M)+" "+(s+S-M*1.2)+","+(x+h)+" "+s+","+(x+h)}e(o,"genPoints");let T=t.append("polygon");T.attr("points",o(i.x,i.y,50,20,7)),T.attr("class","labelBox"),i.y=i.y+i.labelMargin,i.x=i.x+0.5*i.labelMargin,kt(t,i)},"drawLabel"),Nt=e(function(t,i,o){let T=t.append("g"),s=ne();s.x=i.x,s.y=i.y,s.fill=i.fill,s.width=o.width*i.taskCount+o.diagramMarginX*(i.taskCount-1),s.height=o.height,s.class="journey-section section-type-"+i.num,s.rx=3,s.ry=3,lt(T,s),bt(o)(i.text,T,s.x,s.y,s.width,s.height,{class:"journey-section section-type-"+i.num},o,i.colour)},"drawSection"),st=-1,zt=e(function(t,i,o,T){let s=i.x+o.width/2,x=t.append("g");st++;let S=450;x.append("line").attr("id",T+"-task"+st).attr("x1",s).attr("y1",i.y).attr("x2",s).attr("y2",S).attr("class","task-line").attr("stroke-width","1px").attr("stroke-dasharray","4 2").attr("stroke","#666"),Bt(x,{cx:s,cy:300+(5-i.score)*30,score:i.score});let h=ne();h.x=i.x,h.y=i.y,h.fill=i.fill,h.width=o.width,h.height=o.height,h.class="task task-type-"+i.num,h.rx=3,h.ry=3,lt(x,h);let M=i.x+14;i.people.forEach((E)=>{let C=i.actors[E].color,y={cx:M,cy:i.y,r:7,fill:C,stroke:"#000",title:E,pos:i.actors[E].position};xt(x,y),M+=10}),bt(o)(i.task,x,h.x,h.y,h.width,h.height,{class:"task"},o,i.colour)},"drawTask"),Wt=e(function(t,i){Br(t,i)},"drawBackgroundRect"),bt=function(){function t(s,x,S,h,M,E,C,y){let a=x.append("text").attr("x",S+M/2).attr("y",h+E/2+5).style("font-color",y).style("text-anchor","middle").text(s);T(a,C)}e(t,"byText");function i(s,x,S,h,M,E,C,y,a){let{taskFontSize:l,taskFontFamily:c}=y,_=s.split(/<br\s*\/?>/gi);for(let w=0;w<_.length;w++){let u=w*l-l*(_.length-1)/2,A=x.append("text").attr("x",S+M/2).attr("y",h).attr("fill",a).style("text-anchor","middle").style("font-size",l).style("font-family",c);A.append("tspan").attr("x",S+M/2).attr("dy",u).text(_[w]),A.attr("y",h+E/2).attr("dominant-baseline","central").attr("alignment-baseline","central"),T(A,C)}}e(i,"byTspan");function o(s,x,S,h,M,E,C,y){let a=x.append("switch"),c=a.append("foreignObject").attr("x",S).attr("y",h).attr("width",M).attr("height",E).attr("position","fixed").append("xhtml:div").style("display","table").style("height","100%").style("width","100%");c.append("div").attr("class","label").style("display","table-cell").style("text-align","center").style("vertical-align","middle").text(s),i(s,a,S,h,M,E,C,y),T(c,C)}e(o,"byFo");function T(s,x){for(let S in x)if(S in x)s.attr(S,x[S])}return e(T,"_setTextAttrs"),function(s){return s.textPlacement==="fo"?o:s.textPlacement==="old"?t:i}}(),Ot=e(function(t,i){st=-1,t.append("defs").append("marker").attr("id",i+"-arrowhead").attr("refX",5).attr("refY",2).attr("markerWidth",6).attr("markerHeight",4).attr("orient","auto").append("path").attr("d","M 0,0 V 4 L6,2 Z")},"initGraphics"),U={drawRect:lt,drawCircle:xt,drawSection:Nt,drawText:kt,drawLabel:jt,drawTask:zt,drawBackgroundRect:Wt,initGraphics:Ot},Yt=e(function(t){Object.keys(t).forEach(function(o){B[o]=t[o]})},"setConf"),N={},K=0;function _t(t){let i=r().journey,o=i.maxLabelWidth;K=0;let T=60;Object.keys(N).forEach((s)=>{let x=N[s].color,S={cx:20,cy:T,r:7,fill:x,stroke:"#000",pos:N[s].position};U.drawCircle(t,S);let h=t.append("text").attr("visibility","hidden").text(s),M=h.node().getBoundingClientRect().width;h.remove();let E=[];if(M<=o)E=[s];else{let C=s.split(" "),y="";if(h=t.append("text").attr("visibility","hidden"),C.forEach((a)=>{let l=y?`${y} ${a}`:a;if(h.text(l),h.node().getBoundingClientRect().width>o){if(y)E.push(y);if(y=a,h.text(a),h.node().getBoundingClientRect().width>o){let _="";for(let w of a)if(_+=w,h.text(_+"-"),h.node().getBoundingClientRect().width>o)E.push(_.slice(0,-1)+"-"),_=w;y=_}}else y=l}),y)E.push(y);h.remove()}E.forEach((C,y)=>{let a={x:40,y:T+7+y*20,fill:"#666",text:C,textMargin:i.boxTextMargin??5},c=U.drawText(t,a).node().getBoundingClientRect().width;if(c>K&&c>i.leftMargin-c)K=c}),T+=Math.max(20,E.length*20)})}e(_t,"drawActorLegend");var B=r().journey,W=0,qt=e(function(t,i,o,T){let s=r(),x=s.journey.titleColor,S=s.journey.titleFontSize,h=s.journey.titleFontFamily,M=s.securityLevel,E;if(M==="sandbox")E=n("#i"+i);let C=M==="sandbox"?n(E.nodes()[0].contentDocument.body):n("body");L.init();let y=C.select("#"+i);U.initGraphics(y,i);let a=T.db.getTasks(),l=T.db.getDiagramTitle(),c=T.db.getActors();for(let z in N)delete N[z];let _=0;c.forEach((z)=>{N[z]={color:B.actorColours[_%B.actorColours.length],position:_},_++}),_t(y),W=B.leftMargin+K,L.insert(0,0,W,Object.keys(N).length*50),Xt(y,a,0,i);let w=L.getBounds();if(l)y.append("text").text(l).attr("x",W).attr("font-size",S).attr("font-weight","bold").attr("y",25).attr("fill",x).attr("font-family",h);let u=w.stopy-w.starty+2*B.diagramMarginY,A=W+w.stopx+2*B.diagramMarginX;k(y,u,A,B.useMaxWidth),y.append("line").attr("x1",W).attr("y1",B.height*4).attr("x2",A-W-4).attr("y2",B.height*4).attr("stroke-width",4).attr("stroke","black").attr("marker-end","url(#"+i+"-arrowhead)");let P=l?70:0;y.attr("viewBox",`${w.startx} -25 ${A} ${u+P}`),y.attr("preserveAspectRatio","xMinYMin meet"),y.attr("height",u+P+25)},"draw"),L={data:{startx:void 0,stopx:void 0,starty:void 0,stopy:void 0},verticalPos:0,sequenceItems:[],init:e(function(){this.sequenceItems=[],this.data={startx:void 0,stopx:void 0,starty:void 0,stopy:void 0},this.verticalPos=0},"init"),updateVal:e(function(t,i,o,T){if(t[i]===void 0)t[i]=o;else t[i]=T(o,t[i])},"updateVal"),updateBounds:e(function(t,i,o,T){let s=r().journey,x=this,S=0;function h(M){return e(function(C){S++;let y=x.sequenceItems.length-S+1;if(x.updateVal(C,"starty",i-y*s.boxMargin,Math.min),x.updateVal(C,"stopy",T+y*s.boxMargin,Math.max),x.updateVal(L.data,"startx",t-y*s.boxMargin,Math.min),x.updateVal(L.data,"stopx",o+y*s.boxMargin,Math.max),M!=="activation")x.updateVal(C,"startx",t-y*s.boxMargin,Math.min),x.updateVal(C,"stopx",o+y*s.boxMargin,Math.max),x.updateVal(L.data,"starty",i-y*s.boxMargin,Math.min),x.updateVal(L.data,"stopy",T+y*s.boxMargin,Math.max)},"updateItemBounds")}e(h,"updateFn"),this.sequenceItems.forEach(h())},"updateBounds"),insert:e(function(t,i,o,T){let s=Math.min(t,o),x=Math.max(t,o),S=Math.min(i,T),h=Math.max(i,T);this.updateVal(L.data,"startx",s,Math.min),this.updateVal(L.data,"starty",S,Math.min),this.updateVal(L.data,"stopx",x,Math.max),this.updateVal(L.data,"stopy",h,Math.max),this.updateBounds(s,S,x,h)},"insert"),bumpVerticalPos:e(function(t){this.verticalPos=this.verticalPos+t,this.data.stopy=this.verticalPos},"bumpVerticalPos"),getVerticalPos:e(function(){return this.verticalPos},"getVerticalPos"),getBounds:e(function(){return this.data},"getBounds")},{sectionFills:it,sectionColours:gt}=B,Xt=e(function(t,i,o,T){let s=r().journey,x="",S=s.height*2+s.diagramMarginY,h=o+S,M=0,E="#CCC",C="black",y=0;for(let[a,l]of i.entries()){if(x!==l.section){E=it[M%it.length],y=M%it.length,C=gt[M%gt.length];let _=0,w=l.section;for(let A=a;A<i.length;A++)if(i[A].section==w)_=_+1;else break;let u={x:a*s.taskMargin+a*s.width+W,y:50,text:l.section,fill:E,num:y,colour:C,taskCount:_};U.drawSection(t,u,s),x=l.section,M++}let c=l.people.reduce((_,w)=>{if(N[w])_[w]=N[w];return _},{});l.x=a*s.taskMargin+a*s.width+W,l.y=h,l.width=s.diagramMarginX,l.height=s.diagramMarginY,l.colour=C,l.fill=E,l.num=y,l.actors=c,U.drawTask(t,l,s,T),L.insert(l.x,l.y,l.x+l.width+s.taskMargin,450)}},"drawTasks"),mt={setConf:Yt,draw:qt},te={parser:$t,db:pt,renderer:mt,styles:Lt,init:e((t)=>{mt.setConf(t.journey),pt.clear()},"init")};export{te as diagram};
