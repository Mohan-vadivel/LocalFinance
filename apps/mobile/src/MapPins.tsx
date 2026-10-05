import { useMemo } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  title: string;
  color: string;
}

/**
 * OpenStreetMap (Leaflet) in a WebView: numbered pins in visiting order joined by a dashed line, plus the agent's own
 * position. No map API key is needed. Tapping a pin's popup sends its id back.
 */
export function MapPins({ pins, me, onOpen, height = 360 }: { pins: MapPin[]; me?: { lat: number; lng: number } | null; onOpen?: (id: string) => void; height?: number }) {
  const html = useMemo(() => {
    const data = JSON.stringify({ pins, me: me ?? null }).replace(/</g, '\\u003c');
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{height:100%;margin:0}.pin{color:#fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font:800 14px sans-serif;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.me{width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px #2563eb}.leaflet-popup-content{font:600 15px sans-serif;color:#0f1a1a}.leaflet-popup-content-wrapper{border-radius:14px}.open{display:block;margin-top:8px;padding:12px 14px;background:#0f766e;color:#fff;border-radius:10px;text-align:center;text-decoration:none;font:800 18px sans-serif}</style>
</head><body><div id="m"></div><script>
var d=${data};
var map=L.map('m',{zoomControl:true});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
var pts=[];
d.pins.forEach(function(p){
  var icon=L.divIcon({className:'',html:'<div class="pin" style="background:'+p.color+'">'+p.label+'</div>',iconSize:[28,28],iconAnchor:[14,14]});
  var div=document.createElement('div');div.textContent=p.title;
  var a=document.createElement('a');a.href='#';a.className='open';a.textContent='›';a.onclick=function(e){e.preventDefault();window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(p.id)};div.appendChild(a);
  L.marker([p.lat,p.lng],{icon:icon}).addTo(map).bindPopup(div);pts.push([p.lat,p.lng]);
});
if(pts.length>1)L.polyline(pts,{color:'#0f766e',weight:3,opacity:.6,dashArray:'6 6'}).addTo(map);
if(d.me){L.marker([d.me.lat,d.me.lng],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map);pts.push([d.me.lat,d.me.lng]);}
if(pts.length>1)map.fitBounds(pts,{padding:[30,30]});else if(pts.length===1)map.setView(pts[0],16);else map.setView([9.9252,78.1198],12);
</script></body></html>`;
  }, [pins, me]);
  return (
    <View style={{ height, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#dfe6e4', backgroundColor: '#eaf0ee' }}>
      <WebView
        style={{ height, backgroundColor: '#eaf0ee' }}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={(e) => onOpen?.(e.nativeEvent.data)}
        javaScriptEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}
