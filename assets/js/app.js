const API="https://api.binance.com";const WS_BASE="wss://stream.binance.com:9443/ws";let currentSymbol="BTCUSDT",currentTf="1h",rawCandles=[],candles=[],klineWs=null,tickerWs=null,wsSession=0,resyncTimer=null,vwapAnchor="W",cache={};
// THÊM BIẾN LƯU CHIỀU DÀI EMA ĐỘNG (Mặc định 34)
let emaDynLen = 38;
const indicatorState={emaPrice:false,wmaPrice:false,volume:true,vwap:true,baselineFast:true,baselineSlow:true,rsi:true,rsiEma:true,rsiWma:true,volMa:true,emaDyn:true};

// ĐỔI MẶC ĐỊNH BASELINE THÀNH 70 - 150
const BL_DEFAULTS={fast:{length:70,phase:5,power:2},slow:{length:150,phase:0,power:2}};
let blSettings=loadBlSettings();const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat("en-US",{maximumFractionDigits:2});
const fmtVol=new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:2});
// ĐÃ THÊM FORMAT GIÁ CÓ DẤU PHẨY (VD: 65,200.0)
const fmtPrice=new Intl.NumberFormat("en-US",{minimumFractionDigits: 1, maximumFractionDigits: 4});
const TIMEZONE_OFFSET_SECONDS=7*60*60;

