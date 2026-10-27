import{e,t,l,d,f,p,m,g,b,v,r,n,Ti,h,fe}from"./index-yes1gqrc.js";import{V}from"./index-v119nznk.js";import{It}from"./index-z9p3zmev.js";import{le}from"./index-nk7wcm6n.js";import{J}from"./index-vxg93m55.js";var Yt=function(){var s=e(function(tt,u,D,c){for(D=D||{},c=tt.length;c--;D[tt[c]]=u);return D},"o"),i=[1,2],T=[1,3],a=[1,4],E=[2,4],k=[1,9],C=[1,11],x=[1,16],y=[1,17],I=[1,18],O=[1,19],j=[1,33],G=[1,20],R=[1,21],_=[1,22],M=[1,23],U=[1,24],B=[1,26],K=[1,27],Y=[1,28],X=[1,29],W=[1,30],at=[1,31],yt=[1,32],gt=[1,35],Tt=[1,36],bt=[1,37],Et=[1,38],nt=[1,34],A=[1,4,5,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],mt=[1,4,5,14,15,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,39,40,41,45,48,51,52,53,54,57],Mt=[4,5,16,17,19,21,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],wt={trace:e(function(){},"trace"),yy:{},symbols_:{error:2,start:3,SPACE:4,NL:5,SD:6,document:7,line:8,statement:9,classDefStatement:10,styleStatement:11,cssClassStatement:12,idStatement:13,DESCR:14,"-->":15,HIDE_EMPTY:16,scale:17,WIDTH:18,COMPOSIT_STATE:19,STRUCT_START:20,STRUCT_STOP:21,STATE_DESCR:22,AS:23,ID:24,FORK:25,JOIN:26,CHOICE:27,CONCURRENT:28,note:29,notePosition:30,NOTE_TEXT:31,direction:32,acc_title:33,acc_title_value:34,acc_descr:35,acc_descr_value:36,acc_descr_multiline_value:37,CLICK:38,STRING:39,HREF:40,classDef:41,CLASSDEF_ID:42,CLASSDEF_STYLEOPTS:43,DEFAULT:44,style:45,STYLE_IDS:46,STYLEDEF_STYLEOPTS:47,class:48,CLASSENTITY_IDS:49,STYLECLASS:50,direction_tb:51,direction_bt:52,direction_rl:53,direction_lr:54,eol:55,";":56,EDGE_STATE:57,STYLE_SEPARATOR:58,left_of:59,right_of:60,$accept:0,$end:1},terminals_:{2:"error",4:"SPACE",5:"NL",6:"SD",14:"DESCR",15:"-->",16:"HIDE_EMPTY",17:"scale",18:"WIDTH",19:"COMPOSIT_STATE",20:"STRUCT_START",21:"STRUCT_STOP",22:"STATE_DESCR",23:"AS",24:"ID",25:"FORK",26:"JOIN",27:"CHOICE",28:"CONCURRENT",29:"note",31:"NOTE_TEXT",33:"acc_title",34:"acc_title_value",35:"acc_descr",36:"acc_descr_value",37:"acc_descr_multiline_value",38:"CLICK",39:"STRING",40:"HREF",41:"classDef",42:"CLASSDEF_ID",43:"CLASSDEF_STYLEOPTS",44:"DEFAULT",45:"style",46:"STYLE_IDS",47:"STYLEDEF_STYLEOPTS",48:"class",49:"CLASSENTITY_IDS",50:"STYLECLASS",51:"direction_tb",52:"direction_bt",53:"direction_rl",54:"direction_lr",56:";",57:"EDGE_STATE",58:"STYLE_SEPARATOR",59:"left_of",60:"right_of"},productions_:[0,[3,2],[3,2],[3,2],[7,0],[7,2],[8,2],[8,1],[8,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,3],[9,4],[9,1],[9,2],[9,1],[9,4],[9,3],[9,6],[9,1],[9,1],[9,1],[9,1],[9,4],[9,4],[9,1],[9,2],[9,2],[9,1],[9,5],[9,5],[10,3],[10,3],[11,3],[12,3],[32,1],[32,1],[32,1],[32,1],[55,1],[55,1],[13,1],[13,1],[13,3],[13,3],[30,1],[30,1]],performAction:e(function(u,D,c,L,w,o,ot){var S=o.length-1;switch(w){case 3:return L.setRootDoc(o[S]),o[S];break;case 4:this.$=[];break;case 5:if(o[S]!="nl")o[S-1].push(o[S]),this.$=o[S-1];break;case 6:case 7:this.$=o[S];break;case 8:this.$="nl";break;case 12:this.$=o[S];break;case 13:let _t=o[S-1];_t.description=L.trimColon(o[S]),this.$=_t;break;case 14:this.$={stmt:"relation",state1:o[S-2],state2:o[S]};break;case 15:let Dt=L.trimColon(o[S]);this.$={stmt:"relation",state1:o[S-3],state2:o[S-1],description:Dt};break;case 19:this.$={stmt:"state",id:o[S-3],type:"default",description:"",doc:o[S-1]};break;case 20:var q=o[S],Q=o[S-2].trim();if(o[S].match(":")){var ut=o[S].split(":");q=ut[0],Q=[Q,ut[1]]}this.$={stmt:"state",id:q,type:"default",description:Q};break;case 21:this.$={stmt:"state",id:o[S-3],type:"default",description:o[S-5],doc:o[S-1]};break;case 22:this.$={stmt:"state",id:o[S],type:"fork"};break;case 23:this.$={stmt:"state",id:o[S],type:"join"};break;case 24:this.$={stmt:"state",id:o[S],type:"choice"};break;case 25:this.$={stmt:"state",id:L.getDividerId(),type:"divider"};break;case 26:this.$={stmt:"state",id:o[S-1].trim(),note:{position:o[S-2].trim(),text:o[S].trim()}};break;case 29:this.$=o[S].trim(),L.setAccTitle(this.$);break;case 30:case 31:this.$=o[S].trim(),L.setAccDescription(this.$);break;case 32:this.$={stmt:"click",id:o[S-3],url:o[S-2],tooltip:o[S-1]};break;case 33:this.$={stmt:"click",id:o[S-3],url:o[S-1],tooltip:""};break;case 34:case 35:this.$={stmt:"classDef",id:o[S-1].trim(),classes:o[S].trim()};break;case 36:this.$={stmt:"style",id:o[S-1].trim(),styleClass:o[S].trim()};break;case 37:this.$={stmt:"applyClass",id:o[S-1].trim(),styleClass:o[S].trim()};break;case 38:L.setDirection("TB"),this.$={stmt:"dir",value:"TB"};break;case 39:L.setDirection("BT"),this.$={stmt:"dir",value:"BT"};break;case 40:L.setDirection("RL"),this.$={stmt:"dir",value:"RL"};break;case 41:L.setDirection("LR"),this.$={stmt:"dir",value:"LR"};break;case 44:case 45:this.$={stmt:"state",id:o[S].trim(),type:"default",description:""};break;case 46:this.$={stmt:"state",id:o[S-2].trim(),classes:[o[S].trim()],type:"default",description:""};break;case 47:this.$={stmt:"state",id:o[S-2].trim(),classes:[o[S].trim()],type:"default",description:""};break}},"anonymous"),table:[{3:1,4:i,5:T,6:a},{1:[3]},{3:5,4:i,5:T,6:a},{3:6,4:i,5:T,6:a},s([1,4,5,16,17,19,22,24,25,26,27,28,29,33,35,37,38,41,45,48,51,52,53,54,57],E,{7:7}),{1:[2,1]},{1:[2,2]},{1:[2,3],4:k,5:C,8:8,9:10,10:12,11:13,12:14,13:15,16:x,17:y,19:I,22:O,24:j,25:G,26:R,27:_,28:M,29:U,32:25,33:B,35:K,37:Y,38:X,41:W,45:at,48:yt,51:gt,52:Tt,53:bt,54:Et,57:nt},s(A,[2,5]),{9:39,10:12,11:13,12:14,13:15,16:x,17:y,19:I,22:O,24:j,25:G,26:R,27:_,28:M,29:U,32:25,33:B,35:K,37:Y,38:X,41:W,45:at,48:yt,51:gt,52:Tt,53:bt,54:Et,57:nt},s(A,[2,7]),s(A,[2,8]),s(A,[2,9]),s(A,[2,10]),s(A,[2,11]),s(A,[2,12],{14:[1,40],15:[1,41]}),s(A,[2,16]),{18:[1,42]},s(A,[2,18],{20:[1,43]}),{23:[1,44]},s(A,[2,22]),s(A,[2,23]),s(A,[2,24]),s(A,[2,25]),{30:45,31:[1,46],59:[1,47],60:[1,48]},s(A,[2,28]),{34:[1,49]},{36:[1,50]},s(A,[2,31]),{13:51,24:j,57:nt},{42:[1,52],44:[1,53]},{46:[1,54]},{49:[1,55]},s(mt,[2,44],{58:[1,56]}),s(mt,[2,45],{58:[1,57]}),s(A,[2,38]),s(A,[2,39]),s(A,[2,40]),s(A,[2,41]),s(A,[2,6]),s(A,[2,13]),{13:58,24:j,57:nt},s(A,[2,17]),s(Mt,E,{7:59}),{24:[1,60]},{24:[1,61]},{23:[1,62]},{24:[2,48]},{24:[2,49]},s(A,[2,29]),s(A,[2,30]),{39:[1,63],40:[1,64]},{43:[1,65]},{43:[1,66]},{47:[1,67]},{50:[1,68]},{24:[1,69]},{24:[1,70]},s(A,[2,14],{14:[1,71]}),{4:k,5:C,8:8,9:10,10:12,11:13,12:14,13:15,16:x,17:y,19:I,21:[1,72],22:O,24:j,25:G,26:R,27:_,28:M,29:U,32:25,33:B,35:K,37:Y,38:X,41:W,45:at,48:yt,51:gt,52:Tt,53:bt,54:Et,57:nt},s(A,[2,20],{20:[1,73]}),{31:[1,74]},{24:[1,75]},{39:[1,76]},{39:[1,77]},s(A,[2,34]),s(A,[2,35]),s(A,[2,36]),s(A,[2,37]),s(mt,[2,46]),s(mt,[2,47]),s(A,[2,15]),s(A,[2,19]),s(Mt,E,{7:78}),s(A,[2,26]),s(A,[2,27]),{5:[1,79]},{5:[1,80]},{4:k,5:C,8:8,9:10,10:12,11:13,12:14,13:15,16:x,17:y,19:I,21:[1,81],22:O,24:j,25:G,26:R,27:_,28:M,29:U,32:25,33:B,35:K,37:Y,38:X,41:W,45:at,48:yt,51:gt,52:Tt,53:bt,54:Et,57:nt},s(A,[2,32]),s(A,[2,33]),s(A,[2,21])],defaultActions:{5:[2,1],6:[2,2],47:[2,48],48:[2,49]},parseError:e(function(u,D){if(D.recoverable)this.trace(u);else{var c=Error(u);throw c.hash=D,c}},"parseError"),parse:e(function(u){var D=this,c=[0],L=[],w=[null],o=[],ot=this.table,S="",q=0,Q=0,ut=0,_t=2,Dt=1,pe=o.slice.call(arguments,1),N=Object.create(this.lexer),it={yy:{}};for(var Ot in this.yy)if(Object.prototype.hasOwnProperty.call(this.yy,Ot))it.yy[Ot]=this.yy[Ot];if(N.setInput(u,it.yy),it.yy.lexer=N,it.yy.parser=this,typeof N.yylloc>"u")N.yylloc={};var Nt=N.yylloc;o.push(Nt);var Se=N.options&&N.options.ranges;if(typeof it.yy.parseError==="function")this.parseError=it.yy.parseError;else this.parseError=Object.getPrototypeOf(this).parseError;function ye(z){c.length=c.length-2*z,w.length=w.length-z,o.length=o.length-z}e(ye,"popStack");function Ut(){var z=L.pop()||N.lex()||Dt;if(typeof z!=="number"){if(z instanceof Array)L=z,z=L.pop();z=D.symbols_[z]||z}return z}e(Ut,"lex");var F,Rt,rt,H,Me,$t,lt={},vt,Z,Wt,Ct;while(!0){if(rt=c[c.length-1],this.defaultActions[rt])H=this.defaultActions[rt];else{if(F===null||typeof F>"u")F=Ut();H=ot[rt]&&ot[rt][F]}if(typeof H>"u"||!H.length||!H[0]){var Ft="";Ct=[];for(vt in ot[rt])if(this.terminals_[vt]&&vt>_t)Ct.push("'"+this.terminals_[vt]+"'");if(N.showPosition)Ft="Parse error on line "+(q+1)+`:
`+N.showPosition()+`
Expecting `+Ct.join(", ")+", got '"+(this.terminals_[F]||F)+"'";else Ft="Parse error on line "+(q+1)+": Unexpected "+(F==Dt?"end of input":"'"+(this.terminals_[F]||F)+"'");this.parseError(Ft,{text:N.match,token:this.terminals_[F]||F,line:N.yylineno,loc:Nt,expected:Ct})}if(H[0]instanceof Array&&H.length>1)throw Error("Parse Error: multiple actions possible at state: "+rt+", token: "+F);switch(H[0]){case 1:if(c.push(F),w.push(N.yytext),o.push(N.yylloc),c.push(H[1]),F=null,!Rt){if(Q=N.yyleng,S=N.yytext,q=N.yylineno,Nt=N.yylloc,ut>0)ut--}else F=Rt,Rt=null;break;case 2:if(Z=this.productions_[H[1]][1],lt.$=w[w.length-Z],lt._$={first_line:o[o.length-(Z||1)].first_line,last_line:o[o.length-1].last_line,first_column:o[o.length-(Z||1)].first_column,last_column:o[o.length-1].last_column},Se)lt._$.range=[o[o.length-(Z||1)].range[0],o[o.length-1].range[1]];if($t=this.performAction.apply(lt,[S,Q,q,it.yy,H[1],w,o].concat(pe)),typeof $t<"u")return $t;if(Z)c=c.slice(0,-1*Z*2),w=w.slice(0,-1*Z),o=o.slice(0,-1*Z);c.push(this.productions_[H[1]][0]),w.push(lt.$),o.push(lt._$),Wt=ot[c[c.length-2]][c[c.length-1]],c.push(Wt);break;case 3:return!0}}return!0},"parse")},de=function(){var tt={EOF:1,parseError:e(function(D,c){if(this.yy.parser)this.yy.parser.parseError(D,c);else throw Error(D)},"parseError"),setInput:e(function(u,D){if(this.yy=D||this.yy||{},this._input=u,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges)this.yylloc.range=[0,0];return this.offset=0,this},"setInput"),input:e(function(){var u=this._input[0];this.yytext+=u,this.yyleng++,this.offset++,this.match+=u,this.matched+=u;var D=u.match(/(?:\r\n?|\n).*/g);if(D)this.yylineno++,this.yylloc.last_line++;else this.yylloc.last_column++;if(this.options.ranges)this.yylloc.range[1]++;return this._input=this._input.slice(1),u},"input"),unput:e(function(u){var D=u.length,c=u.split(/(?:\r\n?|\n)/g);this._input=u+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-D),this.offset-=D;var L=this.match.split(/(?:\r\n?|\n)/g);if(this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),c.length-1)this.yylineno-=c.length-1;var w=this.yylloc.range;if(this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:c?(c.length===L.length?this.yylloc.first_column:0)+L[L.length-c.length].length-c[0].length:this.yylloc.first_column-D},this.options.ranges)this.yylloc.range=[w[0],w[0]+this.yyleng-D];return this.yyleng=this.yytext.length,this},"unput"),more:e(function(){return this._more=!0,this},"more"),reject:e(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:e(function(u){this.unput(this.match.slice(u))},"less"),pastInput:e(function(){var u=this.matched.substr(0,this.matched.length-this.match.length);return(u.length>20?"...":"")+u.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:e(function(){var u=this.match;if(u.length<20)u+=this._input.substr(0,20-u.length);return(u.substr(0,20)+(u.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:e(function(){var u=this.pastInput(),D=Array(u.length+1).join("-");return u+this.upcomingInput()+`
`+D+"^"},"showPosition"),test_match:e(function(u,D){var c,L,w;if(this.options.backtrack_lexer){if(w={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges)w.yylloc.range=this.yylloc.range.slice(0)}if(L=u[0].match(/(?:\r\n?|\n).*/g),L)this.yylineno+=L.length;if(this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:L?L[L.length-1].length-L[L.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+u[0].length},this.yytext+=u[0],this.match+=u[0],this.matches=u,this.yyleng=this.yytext.length,this.options.ranges)this.yylloc.range=[this.offset,this.offset+=this.yyleng];if(this._more=!1,this._backtrack=!1,this._input=this._input.slice(u[0].length),this.matched+=u[0],c=this.performAction.call(this,this.yy,this,D,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input)this.done=!1;if(c)return c;else if(this._backtrack){for(var o in w)this[o]=w[o];return!1}return!1},"test_match"),next:e(function(){if(this.done)return this.EOF;if(!this._input)this.done=!0;var u,D,c,L;if(!this._more)this.yytext="",this.match="";var w=this._currentRules();for(var o=0;o<w.length;o++)if(c=this._input.match(this.rules[w[o]]),c&&(!D||c[0].length>D[0].length)){if(D=c,L=o,this.options.backtrack_lexer)if(u=this.test_match(c,w[o]),u!==!1)return u;else if(this._backtrack){D=!1;continue}else return!1;else if(!this.options.flex)break}if(D){if(u=this.test_match(D,w[L]),u!==!1)return u;return!1}if(this._input==="")return this.EOF;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:e(function(){var D=this.next();if(D)return D;else return this.lex()},"lex"),begin:e(function(D){this.conditionStack.push(D)},"begin"),popState:e(function(){var D=this.conditionStack.length-1;if(D>0)return this.conditionStack.pop();else return this.conditionStack[0]},"popState"),_currentRules:e(function(){if(this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1])return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules;else return this.conditions.INITIAL.rules},"_currentRules"),topState:e(function(D){if(D=this.conditionStack.length-1-Math.abs(D||0),D>=0)return this.conditionStack[D];else return"INITIAL"},"topState"),pushState:e(function(D){this.begin(D)},"pushState"),stateStackSize:e(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:e(function(D,c,L,w){function o(){let S=c.yytext.indexOf("%%");if(S===0)return!1;if(S>0){let q=c.yytext.slice(0,S),Q=c.yytext.slice(S);if(Q)D.lexer.unput(Q);c.yytext=q}return!0}e(o,"processId");var ot=w;switch(L){case 0:return 38;case 1:return 40;case 2:return 39;case 3:return 44;case 4:return 51;case 5:return 52;case 6:return 53;case 7:return 54;case 8:return 5;case 9:break;case 10:break;case 11:break;case 12:break;case 13:return this.pushState("SCALE"),17;break;case 14:return 18;case 15:this.popState();break;case 16:return this.begin("acc_title"),33;break;case 17:return this.popState(),"acc_title_value";break;case 18:return this.begin("acc_descr"),35;break;case 19:return this.popState(),"acc_descr_value";break;case 20:this.begin("acc_descr_multiline");break;case 21:this.popState();break;case 22:return"acc_descr_multiline_value";case 23:return this.pushState("CLASSDEF"),41;break;case 24:return this.popState(),this.pushState("CLASSDEFID"),"DEFAULT_CLASSDEF_ID";break;case 25:return this.popState(),this.pushState("CLASSDEFID"),42;break;case 26:return this.popState(),43;break;case 27:return this.pushState("CLASS"),48;break;case 28:return this.popState(),this.pushState("CLASS_STYLE"),49;break;case 29:return this.popState(),50;break;case 30:return this.pushState("STYLE"),45;break;case 31:return this.popState(),this.pushState("STYLEDEF_STYLES"),46;break;case 32:return this.popState(),47;break;case 33:return this.pushState("SCALE"),17;break;case 34:return 18;case 35:this.popState();break;case 36:this.pushState("STATE");break;case 37:return this.popState(),c.yytext=c.yytext.slice(0,-8).trim(),25;break;case 38:return this.popState(),c.yytext=c.yytext.slice(0,-8).trim(),26;break;case 39:return this.popState(),c.yytext=c.yytext.slice(0,-10).trim(),27;break;case 40:return this.popState(),c.yytext=c.yytext.slice(0,-8).trim(),25;break;case 41:return this.popState(),c.yytext=c.yytext.slice(0,-8).trim(),26;break;case 42:return this.popState(),c.yytext=c.yytext.slice(0,-10).trim(),27;break;case 43:return 51;case 44:return 52;case 45:return 53;case 46:return 54;case 47:this.pushState("STATE_STRING");break;case 48:return this.pushState("STATE_ID"),"AS";break;case 49:if(!o())return;return this.popState(),"ID";break;case 50:this.popState();break;case 51:return"STATE_DESCR";case 52:throw Error('Error: State name must be a single word. Found: "'+c.yytext.trim()+'"');case 53:return 19;case 54:this.popState();break;case 55:return this.popState(),this.pushState("struct"),20;break;case 56:return this.popState(),21;break;case 57:break;case 58:return this.begin("NOTE"),29;break;case 59:return this.popState(),this.pushState("NOTE_ID"),59;break;case 60:return this.popState(),this.pushState("NOTE_ID"),60;break;case 61:this.popState(),this.pushState("FLOATING_NOTE");break;case 62:return this.popState(),this.pushState("FLOATING_NOTE_ID"),"AS";break;case 63:break;case 64:return"NOTE_TEXT";case 65:if(!o())return;return this.popState(),"ID";break;case 66:if(!o())return;return this.popState(),this.pushState("NOTE_TEXT"),24;break;case 67:return this.popState(),c.yytext=c.yytext.substr(2).trim(),31;break;case 68:return this.popState(),c.yytext=c.yytext.slice(0,-8).trim(),31;break;case 69:return 6;case 70:return 6;case 71:return 16;case 72:return 57;case 73:if(!o())return;return 24;case 74:return c.yytext=c.yytext.trim(),14;break;case 75:return 15;case 76:return 28;case 77:return 58;case 78:return 5;case 79:return"INVALID"}},"anonymous"),rules:[/^(?:click\b)/i,/^(?:href\b)/i,/^(?:"[^"]*")/i,/^(?:default\b)/i,/^(?:.*direction\s+TB[^\n]*)/i,/^(?:.*direction\s+BT[^\n]*)/i,/^(?:.*direction\s+RL[^\n]*)/i,/^(?:.*direction\s+LR[^\n]*)/i,/^(?:[\n]+)/i,/^(?:[\s]+)/i,/^(?:((?!\n)\s)+)/i,/^(?:#[^\n]*)/i,/^(?:%%(?!\{)[^\n]*)/i,/^(?:scale\s+)/i,/^(?:\d+)/i,/^(?:\s+width\b)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:classDef\s+)/i,/^(?:DEFAULT\s+)/i,/^(?:\w+\s+)/i,/^(?:[^\n]*)/i,/^(?:class\s+)/i,/^(?:(\w+)+((,\s*\w+)*))/i,/^(?:[^\n]*)/i,/^(?:style\s+)/i,/^(?:[\w,]+\s+)/i,/^(?:[^\n]*)/i,/^(?:scale\s+)/i,/^(?:\d+)/i,/^(?:\s+width\b)/i,/^(?:state\s+)/i,/^(?:.*<<fork>>)/i,/^(?:.*<<join>>)/i,/^(?:.*<<choice>>)/i,/^(?:.*\[\[fork\]\])/i,/^(?:.*\[\[join\]\])/i,/^(?:.*\[\[choice\]\])/i,/^(?:.*direction\s+TB[^\n]*)/i,/^(?:.*direction\s+BT[^\n]*)/i,/^(?:.*direction\s+RL[^\n]*)/i,/^(?:.*direction\s+LR[^\n]*)/i,/^(?:["])/i,/^(?:\s*as\s+)/i,/^(?:[^\n\{]*)/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:\w+\s+\w+.*?\{)/i,/^(?:[^\n\s\{]+)/i,/^(?:\n)/i,/^(?:\{)/i,/^(?:\})/i,/^(?:[\n])/i,/^(?:note\s+)/i,/^(?:left of\b)/i,/^(?:right of\b)/i,/^(?:")/i,/^(?:\s*as\s*)/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:[^\n]*)/i,/^(?:\s*[^:\n\s\-]+)/i,/^(?:\s*:[^:\n;]+)/i,/^(?:[\s\S]*?\n\s*end note\b)/i,/^(?:stateDiagram\s+)/i,/^(?:stateDiagram-v2\s+)/i,/^(?:hide empty description\b)/i,/^(?:\[\*\])/i,/^(?:[^:\n\s\-\{]+)/i,/^(?:\s*:(?:[^:\n;]|:[^:\n;])+)/i,/^(?:-->)/i,/^(?:--)/i,/^(?::::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{LINE:{rules:[10,11,12],inclusive:!1},struct:{rules:[10,11,12,23,27,30,36,43,44,45,46,56,57,58,72,73,74,75,76,77],inclusive:!1},FLOATING_NOTE_ID:{rules:[65],inclusive:!1},FLOATING_NOTE:{rules:[62,63,64],inclusive:!1},NOTE_TEXT:{rules:[67,68],inclusive:!1},NOTE_ID:{rules:[66],inclusive:!1},NOTE:{rules:[59,60,61],inclusive:!1},STYLEDEF_STYLEOPTS:{rules:[],inclusive:!1},STYLEDEF_STYLES:{rules:[32],inclusive:!1},STYLE_IDS:{rules:[],inclusive:!1},STYLE:{rules:[31],inclusive:!1},CLASS_STYLE:{rules:[29],inclusive:!1},CLASS:{rules:[28],inclusive:!1},CLASSDEFID:{rules:[26],inclusive:!1},CLASSDEF:{rules:[24,25],inclusive:!1},acc_descr_multiline:{rules:[21,22],inclusive:!1},acc_descr:{rules:[19],inclusive:!1},acc_title:{rules:[17],inclusive:!1},SCALE:{rules:[14,15,34,35],inclusive:!1},ALIAS:{rules:[],inclusive:!1},STATE_ID:{rules:[49],inclusive:!1},STATE_STRING:{rules:[50,51],inclusive:!1},FORK_STATE:{rules:[],inclusive:!1},STATE:{rules:[10,11,12,37,38,39,40,41,42,47,48,52,53,54,55],inclusive:!1},ID:{rules:[10,11,12],inclusive:!1},INITIAL:{rules:[0,1,2,3,4,5,6,7,8,9,11,12,13,16,18,20,23,27,30,33,36,55,58,69,70,71,72,73,74,75,77,78,79],inclusive:!0}}};return tt}();wt.lexer=de;function kt(){this.yy={}}return e(kt,"Parser"),kt.prototype=wt,wt.Parser=kt,new kt}();Yt.parser=Yt;var Rr=Yt,ge="TB",Qt="TB",jt="dir",ht="state",ct="root",Gt="relation",Te="classDef",be="style",Ee="applyClass",pt="default",Zt="divider",te="fill:none",ee="fill: #333",se="c",ie="markdown",re="normal",Pt="rect",Bt="rectWithTitle",me="stateStart",ke="stateEnd",Ht="divider",zt="roundedWithTitle",_e="note",De="noteGroup",St="statediagram",ve="state",Ce=`${St}-${ve}`,ae="transition",Ae="note",xe="note-edge",Le=`${ae} ${xe}`,Ie=`${St}-${Ae}`,we="cluster",Oe=`${St}-${we}`,Ne="cluster-alt",Re=`${St}-${Ne}`,ne="parent",oe="note",$e="state",Vt="----",Fe=`${Vt}${oe}`,Kt=`${Vt}${ne}`,ce=e((s,i=Qt)=>{if(!s.doc)return i;let T=i;for(let a of s.doc)if(a.stmt==="dir")T=a.value;return T},"getDir"),Pe=e(function(s,i){return i.db.getClasses()},"getClasses"),Be=e(async function(s,i,T,a){t.info("REF0:"),t.info("Drawing state diagram (v2)",i);let{securityLevel:E,state:k,layout:C}=r();a.db.extract(a.db.getRootDocV2());let x=a.db.getData(),y=le(i,E);if(x.type=a.type,x.layoutAlgorithm=C,x.nodeSpacing=k?.nodeSpacing||50,x.rankSpacing=k?.rankSpacing||50,r().look==="neo")x.markers=["barbNeo"];else x.markers=["barb"];x.diagramId=i,await fe(x,y);let O=8;try{(typeof a.db.getLinks==="function"?a.db.getLinks():new Map).forEach((G,R)=>{let _=typeof R==="string"?R:typeof R?.id==="string"?R.id:"",M=x.nodes.find((W)=>W.id===_);if(!_){t.warn("⚠️ Invalid or missing stateId from key:",JSON.stringify(R));return}let U=y.node()?.querySelectorAll("g.node, g.rough-node"),B;if(U?.forEach((W)=>{let at=W.textContent?.trim();if(W.id===M?.domId||at===_)B=W}),!B){t.warn("⚠️ Could not find node matching text:",_);return}let K=B.parentNode;if(!K){t.warn("⚠️ Node has no parent, cannot wrap:",_);return}let Y=document.createElementNS("http://www.w3.org/2000/svg","a"),X=G.url.replace(/^"+|"+$/g,"");if(Y.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",X),Y.setAttribute("target","_blank"),G.tooltip){let W=G.tooltip.replace(/^"+|"+$/g,"");Y.setAttribute("title",W),B.setAttribute("title",W)}K.replaceChild(Y,B),Y.appendChild(B),t.info("\uD83D\uDD17 Wrapped node in <a> tag for:",_,G.url)})}catch(j){t.error("❌ Error injecting clickable links:",j)}h.insertTitle(y,"statediagramTitleText",k?.titleTopMargin??25,a.db.getDiagramTitle()),J(y,O,St,k?.useMaxWidth??!0)},"draw"),Ri={getClasses:Pe,draw:Be,getDir:ce},xt=new Map,st=0;function Lt(s="",i=0,T="",a=Vt){let E=T!==null&&T.length>0?`${a}${T}`:"";return`${$e}-${s}${E}-${i}`}e(Lt,"stateDomId");var Ye=e((s,i,T,a,E,k,C,x)=>{t.trace("items",i),i.forEach((y)=>{switch(y.stmt){case ht:ft(s,y,T,a,E,k,C,x);break;case pt:ft(s,y,T,a,E,k,C,x);break;case Gt:{ft(s,y.state1,T,a,E,k,C,x),ft(s,y.state2,T,a,E,k,C,x);let I=C==="neo",O={id:"edge"+st,start:y.state1.id,end:y.state2.id,arrowhead:"normal",arrowTypeEnd:I?"arrow_barb_neo":"arrow_barb",style:te,labelStyle:"",label:l.sanitizeText(y.description??"",r()),arrowheadStyle:ee,labelpos:se,labelType:ie,thickness:re,classes:ae,look:C};E.push(O),st++}break}})},"setupDoc"),Xt=e((s,i=Qt)=>{let T=i;if(s.doc){for(let a of s.doc)if(a.stmt==="dir")T=a.value}return T},"getDir");function dt(s,i,T){if(!i.id||i.id==="</join></fork>"||i.id==="</choice>")return;if(i.cssClasses){if(!Array.isArray(i.cssCompiledStyles))i.cssCompiledStyles=[];i.cssClasses.split(" ").forEach((E)=>{let k=T.get(E);if(k)i.cssCompiledStyles=[...i.cssCompiledStyles??[],...k.styles]})}let a=s.find((E)=>E.id===i.id);if(a)Object.assign(a,i);else s.push(i)}e(dt,"insertOrUpdateNode");function he(s){return s?.classes?.join(" ")??""}e(he,"getClassesFromDbInfo");function ue(s){return s?.styles??[]}e(ue,"getStylesFromDbInfo");var ft=e((s,i,T,a,E,k,C,x)=>{let y=i.id,I=T.get(y),O=he(I),j=ue(I),G=r();if(t.info("dataFetcher parsedItem",i,I,j),y!=="root"){let R=Pt;if(i.start===!0)R=me;else if(i.start===!1)R=ke;if(i.type!==pt)R=i.type;if(!xt.get(y))xt.set(y,{id:y,shape:R,description:l.sanitizeText(y,G),cssClasses:`${O} ${Ce}`,cssStyles:j});let _=xt.get(y);if(i.description){if(Array.isArray(_.description))_.shape=Bt,_.description.push(i.description);else if(_.description?.length&&_.description.length>0)if(_.shape=Bt,_.description===y)_.description=[i.description];else _.description=[_.description,i.description];else _.shape=Pt,_.description=i.description;_.description=l.sanitizeTextOrArray(_.description,G)}if(_.description?.length===1&&_.shape===Bt)if(_.type==="group")_.shape=zt;else _.shape=Pt;if(!_.type&&i.doc)t.info("Setting cluster for XCX",y,Xt(i)),_.type="group",_.isGroup=!0,_.dir=Xt(i),_.explicitDir=i.doc.some((U)=>U.stmt==="dir"),_.shape=i.type===Zt?Ht:zt,_.cssClasses=`${_.cssClasses} ${Oe} ${k?Re:""}`;let M={labelStyle:"",shape:_.shape,label:_.description,cssClasses:_.cssClasses,cssCompiledStyles:[],cssStyles:_.cssStyles,id:y,dir:_.dir,domId:Lt(y,st),type:_.type,isGroup:_.type==="group",padding:8,rx:10,ry:10,look:C,labelType:"markdown"};if(M.shape===Ht)M.label="";if(s&&s.id!=="root")t.trace("Setting node ",y," to be child of its parent ",s.id),M.parentId=s.id;if(M.centerLabel=!0,i.note){let U={labelStyle:"",shape:_e,label:i.note.text,labelType:"markdown",cssClasses:Ie,cssStyles:[],cssCompiledStyles:[],id:y+Fe+"-"+st,domId:Lt(y,st,oe),type:_.type,isGroup:_.type==="group",padding:G.flowchart?.padding,look:C,position:i.note.position},B=y+Kt,K={labelStyle:"",shape:De,label:i.note.text,cssClasses:_.cssClasses,cssStyles:[],id:y+Kt,domId:Lt(y,st,ne),type:"group",isGroup:!0,padding:16,look:C,position:i.note.position};st++,K.id=B,U.parentId=B,dt(a,K,x),dt(a,U,x),dt(a,M,x);let Y=y,X=U.id;if(i.note.position==="left of")Y=U.id,X=y;E.push({id:Y+"-"+X,start:Y,end:X,arrowhead:"none",arrowTypeEnd:"",style:te,labelStyle:"",classes:Le,arrowheadStyle:ee,labelpos:se,labelType:ie,thickness:re,look:C})}else dt(a,M,x)}if(i.doc)t.trace("Adding nodes children "),Ye(i,i.doc,T,a,E,!k,C,x)},"dataFetcher"),Ge=e(()=>{xt.clear(),st=0},"reset"),P={START_NODE:"[*]",START_TYPE:"start",END_NODE:"[*]",END_TYPE:"end",COLOR_KEYWORD:"color",FILL_KEYWORD:"fill",BG_FILL:"bgFill",STYLECLASS_SEP:","},Jt=e(()=>new Map,"newClassesList"),qt=e(()=>({relations:[],states:new Map,documents:{}}),"newDoc"),At=e((s)=>JSON.parse(JSON.stringify(s)),"clone"),et=class{constructor(s){this.version=s,this.nodes=[],this.edges=[],this.rootDoc=[],this.classes=Jt(),this.documents={root:qt()},this.currentDocument=this.documents.root,this.startEndCount=0,this.dividerCnt=0,this.links=new Map,this.funs=[],this.getAccTitle=p,this.setAccTitle=f,this.getAccDescription=g,this.setAccDescription=m,this.setDiagramTitle=b,this.getDiagramTitle=v,this.clear(),this.setRootDoc=this.setRootDoc.bind(this),this.getDividerId=this.getDividerId.bind(this),this.setDirection=this.setDirection.bind(this),this.trimColon=this.trimColon.bind(this),this.bindFunctions=this.bindFunctions.bind(this)}static{e(this,"StateDB")}static{this.relationType={AGGREGATION:0,EXTENSION:1,COMPOSITION:2,DEPENDENCY:3}}extract(s){this.clear(!0);for(let a of Array.isArray(s)?s:s.doc)switch(a.stmt){case ht:this.addState(a.id.trim(),a.type,a.doc,a.description,a.note);break;case Gt:this.addRelation(a.state1,a.state2,a.description);break;case Te:this.addStyleClass(a.id.trim(),a.classes);break;case be:this.handleStyleDef(a);break;case Ee:this.setCssClass(a.id.trim(),a.styleClass);break;case"click":this.addLink(a.id,a.url,a.tooltip);break}let i=this.getStates(),T=r();Ge(),ft(void 0,this.getRootDocV2(),i,this.nodes,this.edges,!0,T.look,this.classes);for(let a of this.nodes){if(!Array.isArray(a.label))continue;if(a.description=a.label.slice(1),a.isGroup&&a.description.length>0)throw Error(`Group nodes can only have label. Remove the additional description for node [${a.id}]`);a.label=a.label[0]}}handleStyleDef(s){let i=s.id.trim().split(","),T=s.styleClass.split(",");for(let a of i){let E=this.getState(a);if(!E){let k=a.trim();this.addState(k),E=this.getState(k)}if(E)E.styles=T.map((k)=>k.replace(/;/g,"")?.trim())}}setRootDoc(s){if(t.info("Setting root doc",s),this.rootDoc=s,this.version===1)this.extract(s);else this.extract(this.getRootDocV2())}docTranslator(s,i,T){if(i.stmt===Gt){this.docTranslator(s,i.state1,!0),this.docTranslator(s,i.state2,!1);return}if(i.stmt===ht)if(i.id===P.START_NODE)i.id=s.id+(T?"_start":"_end"),i.start=T;else i.id=i.id.trim();if(i.stmt!==ct&&i.stmt!==ht||!i.doc)return;let a=[],E=[];for(let k of i.doc)if(k.type===Zt){let C=At(k);C.doc=At(E),a.push(C),E=[]}else E.push(k);if(a.length>0&&E.length>0){let k={stmt:ht,id:Ti(),type:"divider",doc:At(E)};a.push(At(k)),i.doc=a}i.doc.forEach((k)=>this.docTranslator(i,k,!0))}getRootDocV2(){return this.docTranslator({id:ct,stmt:ct},{id:ct,stmt:ct,doc:this.rootDoc},!0),{id:ct,doc:this.rootDoc}}addState(s,i=pt,T=void 0,a=void 0,E=void 0,k=void 0,C=void 0,x=void 0){let y=s?.trim();if(!this.currentDocument.states.has(y))t.info("Adding state ",y,a),this.currentDocument.states.set(y,{stmt:ht,id:y,descriptions:[],type:i,doc:T,note:E,classes:[],styles:[],textStyles:[]});else{let I=this.currentDocument.states.get(y);if(!I)throw Error(`State not found: ${y}`);if(!I.doc)I.doc=T;if(!I.type)I.type=i}if(a)t.info("Setting state description",y,a),(Array.isArray(a)?a:[a]).forEach((O)=>this.addDescription(y,O.trim()));if(E){let I=this.currentDocument.states.get(y);if(!I)throw Error(`State not found: ${y}`);I.note=E,I.note.text=l.sanitizeText(I.note.text,r())}if(k)t.info("Setting state classes",y,k),(Array.isArray(k)?k:[k]).forEach((O)=>this.setCssClass(y,O.trim()));if(C)t.info("Setting state styles",y,C),(Array.isArray(C)?C:[C]).forEach((O)=>this.setStyle(y,O.trim()));if(x)t.info("Setting state styles",y,C),(Array.isArray(x)?x:[x]).forEach((O)=>this.setTextStyle(y,O.trim()))}clear(s){if(this.nodes=[],this.edges=[],this.funs=[this.setupToolTips.bind(this)],this.documents={root:qt()},this.currentDocument=this.documents.root,this.startEndCount=0,this.classes=Jt(),!s)this.links=new Map,d()}getState(s){return this.currentDocument.states.get(s)}getStates(){return this.currentDocument.states}logDocuments(){t.info("Documents = ",this.documents)}getRelations(){return this.currentDocument.relations}addLink(s,i,T){this.links.set(s,{url:i,tooltip:T}),t.warn("Adding link",s,i,T)}getLinks(){return this.links}startIdIfNeeded(s=""){if(s===P.START_NODE)return this.startEndCount++,`${P.START_TYPE}${this.startEndCount}`;return s}startTypeIfNeeded(s="",i=pt){return s===P.START_NODE?P.START_TYPE:i}endIdIfNeeded(s=""){if(s===P.END_NODE)return this.startEndCount++,`${P.END_TYPE}${this.startEndCount}`;return s}endTypeIfNeeded(s="",i=pt){return s===P.END_NODE?P.END_TYPE:i}addRelationObjs(s,i,T=""){let a=this.startIdIfNeeded(s.id.trim()),E=this.startTypeIfNeeded(s.id.trim(),s.type),k=this.startIdIfNeeded(i.id.trim()),C=this.startTypeIfNeeded(i.id.trim(),i.type);this.addState(a,E,s.doc,s.description,s.note,s.classes,s.styles,s.textStyles),this.addState(k,C,i.doc,i.description,i.note,i.classes,i.styles,i.textStyles),this.currentDocument.relations.push({id1:a,id2:k,relationTitle:l.sanitizeText(T,r())})}addRelation(s,i,T){if(typeof s==="object"&&typeof i==="object")this.addRelationObjs(s,i,T);else if(typeof s==="string"&&typeof i==="string"){let a=this.startIdIfNeeded(s.trim()),E=this.startTypeIfNeeded(s),k=this.endIdIfNeeded(i.trim()),C=this.endTypeIfNeeded(i);this.addState(a,E),this.addState(k,C),this.currentDocument.relations.push({id1:a,id2:k,relationTitle:T?l.sanitizeText(T,r()):void 0})}}addDescription(s,i){let T=this.currentDocument.states.get(s),a=i.startsWith(":")?i.replace(":","").trim():i;T?.descriptions?.push(l.sanitizeText(a,r()))}cleanupLabel(s){return s.startsWith(":")?s.slice(2).trim():s.trim()}getDividerId(){return this.dividerCnt++,`divider-id-${this.dividerCnt}`}addStyleClass(s,i=""){if(!this.classes.has(s))this.classes.set(s,{id:s,styles:[],textStyles:[]});let T=this.classes.get(s);if(i&&T)i.split(P.STYLECLASS_SEP).forEach((a)=>{let E=a.replace(/([^;]*);/,"$1").trim();if(RegExp(P.COLOR_KEYWORD).exec(a)){let C=E.replace(P.FILL_KEYWORD,P.BG_FILL).replace(P.COLOR_KEYWORD,P.FILL_KEYWORD);T.textStyles.push(C)}T.styles.push(E)})}getClasses(){return this.classes}setupToolTips(s){let i=It();n(s).select("svg").selectAll("g.node, g.rough-node").on("mouseover",(E)=>{let k=n(E.currentTarget),C=k.attr("title");if(C===null)return;let x=E.currentTarget?.getBoundingClientRect();i.transition().duration(200).style("opacity",".9"),i.style("left",window.scrollX+x.left+(x.right-x.left)/2+"px").style("top",window.scrollY+x.bottom+"px"),i.html(V.sanitize(C)),k.classed("hover",!0)}).on("mouseout",(E)=>{i.transition().duration(500).style("opacity",0),n(E.currentTarget).classed("hover",!1)})}setCssClass(s,i){s.split(",").forEach((T)=>{let a=this.getState(T);if(!a){let E=T.trim();this.addState(E),a=this.getState(E)}a?.classes?.push(i)})}setStyle(s,i){this.getState(s)?.styles?.push(i)}setTextStyle(s,i){this.getState(s)?.textStyles?.push(i)}bindFunctions(s){this.funs.forEach((i)=>{i(s)})}getDirectionStatement(){return this.rootDoc.find((s)=>s.stmt===jt)}getDirection(){return this.getDirectionStatement()?.value??ge}setDirection(s){let i=this.getDirectionStatement();if(i)i.value=s;else this.rootDoc.unshift({stmt:jt,value:s})}trimColon(s){return s.startsWith(":")?s.slice(1).trim():s.trim()}getData(){let s=r();return{nodes:this.nodes,edges:this.edges,other:{},config:s,direction:ce(this.getRootDocV2())}}getConfig(){return r().state}},Ve=e((s)=>`
defs [id$="-barbEnd"] {
    fill: ${s.transitionColor};
    stroke: ${s.transitionColor};
  }
g.stateGroup text {
  fill: ${s.nodeBorder};
  stroke: none;
  font-size: 10px;
}
g.stateGroup text {
  fill: ${s.textColor};
  stroke: none;
  font-size: 10px;

}
g.stateGroup .state-title {
  font-weight: bolder;
  fill: ${s.stateLabelColor};
}

g.stateGroup rect {
  fill: ${s.mainBkg};
  stroke: ${s.nodeBorder};
}

g.stateGroup line {
  stroke: ${s.lineColor};
  stroke-width: ${s.strokeWidth||1};
}

.transition {
  stroke: ${s.transitionColor};
  stroke-width: ${s.strokeWidth||1};
  fill: none;
}

.stateGroup .composit {
  fill: ${s.background};
  border-bottom: 1px
}

.stateGroup .alt-composit {
  fill: #e0e0e0;
  border-bottom: 1px
}

.state-note {
  stroke: ${s.noteBorderColor};
  fill: ${s.noteBkgColor};

  text {
    fill: ${s.noteTextColor};
    stroke: none;
    font-size: 10px;
  }
}

.stateLabel .box {
  stroke: none;
  stroke-width: 0;
  fill: ${s.mainBkg};
  opacity: 0.5;
}

.edgeLabel .label rect {
  fill: ${s.labelBackgroundColor};
  opacity: 0.5;
}
.edgeLabel {
  background-color: ${s.edgeLabelBackground};
  p {
    background-color: ${s.edgeLabelBackground};
  }
  rect {
    opacity: 0.5;
    background-color: ${s.edgeLabelBackground};
    fill: ${s.edgeLabelBackground};
  }
  text-align: center;
}
.edgeLabel .label text {
  fill: ${s.transitionLabelColor||s.tertiaryTextColor};
}
.label div .edgeLabel {
  color: ${s.transitionLabelColor||s.tertiaryTextColor};
}

.stateLabel text {
  fill: ${s.stateLabelColor};
  font-size: 10px;
  font-weight: bold;
}

.node circle.state-start {
  fill: ${s.specialStateColor};
  stroke: ${s.specialStateColor};
}

.node .fork-join {
  fill: ${s.specialStateColor};
  stroke: ${s.specialStateColor};
}

.node circle.state-end {
  fill: ${s.innerEndBackground};
  stroke: ${s.background};
  stroke-width: 1.5
}
.end-state-inner {
  fill: ${s.compositeBackground||s.background};
  // stroke: ${s.background};
  stroke-width: 1.5
}

.node rect {
  fill: ${s.stateBkg||s.mainBkg};
  stroke: ${s.stateBorder||s.nodeBorder};
  stroke-width: ${s.strokeWidth||1}px;
}
.node polygon {
  fill: ${s.mainBkg};
  stroke: ${s.stateBorder||s.nodeBorder};;
  stroke-width: ${s.strokeWidth||1}px;
}
[id$="-barbEnd"] {
  fill: ${s.lineColor};
}

.statediagram-cluster rect {
  fill: ${s.compositeTitleBackground};
  stroke: ${s.stateBorder||s.nodeBorder};
  stroke-width: ${s.strokeWidth||1}px;
}

.cluster-label, .nodeLabel {
  color: ${s.stateLabelColor};
  // line-height: 1;
}

.statediagram-cluster rect.outer {
  rx: 5px;
  ry: 5px;
}
.statediagram-state .divider {
  stroke: ${s.stateBorder||s.nodeBorder};
}

.statediagram-state .title-state {
  rx: 5px;
  ry: 5px;
}
.statediagram-cluster.statediagram-cluster .inner {
  fill: ${s.compositeBackground||s.background};
}
.statediagram-cluster.statediagram-cluster-alt .inner {
  fill: ${s.altBackground?s.altBackground:"#efefef"};
}

.statediagram-cluster .inner {
  rx:0;
  ry:0;
}

.statediagram-state rect.basic {
  rx: 5px;
  ry: 5px;
}
.statediagram-state rect.divider {
  stroke-dasharray: 10,10;
  fill: ${s.altBackground?s.altBackground:"#efefef"};
}

.note-edge {
  stroke-dasharray: 5;
}

.statediagram-note rect {
  fill: ${s.noteBkgColor};
  stroke: ${s.noteBorderColor};
  stroke-width: 1px;
  rx: 0;
  ry: 0;
}
.statediagram-note rect {
  fill: ${s.noteBkgColor};
  stroke: ${s.noteBorderColor};
  stroke-width: 1px;
  rx: 0;
  ry: 0;
}

.statediagram-note text {
  fill: ${s.noteTextColor};
}

.statediagram-note .nodeLabel {
  color: ${s.noteTextColor};
}
.statediagram .edgeLabel {
  color: red; // ${s.noteTextColor};
}

[id$="-dependencyStart"], [id$="-dependencyEnd"] {
  fill: ${s.lineColor};
  stroke: ${s.lineColor};
  stroke-width: ${s.strokeWidth||1};
}

.statediagramTitleText {
  text-anchor: middle;
  font-size: 18px;
  fill: ${s.textColor};
}

[data-look="neo"].statediagram-cluster rect {
  fill: ${s.mainBkg};
  stroke: ${s.useGradient?"url("+s.svgId+"-gradient)":s.stateBorder||s.nodeBorder};
  stroke-width: ${s.strokeWidth??1};
}
[data-look="neo"].statediagram-cluster rect.outer {
  rx: ${s.radius}px;
  ry: ${s.radius}px;
  filter: ${s.dropShadow?s.dropShadow.replace("url(#drop-shadow)",`url(${s.svgId}-drop-shadow)`):"none"}
}
`,"getStyles"),Ir=Ve;
export{Rr,Ri,et,Ir};
