/*** ========= CONFIG ========= ***/
const PATHS = {
  geojson: "../data/geo/secciones.geojson",          // <-- AJUSTA a tu ruta real
  electoralA: "../data/electoral/A.json"             // <-- tu A.json (puesto Ayuntamiento)
};

const PUESTO = "A";
const YEAR_BASE = 2024;

/*** ========= HELPERS ========= ***/
const num = v => (v==null || v==="" || isNaN(Number(v))) ? null : Number(v);
const pct = v => (v==null) ? "—" : (v*100).toFixed(1) + "%";
const fmt = v => (v==null) ? "—" : new Intl.NumberFormat("es-MX").format(v);

function getMunFromContext(){
  // 1) URL ?mun=20
  const q = new URLSearchParams(location.search);
  const munQ = q.get("mun");
  if (munQ) return String(munQ);

  // 2) lo que ya guardas desde portal (si aplica)
  const stored = localStorage.getItem("AT_UNIVERSO");
  if (stored){
    try{
      const u = JSON.parse(stored);
      if (u.scope === "MUN" && u.key) return String(u.key);
    }catch(e){}
  }
  // fallback: León (20) por defecto
  return "20";
}

// Muy simple: diccionario mínimo. Si ya tienes uno global, lo enchufamos después.
const MUN_LABELS = {
  "20":"León de los Aldama",
  "6":"Abasolo"
};

function normalize(val, min, max){
  if (val==null) return 0;
  if (max === min) return 0.5;
  return (val - min) / (max - min);
}

/*** ========= LOAD DATA ========= ***/
async function loadJSON(url){
  const r = await fetch(url);
  if (!r.ok) throw new Error("No se pudo cargar: " + url);
  return await r.json();
}

let map, layer;

function initMap(){
  map = L.map("map", {zoomControl:true}).setView([21.0,-101.2], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19}).addTo(map);
}

function renderKpis(k){
  const grid = document.getElementById("kpiGrid");
  grid.innerHTML = "";
  const items = [
    {label:"Municipio", value:k.munLabel},
    {label:"Universo (secciones)", value:fmt(k.totalSecciones)},
    {label:"Participación prom.", value: pct(k.partProm)},
    {label:"Ganador global (2024)", value: k.ganador || "—"},
    {label:"Oportunidad", value: k.oportunidad || "—"}
  ];
  items.forEach(it=>{
    const d = document.createElement("div");
    d.className="kpi";
    d.innerHTML = `<div class="label">${it.label}</div><div class="value">${it.value}</div>`;
    grid.appendChild(d);
  });
}