function pad2(n){return String(n).padStart(2,"0")}
function dateInUtcPlus7(time){return new Date((time+TIMEZONE_OFFSET_SECONDS)*1000)}
function formatChartTime(time){if(typeof time!=="number")return"";const d=dateInUtcPlus7(time);return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth()+1)}/${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`}
function formatTickTime(time){
    if(typeof time!=="number")return"";
    const d=dateInUtcPlus7(time), h=d.getUTCHours(), m=d.getUTCMinutes();
    return (h===7&&m===0)||(h===0&&m===0) ? `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth()+1)}` : `${pad2(h)}:${pad2(m)}`;
}
function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
function normalizeBlSettings(raw){const src=raw&&typeof raw==="object"?raw:{};return{fast:{length:clamp(parseInt(src.fast?.length??BL_DEFAULTS.fast.length)||BL_DEFAULTS.fast.length,1,1000),phase:clamp(parseFloat(src.fast?.phase??BL_DEFAULTS.fast.phase)||0,-100,100),power:clamp(parseInt(src.fast?.power??BL_DEFAULTS.fast.power)||BL_DEFAULTS.fast.power,1,10)},slow:{length:clamp(parseInt(src.slow?.length??BL_DEFAULTS.slow.length)||BL_DEFAULTS.slow.length,1,1000),phase:clamp(parseFloat(src.slow?.phase??BL_DEFAULTS.slow.phase)||0,-100,100),power:clamp(parseInt(src.slow?.power??BL_DEFAULTS.slow.power)||BL_DEFAULTS.slow.power,1,10)}}}
// Đổi key lưu trữ thành v4 để ép reset cấu hình cũ trên máy anh
function loadBlSettings(){try{return normalizeBlSettings(JSON.parse(localStorage.getItem("xtb_bl_jma_settings_v4")||"{}"))}catch(e){return normalizeBlSettings({})}}function saveBlSettings(){localStorage.setItem("xtb_bl_jma_settings_v4",JSON.stringify(blSettings))}function blName(kind){return `BL ${blSettings[kind].length}`}function setIfText(id,value){const el=$(id);if(el)el.textContent=value}function syncBlSettingsUi(){setIfText("blFastToggleLabel",blName("fast"));setIfText("blSlowToggleLabel",blName("slow"));setIfText("blFastValueLabel",blName("fast"));setIfText("blSlowValueLabel",blName("slow"));[["blFastLength",blSettings.fast.length],["blFastPhase",blSettings.fast.phase],["blFastPower",blSettings.fast.power],["blSlowLength",blSettings.slow.length],["blSlowPhase",blSettings.slow.phase],["blSlowPower",blSettings.slow.power]].forEach(([id,v])=>{const el=$(id);if(el)el.value=v});if(typeof baselineFastSeries!=="undefined")baselineFastSeries.applyOptions({title:blName("fast")});if(typeof baselineSlowSeries!=="undefined")baselineSlowSeries.applyOptions({title:blName("slow")})}function readBlSettingsFromUi(){blSettings=normalizeBlSettings({fast:{length:$("blFastLength")?.value,phase:$("blFastPhase")?.value,power:$("blFastPower")?.value},slow:{length:$("blSlowLength")?.value,phase:$("blSlowPhase")?.value,power:$("blSlowPower")?.value}});saveBlSettings();syncBlSettingsUi();drawCharts()}

// TÍCH HỢP FORMAT GIÁ VÀO CHART
const priceChart=LightweightCharts.createChart($("priceChart"),{autoSize:true,layout:{background:{color:"#0f131a"},textColor:"#787b86"},grid:{vertLines:{color:"rgba(42,46,57,.18)"},horzLines:{color:"rgba(42,46,57,.18)"}},rightPriceScale:{borderColor:"#2a2e39"},timeScale:{borderColor:"#2a2e39",timeVisible:true,secondsVisible:false,tickMarkFormatter:formatTickTime,rightOffset:5,barSpacing:6},localization:{locale:"vi-VN",timeFormatter:formatChartTime, priceFormatter: p => fmtPrice.format(p)},crosshair:{mode:LightweightCharts.CrosshairMode.Normal}});

// THIẾT LẬP MÀU NẾN MỚI TỪ ẢNH TRADINGVIEW (Thân Trắng/Xám, Tắt viền, Râu Xanh/Đỏ)
const candleSeries=priceChart.addCandlestickSeries({
    upColor: '#ffffff',       // <-- ĐÂY LÀ MÀU THÂN NẾN TĂNG (Đang để Trắng)
    downColor: '#8a919e',     // <-- ĐÂY LÀ MÀU THÂN NẾN GIẢM (Đang để Xám)
    borderVisible: false,     // Trạng thái: Tắt viền nến
    wickVisible: true,        // Trạng thái: Bật râu nến
    wickUpColor: '#089981',   // Màu râu nến tăng (Xanh ngọc)
    wickDownColor: '#f23645'  // Màu râu nến giảm (Đỏ)
});

const volumeSeries=priceChart.addHistogramSeries({priceFormat:{type:"volume"},priceScaleId:"",lastValueVisible:false,priceLineVisible:false,scaleMargins:{top:.8,bottom:0}});
const volMaSeries=priceChart.addLineSeries({color:"rgba(255, 255, 255, 0.4)",lineWidth:1,priceScaleId:"",lastValueVisible:false,priceLineVisible:false});volMaSeries.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});
const emaPriceSeries=priceChart.addLineSeries({color:"#f0b90b",lineWidth:2,title:"",lastValueVisible:false,priceLineVisible:false});const wmaPriceSeries=priceChart.addLineSeries({color:"#38bdf8",lineWidth:2,title:"",lastValueVisible:false,priceLineVisible:false});
// KHỞI TẠO ĐƯỜNG EMA ĐỘNG MỚI (Màu xanh lá)
const emaDynSeries=priceChart.addLineSeries({color:"#ffffff",lineWidth:2,title:"",lastValueVisible:false,priceLineVisible:false});

const vwapSeries=priceChart.addLineSeries({color:"#2962ff",lineWidth:2,title:"",lastValueVisible:false,priceLineVisible:false});const baselineFastSeries=priceChart.addLineSeries({color:"#ffd54f",lineWidth:2,title:"BL 75",lastValueVisible:false,priceLineVisible:false});const baselineSlowSeries=priceChart.addLineSeries({color:"#9c27b0",lineWidth:2,title:"BL 150",lastValueVisible:false,priceLineVisible:false});const btEntrySeries=priceChart.addLineSeries({color:"#2962ff",lineWidth:1,lineStyle:2,title:"",lastValueVisible:false,priceLineVisible:false});const btSlSeries=priceChart.addLineSeries({color:"#ff3b30",lineWidth:1,lineStyle:2,title:"",lastValueVisible:false,priceLineVisible:false});const btTpSeries=priceChart.addLineSeries({color:"#00c853",lineWidth:1,lineStyle:2,title:"",lastValueVisible:false,priceLineVisible:false});let backtestTrades=[],backtestReplayIndex=0,backtestReplayTimer=null;
const rsiChart=LightweightCharts.createChart($("rsiChart"),{autoSize:true,layout:{background:{color:"#0f131a"},textColor:"#787b86"},grid:{vertLines:{color:"rgba(42,46,57,.14)"},horzLines:{color:"rgba(42,46,57,.14)"}},rightPriceScale:{borderColor:"#2a2e39"},timeScale:{borderColor:"#2a2e39",timeVisible:true,secondsVisible:false,tickMarkFormatter:formatTickTime,rightOffset:5,barSpacing:6},localization:{locale:"vi-VN",timeFormatter:formatChartTime}});const rsiSeries=rsiChart.addLineSeries({color:"#fff",lineWidth:2,title:"",lastValueVisible:false,priceLineVisible:false});const rsiEmaSeries=rsiChart.addLineSeries({color:"#ff9800",lineWidth:2,title:"",lastValueVisible:false,priceLineVisible:false});const rsiWmaSeries=rsiChart.addLineSeries({color:"#ff3b30",lineWidth:2,title:"",lastValueVisible:false,priceLineVisible:false});const rsi70=rsiChart.addLineSeries({color:"#787b86",lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false});const rsi50=rsiChart.addLineSeries({color:"#787b86",lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false});const rsi30=rsiChart.addLineSeries({color:"#787b86",lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false});

let lastRangeHash="";priceChart.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(!r)return;const hash=`${r.from.toFixed(2)}|${r.to.toFixed(2)}`;if(lastRangeHash===hash)return;lastRangeHash=hash;rsiChart.timeScale().setVisibleLogicalRange(r)});rsiChart.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(!r)return;const hash=`${r.from.toFixed(2)}|${r.to.toFixed(2)}`;if(lastRangeHash===hash)return;lastRangeHash=hash;priceChart.timeScale().setVisibleLogicalRange(r)});

function getTimeframeConfig(tf){const predefined={"1h":{apiTf:"1h",aggregate:1,label:"1H"},"4h":{apiTf:"4h",aggregate:1,label:"4H"},"12h":{apiTf:"12h",aggregate:1,label:"12H"},"1d":{apiTf:"1d",aggregate:1,label:"1D"},"2d":{apiTf:"1d",aggregate:2,label:"2D"},"3d":{apiTf:"3d",aggregate:1,label:"3D"},"1w":{apiTf:"1w",aggregate:1,label:"W"},"2w":{apiTf:"1w",aggregate:2,label:"2W"},"1M":{apiTf:"1M",aggregate:1,label:"M"}};if(predefined[tf])return predefined[tf];const match=tf.match(/^(\d+)([mhdWMY])$/);if(!match)return{apiTf:"1h",aggregate:1,label:"1H"};const num=parseInt(match[1]);const unit=match[2];let apiTf="1h",aggregate=1;if(unit==='m'){if([1,3,5,15,30].includes(num)){apiTf=num+"m";aggregate=1}else if(num%30===0){apiTf="30m";aggregate=num/30}else if(num%15===0){apiTf="15m";aggregate=num/15}else if(num%5===0){apiTf="5m";aggregate=num/5}else{apiTf="1m";aggregate=num}}else if(unit==='h'){if([1,2,4,6,8,12].includes(num)){apiTf=num+"h";aggregate=1}else{apiTf="1h";aggregate=num}}else if(unit==='d'){if([1,3].includes(num)){apiTf=num+"d";aggregate=1}else{apiTf="1d";aggregate=num}}else if(unit==='W'){apiTf="1w";aggregate=num}else if(unit==='M'){apiTf="1M";aggregate=num}else if(unit==='Y'){apiTf="1M";aggregate=num*12}return{apiTf,aggregate,label:num+(unit==='m'?'m':unit.toUpperCase())}}function getHistoryTargetLimit(tf=currentTf){const c={"1h":5000,"4h":5000,"12h":4000,"1d":3000,"2d":3000,"3d":2200,"1w":1200,"2w":1200,"1M":1000};if(c[tf])return c[tf];if(tf.endsWith('m'))return 5000;if(tf.endsWith('h'))return 4000;if(tf.endsWith('d'))return 3000;return 1500}function sleep(ms){return new Promise(r=>setTimeout(r,ms))}async function fetchHistoricalKlines(){const cfg=getTimeframeConfig(currentTf),target=getHistoryTargetLimit(currentTf);let endTime=Date.now(),all=[];for(let i=0;i<Math.ceil(target/1000)+2&&all.length<target;i++){const limit=Math.min(1000,target-all.length);const url=`${API}/api/v3/klines?symbol=${currentSymbol}&interval=${cfg.apiTf}&limit=${limit}&endTime=${endTime}`;const res=await fetch(url);if(!res.ok)throw new Error("Binance HTTP "+res.status);const part=await res.json();if(!Array.isArray(part)||!part.length)break;all=part.concat(all);endTime=part[0][0]-1;if(part.length<limit)break;await sleep(80)}return all.slice(-target).map(toChartCandle)}function toChartCandle(k){return{time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}}function aggregateCandles(src,g){if(g<=1)return src.slice();let r=[];for(let i=0;i<src.length;i+=g){const a=src.slice(i,i+g);if(a.length)r.push({time:a[0].time,open:a[0].open,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:a[a.length-1].close,volume:a.reduce((s,x)=>s+x.volume,0)})}return r}function refreshCandlesFromRaw(){candles=aggregateCandles(rawCandles,getTimeframeConfig(currentTf).aggregate)}function ema(data,n){let r=[],k=2/(n+1),p=null;data.forEach((c,i)=>{if(i<n-1)return;if(p===null){p=data.slice(i-n+1,i+1).reduce((s,x)=>s+x.close,0)/n}else p=c.close*k+p*(1-k);r.push({time:c.time,value:p})});return r}function wma(data,n){let r=[],ws=n*(n+1)/2;for(let i=n-1;i<data.length;i++){let s=0;for(let j=0;j<n;j++)s+=data[i-j].close*(n-j);r.push({time:data[i].time,value:s/ws})}return r}function rsi(data,n=14){let r=[];if(data.length<=n+1)return r;let g=0,l=0;for(let i=1;i<=n;i++){const d=data[i].close-data[i-1].close;if(d>=0)g+=d;else l-=d}let ag=g/n,al=l/n;for(let i=n+1;i<data.length;i++){const d=data[i].close-data[i-1].close,gain=d>0?d:0,loss=d<0?-d:0;ag=(ag*(n-1)+gain)/n;al=(al*(n-1)+loss)/n;const rs=al===0?100:ag/al;r.push({time:data[i].time,value:100-100/(1+rs)})}return r}function jma(data,length=50,power=2,phase=0){let r=[],phaseRatio=phase<-100?.5:phase>100?2.5:phase/100+1.5,beta=.45*(length-1)/(.45*(length-1)+2),alpha=Math.pow(beta,power),e0=0,e1=0,e2=0,prevJma=0;data.forEach(c=>{const src=c.close;e0=(1-alpha)*src+alpha*e0;e1=(src-e0)*(1-beta)+beta*e1;e2=(e0+phaseRatio*e1-prevJma)*Math.pow(1-alpha,2)+Math.pow(alpha,2)*e2;prevJma=e2+prevJma;r.push({time:c.time,value:prevJma})});return r}

// FIX: Bọc Try/Catch và Check Null để code không bao giờ sập màn hình đen
function getVwapColor(a=vwapAnchor){return a==="W"?"#2962ff":"#ffffff"}
function updateVwapColor(){try{const color=getVwapColor();if(vwapSeries)vwapSeries.applyOptions({color});const vi=document.querySelector('.vwap');if(vi)vi.style.background=color;document.querySelectorAll('.vwap-text').forEach(e=>e.style.color=color)}catch(e){}}

function getVwapBucket(time,anchor){const d=dateInUtcPlus7(time);if(anchor==="W"){const y=d.getUTCFullYear(),m=d.getUTCMonth(),day=d.getUTCDate(),dow=d.getUTCDay(),days=(dow+6)%7;const monday=new Date(Date.UTC(y,m,day-days,0,0,0));return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth()+1)}-${pad2(monday.getUTCDate())}`}if(anchor==="M")return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}`;return `${d.getUTCFullYear()}`}function anchoredVwap(data,anchor="W"){let r=[],bucket=null,pv=0,vol=0;data.forEach(c=>{const b=getVwapBucket(c.time,anchor);if(b!==bucket){bucket=b;pv=0;vol=0}const tp=(c.high+c.low+c.close)/3;pv+=tp*c.volume;vol+=c.volume;if(vol>0)r.push({time:c.time,value:pv/vol})});return r}
function smaVol(data, n) {let r=[];let sum=0;for(let i=0;i<data.length;i++){sum+=data[i].value;if(i>=n)sum-=data[i-n].value;if(i>=n-1)r.push({time:data[i].time,value:sum/n})}return r;}
function lastValue(d){return d&&d.length?d[d.length-1].value:null}function setValueText(id,v,formatter=fmt){const el=$(id);if(!el)return;el.textContent=v==null||Number.isNaN(v)?"--":formatter.format(v)}
function drawCharts(){updateVwapColor();candleSeries.setData(candles.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));const volumeData=candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?"rgba(255,255,255,.32)":"rgba(184,190,201,.28)"}));const emaPriceData=ema(candles,9),wmaPriceData=wma(candles,45),emaDynData=ema(candles,emaDynLen),vwapData=anchoredVwap(candles,vwapAnchor),baselineFastData=jma(candles,blSettings.fast.length,blSettings.fast.power,blSettings.fast.phase),baselineSlowData=jma(candles,blSettings.slow.length,blSettings.slow.power,blSettings.slow.phase);
const volMaData = smaVol(volumeData, 20);volumeSeries.setData(indicatorState.volume?volumeData:[]);volMaSeries.setData(indicatorState.volMa?volMaData:[]);
emaPriceSeries.setData(indicatorState.emaPrice?emaPriceData:[]);wmaPriceSeries.setData(indicatorState.wmaPrice?wmaPriceData:[]);emaDynSeries.setData(indicatorState.emaDyn?emaDynData:[]);vwapSeries.setData(indicatorState.vwap?vwapData:[]);baselineFastSeries.setData(indicatorState.baselineFast?baselineFastData:[]);baselineSlowSeries.setData(indicatorState.baselineSlow?baselineSlowData:[]);const rsiData=rsi(candles,14);rsiSeries.setData(indicatorState.rsi?rsiData:[]);const rsiAsClose=rsiData.map(x=>({time:x.time,close:x.value}));const rsiEmaData=ema(rsiAsClose,9),rsiWmaData=wma(rsiAsClose,45);rsiEmaSeries.setData(indicatorState.rsiEma?rsiEmaData:[]);rsiWmaSeries.setData(indicatorState.rsiWma?rsiWmaData:[]);const showRsi=indicatorState.rsi||indicatorState.rsiEma||indicatorState.rsiWma,bt=candles.map(c=>c.time);rsi70.setData(showRsi?bt.map(t=>({time:t,value:70})):[]);rsi50.setData(showRsi?bt.map(t=>({time:t,value:50})):[]);rsi30.setData(showRsi?bt.map(t=>({time:t,value:30})):[]);
cache={emaPriceData,wmaPriceData,emaDynData,volumeData,volMaData,vwapData,baselineFastData,baselineSlowData,rsiData,rsiEmaData,rsiWmaData};updateIndicatorValues(cache);updateFloatingLegends()}
function updateIndicatorValues(d){setValueText("vEmaPrice",indicatorState.emaPrice?lastValue(d.emaPriceData):null);setValueText("vWmaPrice",indicatorState.wmaPrice?lastValue(d.wmaPriceData):null);setValueText("vVolume",indicatorState.volume&&d.volumeData.length?d.volumeData[d.volumeData.length-1].value:null,fmtVol);setValueText("vVwap",indicatorState.vwap?lastValue(d.vwapData):null);setIfText("vVwapAnchor",vwapAnchor);setValueText("vBaselineFast",indicatorState.baselineFast?lastValue(d.baselineFastData):null);setValueText("vBaselineSlow",indicatorState.baselineSlow?lastValue(d.baselineSlowData):null);setValueText("vRsi",indicatorState.rsi?lastValue(d.rsiData):null);setValueText("vRsiEma",indicatorState.rsiEma?lastValue(d.rsiEmaData):null);setValueText("vRsiWma",indicatorState.rsiWma?lastValue(d.rsiWmaData):null)}
function closeSocket(ws){if(!ws)return;ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;try{ws.close()}catch(e){}}async function backgroundResyncKlines(){if(document.hidden)return;try{const s=wsSession;const data=await fetchHistoricalKlines();if(s!==wsSession)return;rawCandles=data;refreshCandlesFromRaw();drawCharts();updateLatestPrice()}catch(e){console.warn(e)}}

async function loadKlines(){const s=++wsSession;closeSocket(klineWs);closeSocket(tickerWs);try{setStatus(false,`Đang tải dữ liệu lịch sử ${getHistoryTargetLimit(currentTf)} nến...`);rawCandles=await fetchHistoricalKlines();if(s!==wsSession)return;refreshCandlesFromRaw();drawCharts();updateLatestPrice();updateTitle();
setDefaultBacktestRangeIfEmpty();startKlineWS(s);startTickerWS(s);loadTicker24h()}catch(e){console.error(e);if(s!==wsSession)return;setStatus(false,"Không tải được Binance API");$("priceChart").innerHTML='<div class="error">Không hiển thị được biểu đồ. Hãy kiểm tra internet/Binance hoặc chạy bằng local server.</div>'}}async function loadTicker24h(){try{const t=await (await fetch(`${API}/api/v3/ticker/24hr?symbol=${currentSymbol}`)).json();const p=+t.lastPrice,pct=+t.priceChangePercent;$("mainPrice").textContent="$"+fmt.format(p);$("mainChange").textContent=pct.toFixed(2)+"%";$("mainChange").className="change "+(pct>=0?"green":"red")}catch(e){}}function startKlineWS(s=wsSession){closeSocket(klineWs);const cfg=getTimeframeConfig(currentTf),stream=`${currentSymbol.toLowerCase()}@kline_${cfg.apiTf}`;klineWs=new WebSocket(`${WS_BASE}/${stream}`);klineWs.onopen=()=>{if(s===wsSession)setStatus(true,`Live ${cfg.label}`)};klineWs.onclose=()=>{if(s!==wsSession)return;setStatus(false,"Đang kết nối lại...");setTimeout(()=>{if(s===wsSession)startKlineWS(s)},1500)};klineWs.onerror=()=>{if(s===wsSession){setStatus(false,"Lỗi WebSocket");try{klineWs.close()}catch(e){}}};klineWs.onmessage=e=>{if(s!==wsSession)return;const k=JSON.parse(e.data).k,c={time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v},last=rawCandles[rawCandles.length-1];if(last&&last.time===c.time)rawCandles[rawCandles.length-1]=c;else{rawCandles.push(c);if(rawCandles.length>getHistoryTargetLimit(currentTf)+100)rawCandles.shift()}refreshCandlesFromRaw();drawCharts();updateLatestPrice();document.title=`${fmt.format(c.close)} | ${$("symbolTitle").textContent}`;updateFloatingLegends()}}function startTickerWS(s=wsSession){closeSocket(tickerWs);tickerWs=new WebSocket(`${WS_BASE}/${currentSymbol.toLowerCase()}@miniTicker`);tickerWs.onclose=()=>{if(s===wsSession)setTimeout(()=>{if(s===wsSession)startTickerWS(s)},1500)};tickerWs.onerror=()=>{try{tickerWs.close()}catch(e){}};tickerWs.onmessage=e=>{if(s!==wsSession)return;const t=JSON.parse(e.data),price=+t.c,open=+t.o,pct=open?((price-open)/open)*100:0;$("mainPrice").textContent="$"+fmt.format(price);$("mainChange").textContent=pct.toFixed(2)+"%";$("mainChange").className="change "+(pct>=0?"green":"red")}}
function updateLatestPrice(){const l=candles[candles.length-1];if(l)$("mainPrice").textContent="$"+fmt.format(l.close);updateFloatingLegends()}function updateTitle(){$("symbolTitle").textContent=currentSymbol.replace("USDT","/USD");document.title=`${$("symbolTitle").textContent} | XTB-Springtea`}function setStatus(on,text){$("wsDot").classList.toggle("online",on);$("wsStatus").textContent=text}

function makeBacktestMarkers(trades,upto=null){const list=upto==null?trades:trades.slice(0,upto);const markers=[];list.forEach(t=>{markers.push({time:t.entryTime,position:t.side==="long"?"belowBar":"aboveBar",color:t.side==="long"?"#00c853":"#ff3b30",shape:t.side==="long"?"arrowUp":"arrowDown",text:`${t.n} ${t.side==="long"?"BUY":"SELL"}`});markers.push({time:t.exitTime,position:t.side==="long"?"aboveBar":"belowBar",color:t.pnl>=0?"#ffffff":"#b8bec9",shape:"circle",text:`${t.reason} ${fmt.format(t.pnl)}`})});return markers}function drawTradeLines(t){if(!t){btEntrySeries.setData([]);btSlSeries.setData([]);btTpSeries.setData([]);return}const sl=t.side==="long"?t.entry*(1-t.slPct):t.entry*(1+t.slPct);const span=[{time:t.entryTime,value:t.entry},{time:t.exitTime,value:t.entry}];btEntrySeries.setData(span);btSlSeries.setData([{time:t.entryTime,value:sl},{time:t.exitTime,value:sl}]);if(String(t.reason).includes("FORM")){btTpSeries.setData([{time:t.entryTime,value:t.exit},{time:t.exitTime,value:t.exit}])}else{btTpSeries.setData([])}}function showBacktestOnChart(trades,focusIndex=null){candleSeries.setMarkers(makeBacktestMarkers(trades));if(focusIndex!=null&&trades[focusIndex]){drawTradeLines(trades[focusIndex]);priceChart.timeScale().setVisibleRange({from:trades[focusIndex].entryTime,to:trades[focusIndex].exitTime})}else{drawTradeLines(trades[trades.length-1]||null)}}function clearBacktestOnChart(){backtestTrades=[];backtestReplayIndex=0;if(backtestReplayTimer){clearInterval(backtestReplayTimer);backtestReplayTimer=null}candleSeries.setMarkers([]);drawTradeLines(null);$("btReplayStatus").textContent="Đã xóa lệnh trên chart"}function replayBacktest(){if(!backtestTrades.length){alert("Hãy chạy backtest trước.");return}if(backtestReplayTimer){clearInterval(backtestReplayTimer);backtestReplayTimer=null;$("btReplay").textContent="Replay trên chart";return}backtestReplayIndex=0;drawTradeLines(null);candleSeries.setMarkers([]);$("btReplay").textContent="Tạm dừng replay";backtestReplayTimer=setInterval(()=>{backtestReplayIndex++;candleSeries.setMarkers(makeBacktestMarkers(backtestTrades,backtestReplayIndex));const t=backtestTrades[backtestReplayIndex-1];drawTradeLines(t);if(t)priceChart.timeScale().scrollToPosition(5,false);$("btReplayStatus").textContent=`Đang replay: ${Math.min(backtestReplayIndex,backtestTrades.length)}/${backtestTrades.length}`;if(backtestReplayIndex>=backtestTrades.length){clearInterval(backtestReplayTimer);backtestReplayTimer=null;$("btReplay").textContent="Replay trên chart";$("btReplayStatus").textContent="Replay hoàn tất"}},450)}function focusBacktestTrade(i){const t=backtestTrades[i];if(!t)return;showBacktestOnChart(backtestTrades,i);document.querySelectorAll("#btTrades tr").forEach(r=>r.classList.remove("selected"));const row=document.querySelector(`#btTrades tr[data-trade-index="${i}"]`);if(row)row.classList.add("selected");$("btReplayStatus").textContent=`Đang xem lệnh #${t.n}: ${t.side.toUpperCase()} ${formatChartTime(t.entryTime)}`}function formatInputDateFromTime(time){const d=dateInUtcPlus7(time);return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`}function inputDateToTimeStart(v){if(!v)return null;const [y,m,d]=v.split("-").map(Number);return Math.floor(Date.UTC(y,m-1,d,0,0,0)/1000)-TIMEZONE_OFFSET_SECONDS}function inputDateToTimeEnd(v){if(!v)return null;const [y,m,d]=v.split("-").map(Number);return Math.floor(Date.UTC(y,m-1,d+1,0,0,0)/1000)-TIMEZONE_OFFSET_SECONDS-1}function getBacktestRange(){return{from:inputDateToTimeStart($("btFrom").value),to:inputDateToTimeEnd($("btTo").value)}}function setDefaultBacktestRangeIfEmpty(){if(!candles.length)return;if(!$("btFrom")||!$("btTo"))return;if(!$("btFrom").value)$("btFrom").value=formatInputDateFromTime(candles[0].time);if(!$("btTo").value)$("btTo").value=formatInputDateFromTime(candles[candles.length-1].time)}function setBacktestPreset(mode){if(!candles.length)return;const last=candles[candles.length-1].time;let first=candles[0].time;if(mode!=="ALL"){const days={"3M":90,"6M":180,"1Y":365,"2Y":730}[mode]||365;first=last-days*86400}$("btFrom").value=formatInputDateFromTime(first);$("btTo").value=formatInputDateFromTime(last);$("btReplayStatus").textContent=`Khoảng backtest: ${$("btFrom").value} → ${$("btTo").value}`}function getByTime(arr){const m=new Map();arr.forEach(x=>m.set(x.time,x.value));return m}function runBacktest(){if(candles.length<80){alert("Chưa đủ dữ liệu để backtest.");return}const strategy=$("btStrategy").value,dir=$("btDirection").value,capital0=+$("btCapital").value||1000,riskPct=(+$("btRisk").value||2)/100,slPct=(+$("btSL").value||1)/100,feePct=(+$("btFee").value||0)/100;const emaMap=getByTime(ema(candles,9)),wmaMap=getByTime(wma(candles,45)),r=rsi(candles,14),rMap=getByTime(r),rE=ema(r.map(x=>({time:x.time,close:x.value})),9),rW=wma(r.map(x=>({time:x.time,close:x.value})),45),rEMap=getByTime(rE),rWMap=getByTime(rW);let equity=capital0,trades=[],pos=null,pendingReentry=null;function rsiForm(i){const c=candles[i],p=candles[i-1];if(!p||!c)return null;const a1=rEMap.get(c.time),b1=rWMap.get(c.time),a0=rEMap.get(p.time),b0=rWMap.get(p.time);if([a1,b1,a0,b0].some(v=>v==null))return null;if(a0<=b0&&a1>b1)return"long";if(a0>=b0&&a1<b1)return"short";return null}function rsiNature(i,side){const c=candles[i];if(!c)return false;const rv=rMap.get(c.time),re=rEMap.get(c.time);if(rv==null||re==null)return false;return side==="short"?rv<re:rv>re}function signal(i){const c=candles[i],p=candles[i-1];if(!p||!c)return null;let a1,b1,a0,b0;if(strategy==="rsiCross")return rsiForm(i);else if(strategy==="priceEma"){a1=c.close;b1=emaMap.get(c.time);a0=p.close;b0=emaMap.get(p.time)}else{a1=c.close;b1=wmaMap.get(c.time);a0=p.close;b0=wmaMap.get(p.time)}if([a1,b1,a0,b0].some(v=>v==null))return null;if(a0<=b0&&a1>b1)return"long";if(a0>=b0&&a1<b1)return"short";return null}function openPosition(side,next,slPrice,reentry=false){if((side==="long"&&dir==="short")||(side==="short"&&dir==="long"))return null;const entry=next.open;let sl=slPrice;if(sl==null)sl=side==="long"?entry*(1-slPct):entry*(1+slPct);const riskMove=side==="long"?(entry-sl)/entry:(sl-entry)/entry;if(riskMove<=0)return null;const riskMoney=equity*riskPct,size=riskMoney/riskMove;return{n:trades.length+1,side,entryTime:next.time,entry,sl,size,equityBefore:equity,slPct:riskMove,tpPct:0,reentry}}const range=getBacktestRange();for(let i=60;i<candles.length-1;i++){const next=candles[i+1];if(range.from&&next.time<range.from)continue;if(range.to&&candles[i].time>range.to)break;const form=rsiForm(i);if(pos){let exit=null,reason="";if(pos.side==="long"){if(next.low<=pos.sl){exit=pos.sl;reason="SL";pendingReentry={side:"long",sl:next.low,fromIndex:i+1}}else if(form==="short"){exit=next.open;reason="TP FORM SHORT";pendingReentry=null}}else{if(next.high>=pos.sl){exit=pos.sl;reason="SL";pendingReentry={side:"short",sl:next.high,fromIndex:i+1}}else if(form==="long"){exit=next.open;reason="TP FORM LONG";pendingReentry=null}}if(exit){const gross=pos.side==="long"?(exit-pos.entry)/pos.entry:(pos.entry-exit)/pos.entry;const pnl=pos.size*(gross-2*feePct);equity+=pnl;trades.push({...pos,exitTime:next.time,exit,reason,pnl,equity});pos=null}}if(!pos){if(pendingReentry&&i>=pendingReentry.fromIndex&&rsiNature(i,pendingReentry.side)){const rp=openPosition(pendingReentry.side,next,pendingReentry.sl,true);if(rp){pos=rp;pendingReentry=null;continue}}const sig=signal(i);if(!sig||(sig==="long"&&dir==="short")||(sig==="short"&&dir==="long"))continue;if(range.to&&next.time>range.to)continue;pos=openPosition(sig,next,null,false)}}backtestTrades=trades;renderBacktest(trades,capital0,equity);showBacktestOnChart(backtestTrades);const rangeText=`${$("btFrom").value||"ALL"} → ${$("btTo").value||"ALL"}`;$("btReplayStatus").textContent=`Đã vẽ ${trades.length} lệnh lên chart trong khoảng ${rangeText}. Sau SL sẽ vào lại nếu RSI vẫn giữ tính chất.`}function renderBacktest(trades,capital0,equity){const wins=trades.filter(t=>t.pnl>0),loss=trades.filter(t=>t.pnl<=0),wr=trades.length?wins.length/trades.length*100:0,net=equity-capital0,ret=capital0?net/capital0*100:0;let peak=capital0,dd=0;trades.forEach(t=>{peak=Math.max(peak,t.equity);dd=Math.max(dd,(peak-t.equity)/peak*100)});$("btSummary").innerHTML=`<div class="metric">Tổng lệnh<b>${trades.length}</b></div><div class="metric">Winrate<b>${wr.toFixed(1)}%</b></div><div class="metric">Net PnL<b class="${net>=0?'pnl-win':'pnl-loss'}">$${fmt.format(net)} / ${ret.toFixed(1)}%</b></div><div class="metric">Lệnh thắng<b>${wins.length}</b></div><div class="metric">Lệnh thua<b>${loss.length}</b></div><div class="metric">Max DD<b>${dd.toFixed(1)}%</b></div>`;$("btTrades").innerHTML=trades.slice().reverse().map(t=>`<tr data-trade-index="${t.n-1}" onclick="focusBacktestTrade(${t.n-1})"><td>${t.n}</td><td>${formatChartTime(t.entryTime)}</td><td>${t.side.toUpperCase()}</td><td>${fmt.format(t.entry)}</td><td>${fmt.format(t.exit)}</td><td>${t.reason}</td><td class="${t.pnl>=0?'pnl-win':'pnl-loss'}">${fmt.format(t.pnl)}</td><td>${fmt.format(t.equity)}</td></tr>`).join("")}

