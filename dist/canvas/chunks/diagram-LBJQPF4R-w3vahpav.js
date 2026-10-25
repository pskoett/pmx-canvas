import{R}from"./index-353m7b0p.js";import{e,t,x,u,k,d,f,p,m,g,b,v,A,E}from"./index-1r72hdzb.js";import"./index-6qmsnxwy.js";import{D}from"./index-tb1wf525.js";var N=x.packet,z=class{constructor(){this.packet=[],this.setAccTitle=f,this.getAccTitle=p,this.setDiagramTitle=b,this.getDiagramTitle=v,this.getAccDescription=g,this.setAccDescription=m}static{e(this,"PacketDB")}getConfig(){let r=E({...N,...u().packet});if(r.showBits)r.paddingY+=10;return r}getPacket(){return this.packet}pushWord(r){if(r.length>0)this.packet.push(r)}clear(){d(),this.packet=[]}},L=1e4,M=e((r,a)=>{R(r,a);let i=-1,s=[],c=1,{bitsPerRow:h}=a.getConfig();for(let{start:o,end:l,bits:y,label:w}of r.blocks){if(o!==void 0&&l!==void 0&&l<o)throw Error(`Packet block ${o} - ${l} is invalid. End must be greater than start.`);if(o??=i+1,o!==i+1)throw Error(`Packet block ${o} - ${l??o} is not contiguous. It should start from ${i+1}.`);if(y===0)throw Error(`Packet block ${o} is invalid. Cannot have a zero bit field.`);l??=o+(y??1)-1,y??=l-o+1,i=l,t.debug(`Packet block ${o} - ${i} with label ${w}`);while(s.length<=h+1&&a.getPacket().length<L){let[B,n]=Y({start:o,end:l,bits:y,label:w},c,h);if(s.push(B),B.end+1===c*h)a.pushWord(s),s=[],c++;if(!n)break;({start:o,end:l,bits:y,label:w}=n)}}a.pushWord(s)},"populate"),Y=e((r,a,i)=>{if(r.start===void 0)throw Error("start should have been set during first phase");if(r.end===void 0)throw Error("end should have been set during first phase");if(r.start>r.end)throw Error(`Block start ${r.start} is greater than block end ${r.end}.`);if(r.end+1<=a*i)return[r,void 0];let s=a*i-1,c=a*i;return[{start:r.start,end:s,label:r.label,bits:s-r.start},{start:c,end:r.end,label:r.label,bits:r.end-c}]},"getNextFittingBlock"),F={parser:{yy:void 0},parse:e(async(r)=>{let a=await D("packet",r),i=F.parser?.yy;if(!(i instanceof z))throw Error("parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.");t.debug(a),M(a,i)},"parse")},I=e((r,a,i,s)=>{let c=s.db,h=c.getConfig(),{rowHeight:o,paddingY:l,bitWidth:y,bitsPerRow:w}=h,B=c.getPacket(),n=c.getDiagramTitle(),S=o+l,C=S*(B.length+1)-(n?0:o),T=y*w+2,P=A(a);P.attr("viewBox",`0 0 ${T} ${C}`),k(P,C,T,h.useMaxWidth);for(let[W,_]of B.entries())O(P,_,W,h);P.append("text").text(n).attr("x",T/2).attr("y",C-S/2).attr("dominant-baseline","middle").attr("text-anchor","middle").attr("class","packetTitle")},"draw"),O=e((r,a,i,{rowHeight:s,paddingX:c,paddingY:h,bitWidth:o,bitsPerRow:l,showBits:y})=>{let w=r.append("g"),B=i*(s+h)+h;for(let n of a){let S=n.start%l*o+1,C=(n.end-n.start+1)*o-c;if(w.append("rect").attr("x",S).attr("y",B).attr("width",C).attr("height",s).attr("class","packetBlock"),w.append("text").attr("x",S+C/2).attr("y",B+s/2).attr("class","packetLabel").attr("dominant-baseline","middle").attr("text-anchor","middle").text(n.label),!y)continue;let T=n.end===n.start,P=B-2;if(w.append("text").attr("x",S+(T?C/2:0)).attr("y",P).attr("class","packetByte start").attr("dominant-baseline","auto").attr("text-anchor",T?"middle":"start").text(n.start),!T)w.append("text").attr("x",S+C).attr("y",P).attr("class","packetByte end").attr("dominant-baseline","auto").attr("text-anchor","end").text(n.end)}},"drawWord"),j={draw:I},G={byteFontSize:"10px",startByteColor:"black",endByteColor:"black",labelColor:"black",labelFontSize:"12px",titleColor:"black",titleFontSize:"14px",blockStrokeColor:"black",blockStrokeWidth:"1",blockFillColor:"#efefef"},H=e(({packet:r}={})=>{let a=E(G,r);return`
	.packetByte {
		font-size: ${a.byteFontSize};
	}
	.packetByte.start {
		fill: ${a.startByteColor};
	}
	.packetByte.end {
		fill: ${a.endByteColor};
	}
	.packetLabel {
		fill: ${a.labelColor};
		font-size: ${a.labelFontSize};
	}
	.packetTitle {
		fill: ${a.titleColor};
		font-size: ${a.titleFontSize};
	}
	.packetBlock {
		stroke: ${a.blockStrokeColor};
		stroke-width: ${a.blockStrokeWidth};
		fill: ${a.blockFillColor};
	}
	`},"styles"),Z={parser:F,get db(){return new z},renderer:j,styles:H};export{Z as diagram};