function fillList(elId, arr){
  const el = document.getElementById(elId);
  el.innerHTML = "";
  arr.forEach(row=>{
    const div = document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div><b>Sección ${row.seccion}</b> <span class="pill">score ${row.score.toFixed(0)}</span></div>
      <div style="text-align:right;color:var(--muted)">
        faltan: <b>${fmt(row.faltan)}</b><br/>
        LN: ${fmt(row.ln)}
      </div>
    `;
    el.appendChild(div);
  });
}

function exportPDF(){
  const root = document.getElementById("dashboardRoot");
  html2canvas(root, {scale:2, useCORS:true}).then(canvas=>{
    const img = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p","mm","a4");
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = canvas.height * imgW / canvas.width;

    let y = 0;
    if (imgH <= pageH){
      pdf.addImage(img, "PNG", 0, 0, imgW, imgH);
    } else {
      // multipágina
      let remaining = imgH;
      let pos = 0;
      while (remaining > 0){
        pdf.addImage(img, "PNG", 0, pos, imgW, imgH);
        remaining -= pageH;
        pos -= pageH;
        if (remaining > 0) pdf.addPage();
      }
    }
    pdf.save("dashboard_municipio.pdf");
  });
}

/*** ========= CORE: rentabilidad ========= ***/
function buildRentabilidad({features, electoralSecciones, munKey}){
  // electoralSecciones: { "331": {2024:{PAN:...,VOTOS:...,LN:...}, ...}, ... }
  const rows = [];

  for (const f of features){
    const seccion = String(f.properties?.SECCION);
    const e = electoralSecciones?.[seccion]?.[String(YEAR_BASE)];
    if (!e) continue;

    const ln = num(e.LN);
    const votos = num(e.VOTOS);
    const part = (ln && votos) ? (votos/ln) : null;

    // top1/top2
    const parties = Object.entries(e).filter(([k,v]) => !["VOTOS","LN"].includes(k));
    parties.sort((a,b)=> (num(b[1])||0) - (num(a[1])||0));
    const top1 = parties[0] ? {p:parties[0][0], v:num(parties[0][1])||0} : null;
    const top2 = parties[1] ? {p:parties[1][0], v:num(parties[1][1])||0} : null;

    // "tuyo" aún no definido aquí (porque depende del candidato/alianza).
    // Para DEMO: asumimos que tu objetivo es competir al top1 (voltéo) => usamos costo como margen+1.
    // Luego lo hacemos configurable (PARTIDO_OBJETIVO) sin tocar nada más.
    const faltan = (top1 && top2) ? Math.max(0, (top1.v - top2.v) + 1) : 0;

    rows.push({ seccion, ln, votos, part, faltan, top1: top1?.p || "—" });
  }

  // normalizaciones
  const faltVals = rows.map(r=>r.faltan);
  const lnVals = rows.map(r=>r.ln).filter(v=>v!=null);

  const minF = Math.min(...faltVals), maxF = Math.max(...faltVals);
  const minLN = Math.min(...lnVals), maxLN = Math.max(...lnVals);

  rows.forEach(r=>{
    const scoreCosto = 1 - normalize(r.faltan, minF, maxF);
    const scoreTam = normalize(r.ln, minLN, maxLN);

    // turnout target ~0.55
    const t = (r.part==null) ? 0.5 : (1 - Math.min(1, Math.abs(r.part - 0.55)/0.30));
    const scoreTurn = t;

    const score = (0.50*scoreCosto + 0.35*scoreTam + 0.15*scoreTurn) * 100;
    r.score = score;
  });

  rows.sort((a,b)=> b.score - a.score);

  const n = rows.length;
  const cut1 = Math.floor(n/3);
  const cut2 = Math.floor(2*n/3);

  const high = rows.slice(0, Math.min(20, cut1));
  const mid  = rows.slice(cut1, Math.min(cut1+20, cut2));
  const low  = rows.slice(Math.max(cut2, n-20), n);

  return { rows, high, mid, low };
}

/*** ========= RENDER ========= ***/
function renderMap(features, rentRows){
  if (layer) layer.remove();

  const scoreBySec = new Map(rentRows.map(r=>[r.seccion, r.score]));

  layer = L.geoJSON({type:"FeatureCollection", features}, {
    style: (feat)=>{
      const s = scoreBySec.get(String(feat.properties?.SECCION));
      // sin colores hardcode “partidistas”; solo grises con matiz suave:
      let fill = "#e5e7eb";
      if (s!=null){
        if (s>=66) fill = "#d1fae5";      // alta
        else if (s>=33) fill = "#fef3c7"; // media
        else fill = "#e5e7eb";            // baja
      }
      return {color:"#7a1f2b", weight:1, fillColor:fill, fillOpacity:.55};
    },
    onEachFeature: (feat, lyr)=>{
      const sec = String(feat.properties?.SECCION);
      const r = rentRows.find(x=>x.seccion===sec);
      lyr.bindTooltip(
        `<b>Sección ${sec}</b><br/>Score: ${r? r.score.toFixed(0):"—"}<br/>faltan: ${r? fmt(r.faltan):"—"}<br/>LN: ${r? fmt(r.ln):"—"}`,
        {sticky:true}
      );
    }
  }).addTo(map);

  map.fitBounds(layer.getBounds(), {padding:[20,20]});
}

function renderCharts(rentAll){
  // placeholders: en el siguiente paso los conectamos a Historial real por año y a GanarTodo
  const ctxH = document.getElementById("chartHist");
  new Chart(ctxH, {
    type:"bar",
    data:{
      labels:["2018","2021","2024"],
      datasets:[
        {label:"Votos (global)", data:[0,0,0]}
      ]
    },
    options:{responsive:true, plugins:{legend:{display:true}}}
  });

  const ctxT = document.getElementById("chartTop");
  const top = rentAll.slice(0, 12);
  new Chart(ctxT, {
    type:"bar",
    data:{
      labels: top.map(r=>"S"+r.seccion),
      datasets:[
        {label:"Score rentabilidad", data: top.map(r=>Number(r.score.toFixed(1)))}
      ]
    },
    options:{responsive:true, plugins:{legend:{display:true}}}
  });

  document.getElementById("tableTop").innerHTML =
    `<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Top 12 secciones por score</div>` +
    `<div style="border:1px solid var(--line);border-radius:14px;overflow:hidden">` +
    top.map(r=>`
      <div class="item">
        <div><b>Sección ${r.seccion}</b> <span class="pill">score ${r.score.toFixed(0)}</span></div>
        <div style="text-align:right;color:var(--muted)">
          faltan: <b>${fmt(r.faltan)}</b> · LN: ${fmt(r.ln)}
        </div>
      </div>
    `).join("") +
    `</div>`;
}

/*** ========= BOOT ========= ***/
(async function main(){
  const munKey = getMunFromContext();
  const munLabel = MUN_LABELS[munKey] || ("Municipio " + munKey);

  document.getElementById("hdrTitle").textContent = `Dashboard Municipal — ${munLabel}`;
  document.getElementById("hdrSub").textContent = `Puesto ${PUESTO} · Año base ${YEAR_BASE} · Cargando datos…`;

  document.getElementById("btnBack").onclick = ()=> location.href = "../portal/portal.html";
  document.getElementById("btnPDF").onclick = exportPDF;
  document.getElementById("btnPrint").onclick = ()=> window.print();

  initMap();

  const geo = await loadJSON(PATHS.geojson);
  const elec = await loadJSON(PATHS.electoralA);

  // Elec A.json: elec.secciones["331"].2024...
  const elecSecs = elec.secciones || {};

  const featuresMun = geo.features.filter(f => String(f.properties?.MUNICIPIO) === String(munKey));

  const { rows, high, mid, low } = buildRentabilidad({features:featuresMun, electoralSecciones:elecSecs, munKey});

  renderKpis({
    munLabel,
    totalSecciones: featuresMun.length,
    partProm: (()=>{
      const parts = rows.map(r=>r.part).filter(v=>v!=null);
      if (!parts.length) return null;
      return parts.reduce((a,b)=>a+b,0)/parts.length;
    })(),
    ganador: "—",         // siguiente paso: agregamos ganador global real
    oportunidad: "—"      // siguiente paso: índice global
  });

  document.getElementById("pillHigh").textContent = `Top ${high.length}`;
  document.getElementById("pillMid").textContent  = `Mid ${mid.length}`;
  document.getElementById("pillLow").textContent  = `Bottom ${low.length}`;

  fillList("listHigh", high);
  fillList("listMid", mid);
  fillList("listLow", low);

  renderMap(featuresMun, rows);
  renderCharts(rows);

  document.getElementById("hdrSub").textContent =
    `Puesto ${PUESTO} · Año base ${YEAR_BASE} · Secciones: ${featuresMun.length}`;
})();