window.resizeCharts = function() {
    try {
        if ($("priceChart") && priceChart) priceChart.applyOptions({ width: $("priceChart").clientWidth, height: $("priceChart").clientHeight });
        if ($("rsiChart") && rsiChart) rsiChart.applyOptions({ width: $("rsiChart").clientWidth, height: $("rsiChart").clientHeight });
        if (typeof subPanesLayout !== 'undefined') {
            subPanesLayout.forEach(p => {
                const el = document.getElementById(p.domId);
                if (el && p.chart) p.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            });
        }
    } catch(e) {}
};
window.addEventListener("resize", window.resizeCharts);

/* XTB-Springtea drawing tools */
(function initXtbDrawingTools(){
  const host=$("priceChart");if(!host||!priceChart||!candleSeries)return;const DRAW_VERSION="v2";const DEFAULT_COLOR="#f0b90b";const GUIDE_COLOR="#787b86";const FIB_COLOR="#2962ff";const RULER_COLOR="#00c853";const NOTE_COLOR="#ff9800";const state={tool:null,visible:true,drawings:[],draft:null,dragStart:null,canvas:null,ctx:null,toolbar:null,hint:null};const hints={cursor:"Chế độ xem chart. Chọn công cụ vẽ để bắt đầu.",trend:"Kéo từ điểm đầu đến điểm cuối để vẽ trendline.",fibo:"Kéo từ đáy lên đỉnh hoặc từ đỉnh xuống đáy để đo Fibonacci retracement.",ruler:"Kéo từ điểm entry đến điểm target/SL để đo biên độ giá và %. ",hline:"Bấm vào chart để tạo đường ngang tại mức giá đó.",vline:"Bấm vào chart để tạo đường dọc theo thời gian cây nến.",arrow:"Kéo để vẽ mũi tên chỉ vào vùng cần chú ý.",note:"Bấm vào chart rồi nhập nội dung ghi chú.",eraser:"Bấm gần hình vẽ để xóa riêng hình đó."};function storageKey(){return `xtb_springtea_drawings_${DRAW_VERSION}_${currentSymbol||"BTCUSDT"}`}function safeJsonParse(v,fallback){try{return JSON.parse(v)||fallback}catch(e){return fallback}}function loadDrawings(){state.drawings=safeJsonParse(localStorage.getItem(storageKey()),[]).filter(Boolean);requestDraw()}function saveDrawings(){localStorage.setItem(storageKey(),JSON.stringify(state.drawings))}function cssSize(){const rect=host.getBoundingClientRect();return{w:Math.max(1,rect.width),h:Math.max(1,rect.height)}}function resizeDrawingCanvas(){if(!state.canvas)return;const s=cssSize(),dpr=window.devicePixelRatio||1;state.canvas.style.width=s.w+"px";state.canvas.style.height=s.h+"px";state.canvas.width=Math.floor(s.w*dpr);state.canvas.height=Math.floor(s.h*dpr);state.ctx.setTransform(dpr,0,0,dpr,0,0);requestDraw()}function createUi(){const canvas=document.createElement("canvas");canvas.className="draw-canvas";host.appendChild(canvas);state.canvas=canvas;state.ctx=canvas.getContext("2d");const bar=document.createElement("div");bar.className="drawing-toolbar";bar.innerHTML=`<button class="draw-tool active" data-tool="cursor" title="Thoát công cụ vẽ">☰ Chuột</button><button class="draw-tool" data-tool="trend" title="Đường xu hướng">╱ Trend</button><button class="draw-tool" data-tool="fibo" title="Fibonacci retracement">Fibo</button><button class="draw-tool" data-tool="ruler" title="Đo phần trăm biến động giá">↔ Đo %</button><button class="draw-tool" data-tool="hline" title="Đường ngang theo giá">H</button><button class="draw-tool" data-tool="vline" title="Đường dọc theo thời gian">V</button><button class="draw-tool" data-tool="arrow" title="Mũi tên">↗</button><button class="draw-tool" data-tool="note" title="Ghi chú trên chart">📝 Note</button><button class="draw-tool" data-tool="eraser" title="Xóa riêng từng hình vẽ">⌫</button><button class="draw-tool" data-action="undo" title="Hoàn tác nét vừa vẽ">↶ Undo</button><button class="draw-tool" data-action="toggle" title="Ẩn/hiện toàn bộ hình vẽ">👁</button><button class="draw-tool danger" data-action="clear" title="Xóa toàn bộ hình vẽ">🧹 Clear</button>`;host.appendChild(bar);state.toolbar=bar;const hint=document.createElement("div");hint.className="drawing-hint";host.appendChild(hint);state.hint=hint;bar.addEventListener("click",onToolbarClick);canvas.addEventListener("mousedown",onPointerDown);canvas.addEventListener("mousemove",onPointerMove);canvas.addEventListener("mouseup",onPointerUp);canvas.addEventListener("mouseleave",()=>{if(state.draft){state.draft=null;state.dragStart=null;requestDraw()}});canvas.addEventListener("contextmenu",e=>{e.preventDefault();state.draft=null;state.dragStart=null;setTool("cursor")});document.addEventListener("keydown",e=>{if(e.key==="Escape"){state.draft=null;state.dragStart=null;setTool("cursor")}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){undoLast()}});window.addEventListener("resize",resizeDrawingCanvas);host.addEventListener("wheel",()=>setTimeout(requestDraw,0),{passive:true});host.addEventListener("mousemove",()=>requestDraw(),{passive:true});try{priceChart.timeScale().subscribeVisibleLogicalRangeChange(()=>requestDraw());priceChart.subscribeCrosshairMove(()=>requestDraw())}catch(e){}resizeDrawingCanvas()}function onToolbarClick(e){const btn=e.target.closest("button");if(!btn)return;const tool=btn.dataset.tool,action=btn.dataset.action;if(tool){setTool(tool);return}if(action==="undo"){undoLast();return}if(action==="toggle"){state.visible=!state.visible;btn.classList.toggle("active",state.visible);requestDraw();return}if(action==="clear"){if(state.drawings.length&&confirm("Xóa toàn bộ hình vẽ trên chart hiện tại?")){state.drawings=[];saveDrawings();requestDraw()}}}function setTool(tool){state.tool=tool==="cursor"?null:tool;state.draft=null;state.dragStart=null;host.classList.toggle("drawing-mode",!!state.tool&&state.tool!=="eraser");host.classList.toggle("eraser-mode",state.tool==="eraser");state.canvas.style.pointerEvents=state.tool?"auto":"none";state.toolbar.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",(b.dataset.tool==="cursor"&&!state.tool)||b.dataset.tool===state.tool));if(state.hint){const key=state.tool||"cursor";state.hint.textContent=hints[key]||"";state.hint.classList.toggle("active",!!state.tool)}requestDraw()}function undoLast(){state.drawings.pop();saveDrawings();requestDraw()}function pointFromEvent(e){const rect=state.canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;let time=null,price=null;try{time=priceChart.timeScale().coordinateToTime(x);price=candleSeries.coordinateToPrice(y)}catch(err){}if(time&&typeof time==="object"&&"timestamp"in time)time=time.timestamp;if(time==null||price==null||Number.isNaN(price))return null;return{time:Number(time),price:Number(price),x,y}}function onPointerDown(e){if(!state.tool)return;const p=pointFromEvent(e);if(!p)return;e.preventDefault();if(state.tool==="eraser"){removeNearest(p.x,p.y);return}if(state.tool==="hline"){commit({type:"hline",price:p.price,color:GUIDE_COLOR});return}if(state.tool==="vline"){commit({type:"vline",time:p.time,color:GUIDE_COLOR});return}if(state.tool==="note"){const text=prompt("Nhập ghi chú trên chart:");if(text&&text.trim())commit({type:"note",point:{time:p.time,price:p.price},text:text.trim(),color:NOTE_COLOR});return}state.dragStart={time:p.time,price:p.price,x:p.x,y:p.y};state.draft={type:state.tool,points:[{time:p.time,price:p.price},{time:p.time,price:p.price}],color:colorForTool(state.tool)};requestDraw()}function onPointerMove(e){if(!state.tool||!state.dragStart||!state.draft)return;const p=pointFromEvent(e);if(!p)return;state.draft.points[1]={time:p.time,price:p.price};requestDraw()}function onPointerUp(e){if(!state.tool||!state.dragStart||!state.draft)return;const p=pointFromEvent(e);if(!p)return;const dx=p.x-state.dragStart.x,dy=p.y-state.dragStart.y;if(Math.hypot(dx,dy)>6){state.draft.points[1]={time:p.time,price:p.price};commit(state.draft)}state.draft=null;state.dragStart=null;requestDraw()}function colorForTool(tool){if(tool==="fibo")return FIB_COLOR;if(tool==="ruler")return RULER_COLOR;if(tool==="note")return NOTE_COLOR;return DEFAULT_COLOR}function commit(d){d.id=`draw_${Date.now()}_${Math.random().toString(16).slice(2)}`;d.createdAt=Date.now();state.drawings.push(d);saveDrawings();requestDraw()}let drawPending=false;function requestDraw(){if(drawPending)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;drawAll()})}function xy(pt){if(!pt)return null;let x=null,y=null;try{x=priceChart.timeScale().timeToCoordinate(pt.time);y=candleSeries.priceToCoordinate(pt.price)}catch(e){}if(x==null||y==null||Number.isNaN(x)||Number.isNaN(y))return null;return{x,y}}function drawAll(){const ctx=state.ctx;if(!ctx)return;const s=cssSize();ctx.clearRect(0,0,s.w,s.h);if(!state.visible)return;ctx.save();ctx.lineCap="round";ctx.lineJoin="round";state.drawings.forEach(d=>drawItem(ctx,d,s,false));if(state.draft)drawItem(ctx,state.draft,s,true);ctx.restore()}function drawItem(ctx,d,s,isDraft){ctx.save();ctx.globalAlpha=isDraft?.72:1;ctx.strokeStyle=d.color||DEFAULT_COLOR;ctx.fillStyle=d.color||DEFAULT_COLOR;ctx.lineWidth=isDraft?1.5:1.8;if(d.type==="trend")drawSegment(ctx,d.points);else if(d.type==="arrow")drawArrow(ctx,d.points);else if(d.type==="ruler")drawRuler(ctx,d.points);else if(d.type==="fibo")drawFibo(ctx,d.points,s);else if(d.type==="hline")drawHLine(ctx,d,s);else if(d.type==="vline")drawVLine(ctx,d,s);else if(d.type==="note")drawNote(ctx,d,s);ctx.restore()}function drawSegment(ctx,pts){const a=xy(pts[0]),b=xy(pts[1]);if(!a||!b)return;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();drawPoint(ctx,a);drawPoint(ctx,b)}function drawPoint(ctx,p){ctx.save();ctx.fillStyle="#0f131a";ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore()}function drawArrow(ctx,pts){const a=xy(pts[0]),b=xy(pts[1]);if(!a||!b)return;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();const ang=Math.atan2(b.y-a.y,b.x-a.x),len=12;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-len*Math.cos(ang-Math.PI/6),b.y-len*Math.sin(ang-Math.PI/6));ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-len*Math.cos(ang+Math.PI/6),b.y-len*Math.sin(ang+Math.PI/6));ctx.stroke()}function drawRuler(ctx,pts){const a=xy(pts[0]),b=xy(pts[1]);if(!a||!b)return;drawArrow(ctx,pts);const p1=pts[0].price,p2=pts[1].price,delta=p2-p1,pct=p1?delta/p1*100:0;drawTextBox(ctx,`${delta>=0?"+":""}${fmt.format(delta)} | ${pct>=0?"+":""}${pct.toFixed(2)}%`,(a.x+b.x)/2+8,(a.y+b.y)/2-10,RULER_COLOR)}function drawFibo(ctx,pts,s){const p1=pts[0],p2=pts[1],a=xy(p1),b=xy(p2);if(!a||!b)return;const x1=Math.min(a.x,b.x),x2=Math.max(a.x,b.x),levels=[0,.236,.382,.5,.618,.786,1];ctx.save();ctx.strokeStyle=FIB_COLOR;ctx.fillStyle=FIB_COLOR;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);levels.forEach(l=>{const price=p1.price+(p2.price-p1.price)*l;const y=candleSeries.priceToCoordinate(price);if(y==null)return;ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(Math.max(x2,x1+80),y);ctx.stroke();drawSmallLabel(ctx,`${(l*100).toFixed(l===0||l===1?0:1)}%  ${fmt.format(price)}`,Math.max(x2,x1+80)+6,y-7)});ctx.restore()}function drawHLine(ctx,d,s){const y=candleSeries.priceToCoordinate(d.price);if(y==null)return;ctx.save();ctx.strokeStyle=d.color||GUIDE_COLOR;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(s.w,y);ctx.stroke();ctx.setLineDash([]);drawSmallLabel(ctx,fmt.format(d.price),s.w-88,y-8);ctx.restore()}function drawVLine(ctx,d,s){const x=priceChart.timeScale().timeToCoordinate(d.time);if(x==null)return;ctx.save();ctx.strokeStyle=d.color||GUIDE_COLOR;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,s.h);ctx.stroke();ctx.setLineDash([]);drawSmallLabel(ctx,formatChartTime(d.time),x+6,8);ctx.restore()}function drawNote(ctx,d,s){const p=xy(d.point);if(!p)return;const boxX=Math.min(p.x+16,s.w-220),boxY=Math.max(8,p.y-34);ctx.save();ctx.strokeStyle=d.color||NOTE_COLOR;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(boxX,boxY+17);ctx.stroke();drawTextBox(ctx,d.text||"Note",boxX,boxY,d.color||NOTE_COLOR);ctx.restore()}function drawSmallLabel(ctx,text,x,y){ctx.save();ctx.font="11px Arial";const pad=4,w=ctx.measureText(text).width+pad*2,h=17;ctx.fillStyle="rgba(15,19,26,.88)";ctx.strokeStyle="rgba(42,46,57,.95)";roundRect(ctx,x,y,w,h,4);ctx.fill();ctx.stroke();ctx.fillStyle="#d1d4dc";ctx.fillText(text,x+pad,y+12);ctx.restore()}function drawTextBox(ctx,text,x,y,color){ctx.save();ctx.font="12px Arial";const lines=String(text).split(/\n/).slice(0,4),pad=7,w=Math.min(240,Math.max(...lines.map(t=>ctx.measureText(t).width))+pad*2),h=lines.length*16+pad*2;ctx.fillStyle="rgba(15,19,26,.92)";ctx.strokeStyle=color||NOTE_COLOR;roundRect(ctx,x,y,w,h,7);ctx.fill();ctx.stroke();ctx.fillStyle="#fff";lines.forEach((t,i)=>ctx.fillText(t,x+pad,y+pad+12+i*16));ctx.restore()}function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath()}function distanceToSeg(px,py,a,b){const dx=b.x-a.x,dy=b.y-a.y;if(dx===0&&dy===0)return Math.hypot(px-a.x,py-a.y);let t=((px-a.x)*dx+(py-a.y)*dy)/(dx*dx+dy*dy);t=Math.max(0,Math.min(1,t));return Math.hypot(px-(a.x+t*dx),py-(a.y+t*dy))}function itemDistance(d,px,py){if(d.type==="trend"||d.type==="arrow"||d.type==="ruler"){const a=xy(d.points[0]),b=xy(d.points[1]);return a&&b?distanceToSeg(px,py,a,b):9999}if(d.type==="fibo"){const a=xy(d.points[0]),b=xy(d.points[1]);if(!a||!b)return 9999;const x1=Math.min(a.x,b.x),x2=Math.max(a.x,b.x);if(px<x1-20||px>x2+120)return 9999;let min=9999;[0,.236,.382,.5,.618,.786,1].forEach(l=>{const price=d.points[0].price+(d.points[1].price-d.points[0].price)*l,y=candleSeries.priceToCoordinate(price);if(y!=null)min=Math.min(min,Math.abs(py-y))});return min}if(d.type==="hline"){const y=candleSeries.priceToCoordinate(d.price);return y==null?9999:Math.abs(py-y)}if(d.type==="vline"){const x=priceChart.timeScale().timeToCoordinate(d.time);return x==null?9999:Math.abs(px-x)}if(d.type==="note"){const p=xy(d.point);return p?Math.hypot(px-p.x,py-p.y):9999}return 9999}function removeNearest(px,py){let best=-1,dist=14;state.drawings.forEach((d,i)=>{const dd=itemDistance(d,px,py);if(dd<dist){dist=dd;best=i}});if(best>=0){state.drawings.splice(best,1);saveDrawings();requestDraw()}}
  const originalDrawCharts=drawCharts;drawCharts=function(){originalDrawCharts();requestDraw()};
  const originalResizeCharts=window.resizeCharts;window.resizeCharts=function(){originalResizeCharts();resizeDrawingCanvas()};
  try{$("loadSymbol").addEventListener("click",()=>setTimeout(loadDrawings,0));document.querySelectorAll(".tf").forEach(b=>b.addEventListener("click",()=>setTimeout(requestDraw,100)));$("btShowAll").addEventListener("click",()=>setTimeout(requestDraw,0));$("btClearChart").addEventListener("click",()=>setTimeout(requestDraw,0))}catch(e){}createUi();loadDrawings();setTool("cursor");window.xtbDrawingTools={getAll:()=>state.drawings.slice(),clear:()=>{state.drawings=[];saveDrawings();requestDraw()},redraw:requestDraw};
})();

