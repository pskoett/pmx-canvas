import{R}from"./index-5n03dmb9.js";import{e,t,j,x,u,T,d,f,p,m,g,b,v,A,E}from"./index-nwsya6dj.js";import"./index-v119nznk.js";import{D}from"./index-zx0j3a2z.js";var S={showLegend:!0,ticks:5,max:null,min:0,graticule:"circle"},F=32,P={axes:[],curves:[],options:S},L=structuredClone(P),X=x.radar,K=e(()=>E({...X,...u().radar}),"getConfig"),z=e(()=>L.axes,"getAxes"),N=e(()=>L.curves,"getCurves"),Y=e(()=>L.options,"getOptions"),Z=e((n)=>{L.axes=n.map((a)=>({name:a.name,label:a.label??a.name}))},"setAxes"),q=e((n)=>{L.curves=n.map((a)=>({name:a.name,label:a.label??a.name,entries:J(a.entries)}))},"setCurves"),J=e((n)=>{if(n[0].axis==null)return n.map((r)=>r.value);let a=z();if(a.length===0)throw Error("Axes must be populated before curves for reference entries");return a.map((r)=>{let s=n.find((o)=>o.axis?.$refText===r.name);if(s===void 0)throw Error("Missing entry for axis "+r.label);return s.value})},"computeCurveEntries"),Q=e((n)=>{let a=n.reduce((r,s)=>(r[s.name]=s,r),{});if(L.options={showLegend:a.showLegend?.value??S.showLegend,ticks:a.ticks?.value??S.ticks,max:a.max?.value??S.max,min:a.min?.value??S.min,graticule:a.graticule?.value??S.graticule},L.options.ticks>F)t.warn(`Radar diagram ticks (${L.options.ticks}) exceeds maximum allowed (${F}). Using ${F} instead.`),L.options.ticks=F},"setOptions"),tt=e(()=>{d(),L=structuredClone(P)},"clear"),I={getAxes:z,getCurves:N,getOptions:Y,setAxes:Z,setCurves:q,setOptions:Q,getConfig:K,clear:tt,setAccTitle:f,getAccTitle:p,setDiagramTitle:b,getDiagramTitle:v,getAccDescription:g,setAccDescription:m},et=e((n)=>{R(n,I);let{axes:a,curves:r,options:s}=n;I.setAxes(a),I.setCurves(r),I.setOptions(s)},"populate"),at={parse:e(async(n)=>{let a=await D("radar",n);t.debug(a),et(a)},"parse")},rt=e((n,a,r,s)=>{let o=s.db,c=o.getAxes(),h=o.getCurves(),i=o.getOptions(),l=o.getConfig(),y=o.getDiagramTitle(),C=A(a),w=nt(C,l),M=i.max??Math.max(...h.map((_)=>Math.max(..._.entries))),k=i.min,O=Math.min(l.width,l.height)/2;st(w,c,O,i.ticks,i.graticule),ot(w,c,O,l),G(w,c,h,k,M,i.graticule,l),V(w,h,i.showLegend,l),w.append("text").attr("class","radarTitle").text(y).attr("x",0).attr("y",-l.height/2-l.marginTop)},"draw"),nt=e((n,a)=>{let r=a.width+a.marginLeft+a.marginRight,s=a.height+a.marginTop+a.marginBottom,o={x:a.marginLeft+a.width/2,y:a.marginTop+a.height/2};return T(n,s,r,a.useMaxWidth??!0),n.attr("viewBox",`0 0 ${r} ${s}`).attr("overflow","visible"),n.append("g").attr("transform",`translate(${o.x}, ${o.y})`)},"drawFrame"),st=e((n,a,r,s,o)=>{if(o==="circle")for(let c=0;c<s;c++){let h=r*(c+1)/s;n.append("circle").attr("r",h).attr("class","radarGraticule")}else if(o==="polygon"){let c=a.length;for(let h=0;h<s;h++){let i=r*(h+1)/s,l=a.map((y,C)=>{let w=2*C*Math.PI/c-Math.PI/2,M=i*Math.cos(w),k=i*Math.sin(w);return`${M},${k}`}).join(" ");n.append("polygon").attr("points",l).attr("class","radarGraticule")}}},"drawGraticule"),ot=e((n,a,r,s)=>{let o=a.length;for(let c=0;c<o;c++){let h=a[c].label,i=2*c*Math.PI/o-Math.PI/2,l=Math.cos(i),y=Math.sin(i);n.append("line").attr("x1",0).attr("y1",0).attr("x2",r*s.axisScaleFactor*l).attr("y2",r*s.axisScaleFactor*y).attr("class","radarAxisLine");let C=l>0.01?"start":l<-0.01?"end":"middle",w=y>0.01?"hanging":y<-0.01?"auto":"central",M=4;n.append("text").text(h).attr("x",r*s.axisLabelFactor*l+M*l).attr("y",r*s.axisLabelFactor*y+M*y).attr("text-anchor",C).attr("dominant-baseline",w).attr("class","radarAxisLabel")}},"drawAxes");function G(n,a,r,s,o,c,h){let i=a.length,l=Math.min(h.width,h.height)/2;r.forEach((y,C)=>{if(y.entries.length!==i)return;let w=y.entries.map((M,k)=>{let O=2*Math.PI*k/i-Math.PI/2,_=B(M,s,o,l),H=_*Math.cos(O),U=_*Math.sin(O);return{x:H,y:U}});if(c==="circle")n.append("path").attr("d",W(w,h.curveTension)).attr("class",`radarCurve-${C}`);else if(c==="polygon")n.append("polygon").attr("points",w.map((M)=>`${M.x},${M.y}`).join(" ")).attr("class",`radarCurve-${C}`)})}e(G,"drawCurves");function B(n,a,r,s){let o=Math.min(Math.max(n,a),r);return s*(o-a)/(r-a)}e(B,"relativeRadius");function W(n,a){let r=n.length,s=`M${n[0].x},${n[0].y}`;for(let o=0;o<r;o++){let c=n[(o-1+r)%r],h=n[o],i=n[(o+1)%r],l=n[(o+2)%r],y={x:h.x+(i.x-c.x)*a,y:h.y+(i.y-c.y)*a},C={x:i.x-(l.x-h.x)*a,y:i.y-(l.y-h.y)*a};s+=` C${y.x},${y.y} ${C.x},${C.y} ${i.x},${i.y}`}return`${s} Z`}e(W,"closedRoundCurve");function V(n,a,r,s){if(!r)return;let o=(s.width/2+s.marginRight)*3/4,c=-(s.height/2+s.marginTop)*3/4,h=20;a.forEach((i,l)=>{let y=n.append("g").attr("transform",`translate(${o}, ${c+l*h})`);y.append("rect").attr("width",12).attr("height",12).attr("class",`radarLegendBox-${l}`),y.append("text").attr("x",16).attr("y",0).attr("class","radarLegendText").text(i.label)})}e(V,"drawLegend");var it={draw:rt},lt=e((n,a)=>{let r="";for(let s=0;s<n.THEME_COLOR_LIMIT;s++){let o=n[`cScale${s}`];r+=`
		.radarCurve-${s} {
			color: ${o};
			fill: ${o};
			fill-opacity: ${a.curveOpacity};
			stroke: ${o};
			stroke-width: ${a.curveStrokeWidth};
		}
		.radarLegendBox-${s} {
			fill: ${o};
			fill-opacity: ${a.curveOpacity};
			stroke: ${o};
		}
		`}return r},"genIndexStyles"),ct=e((n)=>{let a=j(),r=u(),s=E(a,r.themeVariables),o=E(s.radar,n);return{themeVariables:s,radarOptions:o}},"buildRadarStyleOptions"),dt=e(({radar:n}={})=>{let{themeVariables:a,radarOptions:r}=ct(n);return`
	.radarTitle {
		font-size: ${a.fontSize};
		color: ${a.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${r.axisColor};
		stroke-width: ${r.axisStrokeWidth};
	}
	.radarAxisLabel {
		font-size: ${r.axisLabelFontSize}px;
		color: ${r.axisColor};
	}
	.radarGraticule {
		fill: ${r.graticuleColor};
		fill-opacity: ${r.graticuleOpacity};
		stroke: ${r.graticuleColor};
		stroke-width: ${r.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${r.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${lt(a,r)}
	`},"styles"),$t={parser:at,db:I,renderer:it,styles:dt};export{$t as diagram};