// ==========================================
// CÁC SỰ KIỆN GIAO DIỆN CHUNG
// ==========================================
$("loadSymbol").addEventListener("click",()=>{const v=$("symbolInput").value.trim().toUpperCase();if(!v)return;currentSymbol=v.endsWith("USDT")?v:v+"USDT";$("symbolInput").value=currentSymbol;loadKlines()});$("symbolInput").addEventListener("keydown",e=>{if(e.key==="Enter")$("loadSymbol").click()});document.querySelectorAll(".toggle").forEach(b=>b.addEventListener("click",()=>{const k=b.dataset.indicator;indicatorState[k]=!indicatorState[k];b.classList.toggle("active",indicatorState[k]);drawCharts()}));$("vwapAnchor").addEventListener("change",e=>{vwapAnchor=e.target.value;setIfText("vVwapAnchor",vwapAnchor);updateVwapColor();drawCharts()});$("toggleBacktest").addEventListener("click",()=>$("backtestPanel").classList.toggle("active"));if($("captureChart"))$("captureChart").addEventListener("click",captureChartScreenshot);if($("openBlSettings"))$("openBlSettings").addEventListener("click",()=>{$("blSettingsPanel").classList.add("active");syncBlSettingsUi()});if($("closeBlSettings"))$("closeBlSettings").addEventListener("click",()=>$("blSettingsPanel").classList.remove("active"));if($("applyBlSettings"))$("applyBlSettings").addEventListener("click",readBlSettingsFromUi);if($("resetBlSettings"))$("resetBlSettings").addEventListener("click",()=>{blSettings=normalizeBlSettings(BL_DEFAULTS);saveBlSettings();syncBlSettingsUi();drawCharts()});["blFastLength","blFastPhase","blFastPower","blSlowLength","blSlowPhase","blSlowPower"].forEach(id=>{const el=$(id);if(el)el.addEventListener("keydown",e=>{if(e.key==="Enter")readBlSettingsFromUi()})});syncBlSettingsUi();$("closeBacktest").addEventListener("click",()=>$("backtestPanel").classList.remove("active"));$("runBacktest").addEventListener("click",runBacktest);$("btShowAll").addEventListener("click",()=>{if(!backtestTrades.length){alert("Hãy chạy backtest trước.");return}showBacktestOnChart(backtestTrades);$("btReplayStatus").textContent=`Đã hiện ${backtestTrades.length} lệnh trên chart`;});$("btClearChart").addEventListener("click",clearBacktestOnChart);$("btReplay").addEventListener("click",replayBacktest);document.querySelectorAll(".bt-range-preset").forEach(b=>b.addEventListener("click",()=>setBacktestPreset(b.dataset.range)));setInterval(()=>{$("clock").textContent="UTC+7 "+formatChartTime(Math.floor(Date.now()/1000)).split(" ")[1]},1000);resyncTimer=setInterval(backgroundResyncKlines,5*60*1000);document.addEventListener("visibilitychange",()=>{if(!document.hidden){backgroundResyncKlines();if(!klineWs||klineWs.readyState===WebSocket.CLOSED)startKlineWS(wsSession);if(!tickerWs||tickerWs.readyState===WebSocket.CLOSED)startTickerWS(wsSession)}});updateVwapColor();loadKlines();

const autoFitBtn = document.getElementById('autoFitBtn');
if (autoFitBtn) {
    autoFitBtn.addEventListener('click', () => {
        try {
            if (typeof priceChart !== 'undefined') priceChart.priceScale('right').applyOptions({ autoScale: true });
            if (typeof rsiChart !== 'undefined') rsiChart.priceScale('right').applyOptions({ autoScale: true });
        } catch (error) {}
    });
}

// ==========================================
// MODULE: QUẢN LÝ ĐA MÀN HÌNH, MOBILE HEIGHT, AUTOCOMPLETE, VÀ TỶ LỆ CHIA
// ==========================================
let activePaneLayout = "main";
const subPanesLayout = [
    { id: 1, domId: 'rsiChartSub1', tf: '4h', labelId: 'sub1TfLabel', chart: null, series: null, seriesEma: null, seriesWma: null, data: null },
    { id: 2, domId: 'rsiChartSub2', tf: '12h', labelId: 'sub2TfLabel', chart: null, series: null, seriesEma: null, seriesWma: null, data: null },
    { id: 3, domId: 'rsiChartSub3', tf: '1d', labelId: 'sub3TfLabel', chart: null, series: null, seriesEma: null, seriesWma: null, data: null }
];

setTimeout(() => {
    if (!document.getElementById('floatingLegendCss')) {
        const style = document.createElement('style');
        style.id = 'floatingLegendCss';
        style.innerHTML = `
            .floating-legend { 
                position: absolute; z-index: 25; display: flex; flex-wrap: wrap; gap: 8px 12px; font-size: 12px; 
                pointer-events: none; background: transparent; text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                max-width: calc(100% - 65px); 
            }
            .floating-legend span { color: #d1d4dc; font-weight: 600; }
            .floating-legend b { font-family: monospace; font-size: 13px; margin-left: 3px; }
            .c-up { color: #00c853 !important; } .c-down { color: #ff3b30 !important; }
            
            #legPrice { top: 46px !important; left: 10px !important; } 
            #legRsiMain { top: 6px !important; left: 85px !important; } 
            [id^="legSub"] { top: 6px !important; left: 85px !important; }

            /* CHIA TỶ LỆ 50/50 CHO DESKTOP */
            @media (min-width: 901px) {
                #priceChart { position: relative !important; width: 100% !important; height: 50% !important; flex: 1 1 50% !important; }
                #rsiChart   { position: relative !important; width: 100% !important; height: 50% !important; flex: 1 1 50% !important; }
            }
            
            /* GIAO DIỆN MOBILE VÀ CHIA TỶ LỆ 60/40 */
            @media (max-width: 900px) {
                .topbar:not(.force-show) { display: none !important; }
                .topbar.force-show { display: flex !important; flex-wrap: wrap; }
                
                #btnToggleHeader { display: inline-flex !important; align-items: center; justify-content: center; background: #2962ff; color: white; border: none; border-radius: 4px; padding: 0 8px; font-weight: bold; font-size: 12px; margin-right: 5px; height: 26px; cursor: pointer; }
                
                #legPrice { top: 80px !important; left: 6px !important; }
                #legRsiMain, [id^="legSub"] { top: 6px !important; left: 60px !important; }
                
                .floating-legend { font-size: 11px !important; gap: 4px 8px !important; background: rgba(15,19,26,0.5) !important; padding: 2px 4px; border-radius: 4px;}
                .floating-legend b { font-size: 12px !important; }

                /* KÉO DÀI XUỐNG ĐÁY MÀN HÌNH VÀ TỶ LỆ 60/40 */
                .chart-layout { display: flex; flex-direction: column; height: calc(100vh - 50px) !important; }
                .left-col { height: 100% !important; flex: 1 1 100% !important; display: flex; flex-direction: column; }
                #priceChart { position: relative !important; width: 100% !important; height: 60% !important; flex: 1 1 60% !important; }
                #rsiChart   { position: relative !important; width: 100% !important; height: 40% !important; flex: 1 1 40% !important; }
            }

            #btnToggleHeader { display: none; }
            .chart-layout, .left-col, .right-col, .pane-container, .chart-flex-main, .chart-flex-sub, .chart-full { min-width: 0 !important; min-height: 0 !important; overflow: hidden !important; }
            [id^="rsiChartSub"] { position: relative !important; width: 100% !important; height: 100% !important; }
            .tv-lightweight-charts { width: 100% !important; height: 100% !important; }
            .drawing-toolbar { flex-wrap: nowrap !important; white-space: nowrap !important; overflow-x: auto !important; scrollbar-width: none !important; -ms-overflow-style: none !important; }
            .drawing-toolbar::-webkit-scrollbar { display: none !important; height: 0 !important; }
        `;
        document.head.appendChild(style);
    }

    const legendBar = document.querySelector('.legend');

    // NÚT CHỌN EMA ĐỘNG (34/89)
    if (legendBar && !document.querySelector('[data-indicator="emaDyn"]')) {
        const emaDynBox = document.createElement('div');
        emaDynBox.style.cssText = "display:inline-flex; align-items:center; background:transparent; margin-right:8px;";
        emaDynBox.innerHTML = `
            <button class="toggle active" data-indicator="emaDyn" style="margin-right:2px; padding: 2px 5px;"><i class="vol" style="background:#4caf50"></i>EMA</button>
            <select id="emaDynSelect" style="background:#1e222d; color:#d1d4dc; border:1px solid #2a2e39; border-radius:4px; padding:2px 4px; outline:none; cursor:pointer; font-size:12px; height:24px;">
                <option value="38" selected>38</option>
                <option value="89">89</option>
            </select>
        `;
        
        const wmaBtn = document.querySelector('[data-indicator="wmaPrice"]');
        if (wmaBtn) legendBar.insertBefore(emaDynBox, wmaBtn.nextSibling);
        else legendBar.appendChild(emaDynBox);
        
        const btnToggle = emaDynBox.querySelector('[data-indicator="emaDyn"]');
        if(btnToggle) btnToggle.addEventListener('click', () => {
            indicatorState.emaDyn = !indicatorState.emaDyn;
            btnToggle.classList.toggle('active', indicatorState.emaDyn);
            drawCharts();
        });
        
        const sel = document.getElementById('emaDynSelect');
        if(sel) sel.addEventListener('change', (e) => {
            emaDynLen = parseInt(e.target.value);
            drawCharts();
        });
    }

    if (legendBar && !document.querySelector('[data-indicator="volMa"]')) {
        const btn = document.createElement('button');
        btn.className = 'toggle active';
        btn.dataset.indicator = 'volMa';
        btn.innerHTML = '<i class="vol" style="background:#e0e0e0"></i>Vol MA20';
        const vwapBtn = document.querySelector('[data-indicator="vwap"]');
        if (vwapBtn) legendBar.insertBefore(btn, vwapBtn);
        else legendBar.appendChild(btn);
        
        btn.addEventListener('click', () => {
            indicatorState.volMa = !indicatorState.volMa;
            btn.classList.toggle('active', indicatorState.volMa);
            drawCharts();
        });
    }

    const toolbar = document.querySelector('.toolbar');
    if (toolbar) {
        if (!document.getElementById('btnToggleHeader')) {
            const tglBtn = document.createElement('button');
            tglBtn.id = 'btnToggleHeader';
            tglBtn.className = 'btn active';
            tglBtn.innerHTML = '👁 Header';
            toolbar.insertBefore(tglBtn, toolbar.firstChild);
            
            tglBtn.addEventListener('click', () => {
                const tb = document.querySelector('.topbar');
                if(tb) {
                    tb.classList.toggle('force-show');
                    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                }
            });
        }

        if (!document.getElementById('lay1')) {
            const layoutSwitcher = document.createElement('div');
            layoutSwitcher.style.cssText = "display:flex; align-items:center; gap:4px; margin-left:auto; border-left:1px solid #2a2e39; padding-left:10px;";
            layoutSwitcher.innerHTML = `
                <span style="color:#787b86; font-size:12px; font-weight:bold; margin-right:4px;">Layout:</span>
                <button id="lay1" class="btn" title="1 Màn hình (Chỉ xem Chính)">1</button>
                <button id="lay4" class="btn active" title="4 Màn hình (Chia Trái/Phải)" style="border-color:#2962ff; color:#fff; background:#1e222d;">4</button>
            `;
            toolbar.appendChild(layoutSwitcher);

            const lay1 = document.getElementById('lay1');
            const lay4 = document.getElementById('lay4');
            const rightCol = document.querySelector('.right-col');

            lay1.addEventListener('click', () => {
                lay1.style.cssText = "border-color:#2962ff; color:#fff; background:#1e222d;";
                lay4.style.cssText = "";
                if (rightCol) rightCol.style.display = 'none';
                setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50); 
            });

            lay4.addEventListener('click', () => {
                lay4.style.cssText = "border-color:#2962ff; color:#fff; background:#1e222d;";
                lay1.style.cssText = "";
                if (rightCol) rightCol.style.display = 'flex';
                setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);
            });

            // TỰ ĐỘNG CHỌN LAYOUT DỰA VÀO KÍCH THƯỚC MÀN HÌNH LÚC MỚI VÀO
            setTimeout(() => {
                if (window.innerWidth < 900) { if(lay1) lay1.click(); } 
                else { if(lay4) lay4.click(); }
            }, 200);
        }
    }
    
    function addDiv(parentId, id) {
        const p = document.getElementById(parentId);
        if (p && !document.getElementById(id)) {
            const d = document.createElement('div');
            d.id = id;
            d.className = 'floating-legend';
            p.appendChild(d);
        }
    }
    addDiv('priceChart', 'legPrice');
    addDiv('rsiChart', 'legRsiMain');
    subPanesLayout.forEach(pane => addDiv(pane.domId, 'legSub' + pane.id));

    // SUGGEST COIN (TỰ ĐỘNG TÌM KIẾM BINANCE COIN)
    const symInput = document.getElementById('symbolInput');
    if (symInput && !document.getElementById('symSuggest')) {
        const suggestBox = document.createElement('div');
        suggestBox.id = 'symSuggest';
        suggestBox.style.cssText = "position:absolute; background:#1e222d; border:1px solid #2962ff; z-index:999; max-height:250px; overflow-y:auto; display:none; border-radius:4px; box-shadow: 0 4px 8px rgba(0,0,0,0.5); min-width: 160px;";
        
        const parent = symInput.parentNode;
        if(parent) {
            parent.style.position = 'relative';
            parent.appendChild(suggestBox);
        }

        let coinList = [];
        fetch('https://api.binance.com/api/v3/ticker/price')
            .then(r => r.json())
            .then(data => { coinList = data.map(d => d.symbol).filter(s => s.endsWith('USDT')); })
            .catch(()=>{});

        symInput.addEventListener('input', function() {
            const val = this.value.trim().toUpperCase();
            if(!val) { suggestBox.style.display = 'none'; return; }
            
            const matches = coinList.filter(c => c.includes(val)).slice(0, 15);
            if(matches.length === 0) { suggestBox.style.display = 'none'; return; }
            
            suggestBox.innerHTML = '';
            matches.forEach(m => {
                const item = document.createElement('div');
                item.textContent = m;
                item.style.cssText = "padding: 8px 12px; cursor: pointer; color: #d1d4dc; font-weight: bold; border-bottom: 1px solid #2a2e39; font-size: 13px;";
                item.onmouseenter = () => item.style.background = '#2962ff';
                item.onmouseleave = () => item.style.background = 'transparent';
                item.onclick = () => {
                    symInput.value = m;
                    suggestBox.style.display = 'none';
                    if(document.getElementById('loadSymbol')) document.getElementById('loadSymbol').click();
                };
                suggestBox.appendChild(item);
            });
            suggestBox.style.top = (symInput.offsetTop + symInput.offsetHeight + 4) + 'px';
            suggestBox.style.left = symInput.offsetLeft + 'px';
            suggestBox.style.display = 'block';
        });

        document.addEventListener('click', e => {
            if(e.target !== symInput && e.target !== suggestBox) suggestBox.style.display = 'none';
        });
    }

}, 100);

function updateFloatingLegends(time) {
    if (!time) {
        if (candles && candles.length > 0) time = candles[candles.length - 1].time;
        else return;
    }

    const idx = candles.findIndex(x => x.time === time);
    if (idx !== -1) {
        const c = candles[idx];
        const prevC = idx > 0 ? candles[idx - 1] : c;
        const change = c.close - prevC.close;
        const pct = prevC.close ? (change / prevC.close) * 100 : 0;
        const colorCls = change >= 0 ? 'c-up' : 'c-down';
        const sign = change >= 0 ? '+' : '';
        
        let vol = 0, vMa = 0, eDyn = 0;
        if (cache.volumeData) { const v = cache.volumeData.find(x => x.time === time); if(v) vol = v.value; }
        if (cache.volMaData) { const vm = cache.volMaData.find(x => x.time === time); if(vm) vMa = vm.value; }
        if (cache.emaDynData) { const eD = cache.emaDynData.find(x => x.time === time); if(eD) eDyn = eD.value; }

        const volMaHtml = indicatorState.volMa ? `<span style="color: rgba(255,255,255,0.6)">Vol MA: <b>${fmtVol.format(vMa)}</b></span>` : '';
        const emaDynHtml = indicatorState.emaDyn ? `<span style="color: #ffffff">EMA${emaDynLen}: <b>${fmtPrice.format(eDyn)}</b></span>` : '';

        const legPrice = document.getElementById('legPrice');
        if (legPrice) {
            legPrice.innerHTML = `
                <span>O: <b class="${colorCls}">${fmtPrice.format(c.open)}</b></span>
                <span>H: <b class="${colorCls}">${fmtPrice.format(c.high)}</b></span>
                <span>L: <b class="${colorCls}">${fmtPrice.format(c.low)}</b></span>
                <span>C: <b class="${colorCls}">${fmtPrice.format(c.close)}</b></span>
                <span>Biến: <b class="${colorCls}">${sign}${fmtPrice.format(change)} (${sign}${pct.toFixed(2)}%)</b></span>
                ${emaDynHtml}
                <span>Vol: <b>${fmtVol.format(vol)}</b></span>
                ${volMaHtml}
            `;
        }
    }

    function getClosestData(dataArr, targetTime) {
        if (!dataArr || dataArr.length === 0) return null;
        let closest = dataArr[0];
        for (let i = 0; i < dataArr.length; i++) {
            if (dataArr[i].time <= targetTime) closest = dataArr[i];
            else break;
        }
        return closest;
    }

    const legRsiMain = document.getElementById('legRsiMain');
    if (legRsiMain) {
        const rRsi = getClosestData(cache.rsiData, time);
        const rEma = getClosestData(cache.rsiEmaData, time);
        const rWma = getClosestData(cache.rsiWmaData, time);
        legRsiMain.innerHTML = rRsi ? `
            <span style="color:#fff">RSI: <b>${rRsi.value.toFixed(2)}</b></span>
            <span style="color:#ff9800">EMA: <b>${rEma?rEma.value.toFixed(2):'--'}</b></span>
            <span style="color:#ff3b30">WMA: <b>${rWma?rWma.value.toFixed(2):'--'}</b></span>
        ` : '';
    }

    subPanesLayout.forEach(pane => {
        const legSub = document.getElementById('legSub' + pane.id);
        if (legSub && pane.data) {
            const pRsi = getClosestData(pane.data, time);
            const pEma = getClosestData(pane.dataEma, time);
            const pWma = getClosestData(pane.dataWma, time);
            legSub.innerHTML = pRsi ? `
                <span style="color:#fff">RSI: <b>${pRsi.value.toFixed(2)}</b></span>
                <span style="color:#ff9800">EMA: <b>${pEma?pEma.value.toFixed(2):'--'}</b></span>
                <span style="color:#ff3b30">WMA: <b>${pWma?pWma.value.toFixed(2):'--'}</b></span>
            ` : '';
        }
    });
}

document.querySelectorAll('.pane-container').forEach(el => {
    el.addEventListener('mousedown', function() {
        document.querySelectorAll('.pane-container').forEach(p => p.classList.remove('active-pane'));
        this.classList.add('active-pane');
        activePaneLayout = this.id === 'pane-main' ? 'main' : parseInt(this.dataset.pane);
        
        const targetTf = activePaneLayout === 'main' ? currentTf : subPanesLayout.find(p => p.id === activePaneLayout).tf;
        document.querySelectorAll(".tf").forEach(x => {
            x.classList.toggle("active", x.dataset.tf === targetTf);
        });
    });
});

const tfGroup = document.getElementById("tfButtons");
if(tfGroup) {
    const newTfGroup = tfGroup.cloneNode(true);
    if(tfGroup.parentNode) tfGroup.parentNode.replaceChild(newTfGroup, tfGroup);

    newTfGroup.addEventListener("click", e => {
        const b = e.target.closest(".tf");
        if (!b) return;
        
        document.querySelectorAll(".tf").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        const newTf = b.dataset.tf;
        
        if (activePaneLayout === 'main') {
            currentTf = newTf;
            if($("mainTfLabel")) $("mainTfLabel").textContent = newTf.toUpperCase();
            loadKlines(); 
        } else {
            const pane = subPanesLayout.find(p => p.id === activePaneLayout);
            if(pane) {
                pane.tf = newTf;
                if($(pane.labelId)) $(pane.labelId).textContent = newTf.toUpperCase();
                loadSubPaneData(pane); 
            }
        }
    });
}

const addCustomTfBtn = document.getElementById("addCustomTf");
if (addCustomTfBtn) {
    addCustomTfBtn.addEventListener("click", () => {
        const numStr = document.getElementById("customTfNum")?.value;
        const num = numStr ? numStr.trim() : "";
        const rawUnit = document.getElementById("customTfUnit")?.value;
        if (!num || parseInt(num) < 1 || !rawUnit) return;
        
        let unit = rawUnit;
        if (rawUnit === 'm') unit = 'm';
        else if (rawUnit === 'M') unit = 'M';
        else if (rawUnit.toLowerCase() === 'h') unit = 'h';
        else if (rawUnit.toLowerCase() === 'd') unit = 'd';
        else if (rawUnit.toLowerCase() === 'w') unit = 'w';
        else if (rawUnit.toLowerCase() === 'y') unit = 'Y';
        
        const tfKey = num + unit;
        let label = num + unit.toUpperCase();
        if (unit === 'm') label = num + 'm';
        
        const allTfBtns = Array.from(document.querySelectorAll(".tf"));
        let btn = allTfBtns.find(b => b.dataset.tf === tfKey);
        
        if (!btn) {
            btn = document.createElement("button");
            btn.className = "tf";
            btn.dataset.tf = tfKey;
            btn.textContent = label;
            
            const autoFitBtn = document.getElementById("autoFitBtn");
            if (autoFitBtn && autoFitBtn.parentNode) {
                autoFitBtn.parentNode.insertBefore(btn, autoFitBtn);
            } else {
                if($("tfButtons")) $("tfButtons").appendChild(btn);
            }
        }
        btn.click(); 
    });
}

let isSyncingCrosshairMulti = false;
function getClosestData(dataArr, targetTime) {
    if (!dataArr || dataArr.length === 0) return null;
    let closest = dataArr[0];
    for (let i = 0; i < dataArr.length; i++) {
        if (dataArr[i].time <= targetTime) closest = dataArr[i];
        else break;
    }
    return closest;
}

function syncAllCrosshairs(param, sourceId) {
    if (isSyncingCrosshairMulti) return;
    isSyncingCrosshairMulti = true;

    const time = param.time;
    const valid = time !== undefined && param.point && param.point.x >= 0 && param.point.y >= 0;

    if (sourceId !== 'price') {
        if (!valid) { try{ priceChart.clearCrosshairPosition(); }catch(e){} }
        else {
            const c = getClosestData(candles, time);
            if (c) { try { priceChart.setCrosshairPosition(c.close, c.time, candleSeries); } catch(e){} }
        }
    }
    if (sourceId !== 'rsi') {
        if (!valid) { try{ rsiChart.clearCrosshairPosition(); }catch(e){} }
        else {
            const c = getClosestData(cache.rsiData, time);
            if (c) { try { rsiChart.setCrosshairPosition(c.value, c.time, rsiSeries); } catch(e){} }
        }
    }
    subPanesLayout.forEach(pane => {
        if (sourceId !== pane.id && pane.chart && pane.series && pane.data) {
            if (!valid) { try{ pane.chart.clearCrosshairPosition(); }catch(e){} }
            else {
                const c = getClosestData(pane.data, time);
                if (c) { try { pane.chart.setCrosshairPosition(c.value, c.time, pane.series); } catch(e){} }
            }
        }
    });
    
    updateFloatingLegends(time);
    isSyncingCrosshairMulti = false;
}

function centerAllChartsToTime(param) {
    let time = param.time;
    if (!time) {
        if (candles && candles.length > 0) time = candles[candles.length - 1].time;
        else return;
    }
    const priceIdx = candles.findIndex(x => x.time === time);
    if (priceIdx !== -1) {
         const r = priceChart.timeScale().getVisibleLogicalRange();
         if(r) {
             const width = r.to - r.from;
             priceChart.timeScale().setVisibleLogicalRange({ from: priceIdx - width/2, to: priceIdx + width/2 });
         }
    }
    subPanesLayout.forEach(pane => {
        if (pane.chart && pane.data && pane.data.length > 0) {
            let idx = 0;
            for (let i = 0; i < pane.data.length; i++) {
                if (pane.data[i].time <= time) idx = i;
                else break;
            }
            const r = pane.chart.timeScale().getVisibleLogicalRange();
            if(r) {
                const width = r.to - r.from;
                pane.chart.timeScale().setVisibleLogicalRange({ from: idx - width/2, to: idx + width/2 });
            }
        }
    });
}

try {
    if(priceChart) {
        priceChart.subscribeCrosshairMove(p => syncAllCrosshairs(p, 'price'));
        priceChart.subscribeClick(centerAllChartsToTime);
    }
    if(rsiChart) {
        rsiChart.subscribeCrosshairMove(p => syncAllCrosshairs(p, 'rsi'));
        rsiChart.subscribeClick(centerAllChartsToTime);
    }
} catch(e) {}

async function loadSubPaneData(pane) {
    const cfg = getTimeframeConfig(pane.tf);
    const url = `https://api.binance.com/api/v3/klines?symbol=${currentSymbol}&interval=${cfg.apiTf}&limit=1000`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const subRaw = data.map(toChartCandle);
        const subAgg = aggregateCandles(subRaw, cfg.aggregate);
        
        const rsiData = rsi(subAgg, 14); 
        pane.data = rsiData; 
        
        const rsiAsClose = rsiData.map(x => ({time: x.time, close: x.value}));
        const rsiEmaData = ema(rsiAsClose, 9);
        const rsiWmaData = wma(rsiAsClose, 45);
        pane.dataEma = rsiEmaData; 
        pane.dataWma = rsiWmaData; 
        
        if (!pane.chart) {
            pane.chart = LightweightCharts.createChart(document.getElementById(pane.domId), {
                autoSize: true,
                layout: { background: { color: "#0f131a" }, textColor: "#787b86" },
                grid: { vertLines: { color: "rgba(42,46,57,.14)" }, horzLines: { color: "rgba(42,46,57,.14)" } },
                rightPriceScale: { borderColor: "#2a2e39" },
                timeScale: { borderColor: "#2a2e39", timeVisible: true, tickMarkFormatter: formatTickTime, rightOffset: 5, barSpacing: 6 }
            });
            
            pane.series = pane.chart.addLineSeries({ color: "#fff", lineWidth: 2 });
            pane.seriesEma = pane.chart.addLineSeries({ color: "#ff9800", lineWidth: 2 });
            pane.seriesWma = pane.chart.addLineSeries({ color: "#ff3b30", lineWidth: 2 });
            
            const bt = subAgg.map(c => c.time);
            const rsi70 = pane.chart.addLineSeries({ color: "#787b86", lineWidth: 1, lineStyle: 2 });
            const rsi50 = pane.chart.addLineSeries({ color: "#787b86", lineWidth: 1, lineStyle: 2 });
            const rsi30 = pane.chart.addLineSeries({ color: "#787b86", lineWidth: 1, lineStyle: 2 });
            rsi70.setData(bt.map(t => ({ time: t, value: 70 })));
            rsi50.setData(bt.map(t => ({ time: t, value: 50 })));
            rsi30.setData(bt.map(t => ({ time: t, value: 30 })));

            pane.chart.subscribeCrosshairMove(p => syncAllCrosshairs(p, pane.id));
            pane.chart.subscribeClick(centerAllChartsToTime);
        }
        
        pane.series.setData(rsiData);
        pane.seriesEma.setData(rsiEmaData);
        pane.seriesWma.setData(rsiWmaData);
    } catch(e) {}
}

if($("loadSymbol")) {
    $("loadSymbol").addEventListener("click", () => {
        setTimeout(() => { subPanesLayout.forEach(p => loadSubPaneData(p)); }, 500);
    });
}
subPanesLayout.forEach(p => loadSubPaneData(p));