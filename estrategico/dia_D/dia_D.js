  // ===== 0) Campos (ajusta si tus nombres son distintos) =====
  // DL = Distrito Local, DF = Distrito Federal
  const FIELD_KEYS = { mun: 'MUNICIPIO', dl: 'DISTRITO_L', df: 'DISTRITO_F' };


    const paths = JSON.parse(localStorage.getItem('AT_PATHS')||'{}');
    const urlGeo = paths.geo || '../data/geo/secciones.geojson';
    const catUrl = paths.catalog || '../data/catalogo_territorial.json';
    const ELP = paths.electoral?.P || '../data/electoral/P.json';
// ...



  // ===== 1) Mapa único y chequeo =====
  function ensureLeafletMap() {
    if (window.__AT_MAP && window.__AT_MAP instanceof L.Map) return window.__AT_MAP;
    const m = L.map('map', { zoomControl:true }).setView([21.0, -101.3], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OSM' }).addTo(m);
    window.__AT_MAP = m;
    return m;
  }
  function assertIsLeafletMap(m) {
    if (!(m instanceof L.Map) || typeof m.addLayer !== 'function') {
      throw new Error('[AT] addTo(): destino no es un Leaflet Map. Revisa variables llamadas "map" o dobles inicializaciones.');
    }
  }

  function closeSecInfoPanel(){
    const box = document.getElementById('sec-info');
    if (box) box.style.display = 'none';
    // Si quieres limpiar resaltado y etiquetas al cerrar:
    if (typeof clearSectionOverlays === 'function') clearSectionOverlays();
  }

  function AT_isDockedPanel(el){
    return !!(el && el.classList && el.classList.contains('dock-panel'));
  }
  function AT_dockPanel(el){
    if (!el) return;
    el.classList.add('dock-panel');
    const host = document.getElementById('dash-panels');
    if (host && el.parentElement !== host) host.appendChild(el);
  }
  function AT_watchDockPanels(){
    const host = document.getElementById('dash-panels');
    if (!host || host.__dockObserver) return;
    const dockIfNeeded = (node)=>{
      if (!node || node.nodeType !== 1) return;
      if (node.id && /^AT27_/.test(node.id) && /_panel$/.test(node.id)) {
        AT_dockPanel(node);
      }
    };
    const obs = new MutationObserver((mutations)=>{
      for (const m of mutations){
        for (const n of m.addedNodes){
          dockIfNeeded(n);
          if (n.querySelectorAll){
            n.querySelectorAll('[id^="AT27_"][id$="_panel"]').forEach(dockIfNeeded);
          }
        }
      }
    });
    obs.observe(document.body, { childList:true, subtree:true });
    host.__dockObserver = true;
  }


  function ensureSecInfoPanelWired(){
  const box = document.getElementById('sec-info');
  const hdr = box?.querySelector('.hdr');
  if (!box || !hdr || box.__wired) return;

  // Bloquear propagación al mapa (no “parpadea” al arrastrar)
  if (window.L && L.DomEvent){
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
  }

  // Drag del panel
  let dragging = false, sx=0, sy=0, bx=0, by=0;
  hdr.addEventListener('mousedown', (e)=>{
    if (AT_isDockedPanel(box)) return;
    if (e.target.closest('.btn-close')) return; // no iniciar drag si clic en "×"
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    const r = box.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; bx = r.left; by = r.top;
    box.style.position = 'absolute'; box.style.right='auto'; box.style.bottom='auto';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e)=>{
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation();
    const dx = e.clientX - sx, dy = e.clientY - sy;
    box.style.left = (bx + dx) + 'px';
    box.style.top  = (by + dy) + 'px';
  });
  window.addEventListener('mouseup', ()=>{
    if (!dragging) return;
    dragging = false; document.body.style.userSelect = '';
  });

  // Botón “×”
  const btn = document.getElementById('sec-close');
  if (btn && !btn.__wired){
    btn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); closeSecInfoPanel(); });
    btn.__wired = true;
  }

  box.__wired = true;
}



  // ===== 2) Filtrado por universo =====
  function toComp(v){ if(v==null) return ''; const s=String(v).trim(); return (isFinite(s) && s!=='') ? Number(s) : s.toUpperCase(); }
  function matches(props, u){
    if(u.scope==='ALL') return true;
    const keyField = u.scope==='MUN' ? FIELD_KEYS.mun : (u.scope==='DL' ? FIELD_KEYS.dl : FIELD_KEYS.df);
    return toComp(props?.[keyField]) === toComp(u.key);
  }
  function filterGeojson(geojson, u){
    if(u.scope==='ALL') return geojson;
    const features = (geojson.features || []).filter(f => matches(f.properties, u));
    return { ...geojson, features };
  }


  // ====== CARGA ELECTORAL (para obtener 24DL_LN) ======
  function getPaths(){ try{ return JSON.parse(localStorage.getItem('AT_PATHS')||'{}'); }catch{ return {}; } }
  function getPuestoPath(p){ const paths = getPaths(); return paths?.electoral?.[p] || `data/electoral/${p}.json`; }

  window.AT_ELECT = window.AT_ELECT || {};
  async function getElectData(puesto){
    if (window.AT_ELECT[puesto]) return window.AT_ELECT[puesto];
    const res = await fetch(getPuestoPath(puesto));
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${puesto}`);
    const js = await res.json();
    window.AT_ELECT[puesto] = js;
    return js;
  }
  // LN para 2024 desde DL; si no hay, intenta P (fallback)
  async function getLN24DL(sec){
    const key = String(sec);
    try {
      const dl = await getElectData('DL');
      const ln = dl?.secciones?.[key]?.["2024"]?.LN;
      if (typeof ln === 'number') return ln;
    } catch(_){}
    try {
      const p = await getElectData('P');
      const ln = p?.secciones?.[key]?.["2024"]?.LN;
      if (typeof ln === 'number') return ln;
    } catch(_){}
    return null;
  }

  // ====== ADYACENCIAS (Turf) ======
  function bboxIntersects(b1, b2){
    return !(b2[0] > b1[2] || b2[2] < b1[0] || b2[1] > b1[3] || b2[3] < b1[1]);
  }
  function getAdjacents(feat){
    const all = (window.AT_DATA?.features)
            || (window.AT_CTX?.layer?.toGeoJSON?.()?.features)
            || [];
    if (!all.length) return [];
    const b1 = turf.bbox(feat);
    const out = [];
    const sec1 = feat.properties?.SECCION;
    for (const f of all){
      const p = f.properties || {};
      if (p.SECCION === sec1) continue;
      const b2 = turf.bbox(f);
      if (!bboxIntersects(b1,b2)) continue;
      try {
        if (turf.booleanTouches(feat, f) || turf.booleanOverlap(feat, f) || turf.booleanIntersects(feat, f)){
          out.push(f);
        }
      } catch(_){}
    }
    return out.slice(0, 25); // cota de seguridad
  }

  // ====== LABELS SOBRE EL MAPA ======
  function addLabelForFeature(feat, className, text){
    try {
      const c = turf.centerOfMass(feat).geometry.coordinates; // [lon, lat]
      const icon = L.divIcon({
        className: className,
        html: text,
        iconAnchor: [0, 0],   // se centra con transform en CSS
      });
      const m = L.marker([c[1], c[0]], { icon });
      window.__SEC_LABELS = window.__SEC_LABELS || L.layerGroup().addTo(ensureLeafletMap());
      window.__SEC_LABELS.addLayer(m);
      return m;
    } catch(_){}
    return null;
  }

  function clearSectionOverlays(){
    const atMap = ensureLeafletMap();
    if (window.__SEC_HL){ try{ atMap.removeLayer(__SEC_HL); }catch(_){ } window.__SEC_HL = null; }
    if (window.__SEC_ADJ){ try{ atMap.removeLayer(__SEC_ADJ); }catch(_){ } window.__SEC_ADJ = null; }
    if (window.__SEC_LABELS){ try{ atMap.removeLayer(__SEC_LABELS); }catch(_){ } window.__SEC_LABELS = null; }
  }

  // Dibuja selección + adyacentes + labels
  function paintSelectionAndAdj(feat){
    const atMap = ensureLeafletMap();
    clearSectionOverlays();

    // resaltado principal
    window.__SEC_HL = L.geoJSON(feat, { style:{ color:'#e91e63', weight:3, fillOpacity:0.25 } }).addTo(atMap);
    try { atMap.fitBounds(window.__SEC_HL.getBounds(), { padding:[28,28] }); } catch(_){}

    // adyacentes
    const adj = getAdjacents(feat);
    if (adj.length){
      window.__SEC_ADJ = L.geoJSON({type:'FeatureCollection', features:adj}, { style:{ color:'#90a4ae', weight:1.2, dashArray:'4,4', fillOpacity:0.05 } }).addTo(atMap);
    }

    // labels
    const sec = feat.properties?.SECCION ?? '—';
    addLabelForFeature(feat, 'sec-label', `Sección ${sec}`);
    for (const f of adj){
      const s2 = f.properties?.SECCION ?? '—';
      addLabelForFeature(f, 'sec-label-adj', s2);
    }

    // panel de casillas (dato enriquecido por sección)
    showCasillasPanelForSec(sec);
  }

  // ====== PANEL FLOTANTE (drag + datos) ======
  (function wireSecInfoPanel(){
    const box = document.getElementById('sec-info');
    const hdr = box?.querySelector('.hdr');
    if (!box || !hdr || box.__wired) return;
    let dragging = false, sx=0, sy=0, bx=0, by=0;
    hdr.addEventListener('mousedown', (e)=>{
      if (AT_isDockedPanel(box)) return;
      dragging=true; sx=e.clientX; sy=e.clientY;
      const r = box.getBoundingClientRect(); bx=r.left; by=r.top;
      document.body.style.userSelect='none';
    });
    window.addEventListener('mousemove', (e)=>{
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      box.style.left = (bx + dx) + 'px';
      box.style.top  = (by + dy) + 'px';
      box.style.right = 'auto'; box.style.bottom='auto';
      box.style.position = 'absolute';
    });
    window.addEventListener('mouseup', ()=>{ dragging=false; document.body.style.userSelect=''; });
    box.__wired = true;
  })();

  async function showSectionInfo(feat){
    ensureSecInfoPanelWired();
    const p = feat.properties || {};
    const sec = p.SECCION ?? '—';
    const df  = p[FIELD_KEYS.df] ?? '—';
    const dl  = p[FIELD_KEYS.dl] ?? '—';

    // LN 24DL_LN
    let ln = await getLN24DL(sec);
    if (ln==null) ln = '—';

    // Pintar
    const box = document.getElementById('sec-info');
    const ttl = box.querySelector('.ttl');
    if (ttl) ttl.textContent = `Sección ${sec}`;
    document.getElementById('si-sec').textContent = sec;
    document.getElementById('si-df').textContent  = df;
    document.getElementById('si-dl').textContent  = dl;
    document.getElementById('si-ln').textContent  = ln;
    box.style.display = 'block';

    // actualizar panel de casillas
    showCasillasPanelForSec(sec);
  }



  // ENTER + CLIC + ULTIMO TOKEN

  function currentNeedle(q){
    if (!q) return '';
    const parts = String(q).split(/[,;\s]+/).filter(Boolean);
    return parts.length ? parts[parts.length-1] : '';
  }

  // ===== Carga de casillas Abasolo (GeoJSON) =====
  let __ABASOLO_LAYER = null;
  async function loadCasillasAbasolo(){
    const url = '../data/casillas/puntos_casillas.geojson';
    const map = (window.AT_CTX?.map) || ensureLeafletMap();
    try{
      const res = await fetch(url);
      const geo = await res.json();
      if (__ABASOLO_LAYER){ try{ map.removeLayer(__ABASOLO_LAYER); }catch(_){ } }
      __ABASOLO_LAYER = L.geoJSON(geo, {
        pointToLayer: (feat, latlng)=> L.circleMarker(latlng, {
          radius:7,
          color:'#e11d48',
          weight:2,
          fillColor:'#f472b6',
          fillOpacity:0.8
        }),
        onEachFeature:(feat, layer)=>{
          const p = feat.properties || {};
          const cas = p.CASILLA || p.casilla || p.CAS || p.Casilla || '—';
          const sec = p.SECCION || p.sec || p.SecciOn || p.Seccion || '—';
          const dom = p.DOMICILIO || p.dom || '';
          layer.bindPopup(`<b>Casilla ${cas}</b><br/>Sección: ${sec}<br/>${dom}`);
        }
      }).addTo(map);
      try{ map.fitBounds(__ABASOLO_LAYER.getBounds(), { padding:[18,18] }); }catch(_){}
    }catch(err){
      console.error('No pude cargar casillas_Abasolo.geojson', err);
      alert('No se pudo cargar casillas_Abasolo.geojson');
    }
  }

  // ===== Panel de casillas por sección (datos enriquecidos) =====
  const CASILLAS_PATH = '../data/casillas/casillas_min_por_seccion_enriquecido.json';
  let __CASILLAS_MAP = null;
  const ACTA_STORAGE_KEY = 'AT27_ACTAS_CASILLA';
  const EST_STORAGE_KEY  = 'AT27_DIA_CASILLA';

  async function ensureCasillasData(){
    if (__CASILLAS_MAP) return __CASILLAS_MAP;
    try{
      const res = await fetch(CASILLAS_PATH);
      const json = await res.json();
      const map = {};
      if (Array.isArray(json)){
        json.forEach(it => {
          const k = String(it.SECCION ?? '').replace(/\D+/g,'');
          if (k) map[k] = it;
        });
      } else if (json && typeof json === 'object'){
        Object.keys(json).forEach(k => {
          const clean = String(k).replace(/\D+/g,'');
          map[clean] = json[k];
        });
      }
      __CASILLAS_MAP = map;
    }catch(err){
      console.error('[Día D] No pude leer casillas enriquecido:', err);
      __CASILLAS_MAP = {};
    }
    return __CASILLAS_MAP;
  }

  async function showCasillasPanelForSec(sec){
    const panel = document.getElementById('casillas-panel');
    if (!panel) return;
    const body = panel.querySelector('.cp-body');
    const title = panel.querySelector('.cp-sec');

    title.textContent = sec || '—';
    panel.style.display = 'block';
    body.innerHTML = '<div class="cp-empty">Cargando…</div>';

    const data = await ensureCasillasData();
    const row = data[String(sec).replace(/\D+/g,'')] || null;
    if (!row){
      body.innerHTML = '<div class="cp-empty">Sin casillas registradas para esta sección.</div>';
      return;
    }

    const cas = Array.isArray(row.casillas) ? row.casillas : [];
    if (!cas.length){
      body.innerHTML = '<div class="cp-empty">Sin casillas registradas para esta sección.</div>';
      return;
    }

    const req = row.req_rep != null ? ` · Req rep: ${row.req_rep}` : '';
    panel.querySelector('.cp-hdr small').textContent = `Sección ${sec}${req}`;

    body.innerHTML = cas.map(c => {
      const dom = c.DOMICILIO_CORTO || c.DOMICILIO_LIMPIO || c.DOMICILIO || '—';
      const loc = c.LOCALIDAD || '';
      return `<div class="cp-row" data-cas="${c.CASILLA || ''}" data-loc="${loc}" data-dom="${dom.replace(/"/g,'&quot;')}">
        <div class="cp-info">
          <div><b>Casilla ${c.CASILLA || '—'}</b></div>
          <div class="cp-meta">
            ${loc ? `<span>Loc: ${loc}</span>` : ''}
          </div>
          <div class="cp-dom">${dom}</div>
        </div>
        <div class="cp-actions">
          <button type="button" class="cp-acta">Acta</button>
          <button type="button" class="cp-est">Estatus</button>
        </div>
      </div>`;
    }).join('');

    body.querySelectorAll('.cp-row').forEach(rowEl=>{
      const cas = rowEl.getAttribute('data-cas') || '—';
      const loc = rowEl.getAttribute('data-loc') || '';
      const dom = rowEl.getAttribute('data-dom') || '';
      rowEl.querySelector('.cp-acta')?.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        openActaModal({ sec, cas, loc, dom });
      });
      rowEl.querySelector('.cp-est')?.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        openEstModal({ sec, cas, loc, dom });
      });
    });
  }

  // ===== Modal Acta =====
  const ACTA_ELECCIONES = [
    { key:'A', label:'AYUNTAMIENTO' },
    { key:'DL', label:'DIPUTADO LOCAL' },
    { key:'DF', label:'DIPUTADO FEDERAL' },
    { key:'G', label:'GOBERNADOR' },
    { key:'S', label:'SENADOR' },
    { key:'P', label:'PRESIDENTE' },
  ];
  const ACTA_PARTIDOS = ['PAN','PRI','PVEM','MC','MORENA','INDEPENDIENTE'];

  function getStoredActas(){
    try{
      return JSON.parse(localStorage.getItem(ACTA_STORAGE_KEY) || '{}');
    }catch(_){ return {}; }
  }
  function saveStoredActas(obj){
    try{ localStorage.setItem(ACTA_STORAGE_KEY, JSON.stringify(obj)); }catch(_){}
  }
  function actaKey(sec, cas){ return `${String(sec).trim()}|${String(cas).trim().toUpperCase()}`; }

  function renderActaTable(existing){
    const table = document.getElementById('acta-table');
    if (!table) return;
    const header = `
      <tr>
        <th>Elección</th>
        ${ACTA_PARTIDOS.map(p=>`<th>${p}</th>`).join('')}
        <th>Nulos</th>
        <th>Votos</th>
        <th>Lista Nominal</th>
        <th>Incidencias</th>
      </tr>`;
    const rows = ACTA_ELECCIONES.map(e=>{
      const row = existing?.[e.key] || {};
      const inputsPartidos = ACTA_PARTIDOS.map(p=>{
        const val = row[p] ?? '';
        return `<td><input type="number" inputmode="numeric" min="0" data-elec="${e.key}" data-field="${p}" value="${val}"/></td>`;
      }).join('');
      return `
        <tr>
          <td>${e.label}</td>
          ${inputsPartidos}
          <td><input type="number" inputmode="numeric" min="0" data-elec="${e.key}" data-field="NULOS" value="${row.NULOS ?? ''}"/></td>
          <td><input type="number" inputmode="numeric" min="0" data-elec="${e.key}" data-field="VOTOS" value="${row.VOTOS ?? ''}"/></td>
          <td><input type="number" inputmode="numeric" min="0" data-elec="${e.key}" data-field="LN" value="${row.LN ?? ''}"/></td>
          <td><input type="text" data-elec="${e.key}" data-field="INCIDENCIAS" value="${row.INCIDENCIAS ?? ''}"/></td>
        </tr>`;
    }).join('');
    table.innerHTML = header + rows;
  }

  function openActaModal(ctx){
    const backdrop = document.getElementById('acta-modal-backdrop');
    const meta = document.querySelector('#acta-modal .am-meta');
    if (!backdrop || !meta) return;
    meta.textContent = `Sección ${ctx.sec} · Casilla ${ctx.cas}`;

    const store = getStoredActas();
    const existing = store[actaKey(ctx.sec, ctx.cas)];
    renderActaTable(existing);

    backdrop.style.display = 'flex';

    const btnClose = document.querySelector('#acta-modal .cp-close');
    const btnCancel = document.getElementById('acta-cancel');
    const btnSave = document.getElementById('acta-save');

    const close = ()=>{ backdrop.style.display = 'none'; };

    btnClose.onclick = close;
    btnCancel.onclick = close;
    btnSave.onclick = ()=>{
      const inputs = document.querySelectorAll('#acta-table input');
      const next = {};
      inputs.forEach(inp=>{
        const elec = inp.dataset.elec;
        const field = inp.dataset.field;
        if (!elec || !field) return;
        next[elec] = next[elec] || {};
        const val = inp.type === 'number' ? (inp.value ? Number(inp.value) : '') : inp.value;
        if (val !== '') next[elec][field] = val;
      });
      const all = getStoredActas();
      all[actaKey(ctx.sec, ctx.cas)] = next;
      saveStoredActas(all);
      close();
    };
  }

  // ===== Modal Estatus / Cortes =====
  function getStoredEst(){
    try{
      return JSON.parse(localStorage.getItem(EST_STORAGE_KEY) || '{}');
    }catch(_){ return {}; }
  }
  function saveStoredEst(obj){
    try{ localStorage.setItem(EST_STORAGE_KEY, JSON.stringify(obj)); }catch(_){}
  }

  function openEstModal(ctx){
    const backdrop = document.getElementById('estatus-modal-backdrop');
    const meta = document.querySelector('#estatus-modal-backdrop .est-meta');
    const modal = document.getElementById('estatus-modal');
    if (!backdrop || !meta) return;
    meta.textContent = `Sección ${ctx.sec} · Casilla ${ctx.cas}`;

    const inputs = {
      estatus: document.getElementById('est-dia-status'),
      apHora: document.getElementById('est-dia-apertura-hora'),
      apObs: document.getElementById('est-dia-apertura-obs'),
      c11: document.getElementById('est-dia-corte-11'),
      c13: document.getElementById('est-dia-corte-13'),
      c17: document.getElementById('est-dia-corte-17'),
      cvot: document.getElementById('est-dia-cierre-vot'),
      chora: document.getElementById('est-dia-cierre-hora'),
      cobs: document.getElementById('est-dia-cierre-obs'),
    };

    const store = getStoredEst();
    const existing = store[actaKey(ctx.sec, ctx.cas)] || {};

    inputs.estatus.value = existing.DIA_ESTATUS || 'SIN_REPORTE';
    inputs.apHora.value = existing.DIA_APERTURA_HORA || '';
    inputs.apObs.value  = existing.DIA_APERTURA_OBS || '';
    inputs.c11.value    = existing.DIA_CORTE_11 ?? '';
    inputs.c13.value    = existing.DIA_CORTE_13 ?? '';
    inputs.c17.value    = existing.DIA_CORTE_17 ?? '';
    inputs.cvot.value   = existing.DIA_CIERRE_VOTANTES ?? '';
    inputs.chora.value  = existing.DIA_CIERRE_HORA || '';
    inputs.cobs.value   = existing.DIA_CIERRE_OBS || '';

    // centrar la primera vez
    if (!modal.dataset.pos){
      const w = modal.offsetWidth || 640;
      const h = modal.offsetHeight || 520;
      modal.style.left = Math.max(12, (window.innerWidth - w)/2) + 'px';
      modal.style.top  = Math.max(12, (window.innerHeight - h)/2) + 'px';
      modal.dataset.pos = '1';
    }

    backdrop.style.display = 'flex';

    const close = ()=>{ backdrop.style.display = 'none'; };
    document.querySelector('#estatus-modal-backdrop .est-close').onclick = close;
    document.getElementById('est-cancel').onclick = close;
    document.getElementById('est-save').onclick = ()=>{
      const all = getStoredEst();
      all[actaKey(ctx.sec, ctx.cas)] = {
        DIA_ESTATUS: inputs.estatus.value,
        DIA_APERTURA_HORA: inputs.apHora.value || null,
        DIA_APERTURA_OBS: inputs.apObs.value || '',
        DIA_CORTE_11: inputs.c11.value ? Number(inputs.c11.value) : null,
        DIA_CORTE_13: inputs.c13.value ? Number(inputs.c13.value) : null,
        DIA_CORTE_17: inputs.c17.value ? Number(inputs.c17.value) : null,
        DIA_CIERRE_VOTANTES: inputs.cvot.value ? Number(inputs.cvot.value) : null,
        DIA_CIERRE_HORA: inputs.chora.value || null,
        DIA_CIERRE_OBS: inputs.cobs.value || '',
      };
      saveStoredEst(all);
      close();
    };

    // drag
    (function wireDrag(){
      if (modal.__wiredDrag) return;
      const hdr = modal.querySelector('.am-hdr');
      let dragging = false, sx=0, sy=0, px=0, py=0;
      hdr?.addEventListener('mousedown', (e)=>{
        dragging = true;
        sx = e.clientX; sy = e.clientY;
        const r = modal.getBoundingClientRect();
        px = r.left; py = r.top;
        document.body.style.userSelect = 'none';
      });
      window.addEventListener('mousemove', (e)=>{
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        modal.style.left = (px + dx) + 'px';
        modal.style.top  = (py + dy) + 'px';
      });
      window.addEventListener('mouseup', ()=>{ dragging=false; document.body.style.userSelect=''; });
      modal.__wiredDrag = true;
    })();

    // resize
    (function wireResize(){
      if (modal.__wiredResize) return;
      const handle = modal.querySelector('.est-resizer');
      if (!handle) return;
      let resizing = false, sx=0, sy=0, sw=0, sh=0;
      handle.addEventListener('mousedown', (e)=>{
        resizing = true;
        sx = e.clientX; sy = e.clientY;
        const r = modal.getBoundingClientRect();
        sw = r.width; sh = r.height;
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e)=>{
        if (!resizing) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        modal.style.width = Math.max(520, sw + dx) + 'px';
        modal.style.height = Math.max(400, sh + dy) + 'px';
      });
      window.addEventListener('mouseup', ()=>{ resizing=false; });
      modal.__wiredResize = true;
    })();
  }

// ===== Mini-selector de universo dentro del módulo =====
    let __mini = { selMun:null, selDf:null, selDl:null, all:null };

    function uniqueSorted(values){
    const arr = values.map(v => String(v ?? '').trim()).filter(Boolean);
    const set = Array.from(new Set(arr));
    return set.sort((a,b) => (isFinite(a)&&isFinite(b)) ? Number(a)-Number(b) : a.localeCompare(b,'es'));
    }
    function buildMiniOptions(raw){
    const feats = raw.features || [];
    const grab = k => uniqueSorted(feats.map(f => f.properties?.[k]));
    return { mun: grab(FIELD_KEYS.mun), df: grab(FIELD_KEYS.df), dl: grab(FIELD_KEYS.dl) };
    }
    function fillSelect(sel, arr){
    sel.innerHTML = '<option value="">— Ninguno —</option>' + arr.map(v=>`<option value="${v}">${v}</option>`).join('');
    }
    function getMiniUniverse(){
    const { selMun, selDf, selDl, all } = __mini;
    if(all.checked) return { scope:'ALL', key:null, label:'Estado completo' };
    if(selMun.value) return { scope:'MUN', key: selMun.value, label:`Municipio ${selMun.options[selMun.selectedIndex].text}` };
    if(selDf.value)  return { scope:'DF',  key: selDf.value,  label:`Distrito Federal ${selDf.value}` };
    if(selDl.value)  return { scope:'DL',  key: selDl.value,  label:`Distrito Local ${selDl.value}` };
    return null;
    }
    function miniExclusivity(which){
    const { selMun, selDf, selDl, all } = __mini;
    if(which==='ALL'){ selMun.value=''; selDf.value=''; selDl.value=''; }
    if(which==='MUN'){ selDf.value=''; selDl.value=''; all.checked=false; }
    if(which==='DF'){  selMun.value=''; selDl.value=''; all.checked=false; }
    if(which==='DL'){  selMun.value=''; selDf.value=''; all.checked=false; }
    applyMiniUniverse();
    }
    function applyMiniUniverse(){
    const u2 = getMiniUniverse();
    if(!u2) return;
    // 1) Persistir
    localStorage.setItem('AT_UNIVERSE', JSON.stringify({ ...u2, ts:Date.now() }));
    // 2) Redibujar con el nuevo universo usando el raw ya cargado
    const atMap = ensureLeafletMap();
    const filtered2 = filterGeojson(window.AT_DATA, u2);
    if (window.AT_CTX?.layer) { atMap.removeLayer(AT_CTX.layer); }
    const layer2 = L.geoJSON(filtered2, { style:{ color:'#7d0025', weight:1.2, fillOpacity:0.15 } }).addTo(atMap);
    try { atMap.fitBounds(layer2.getBounds(), { padding:[20,20] }); } catch(e){}
    window.AT_CTX = { ...(window.AT_CTX||{}), universe: u2, layer: layer2 };
    // 3) Header
    const hdr = document.querySelector('#panel-header span');
    if(hdr){ hdr.textContent = `Análisis Territorial · ${u2.label}`; }
      refreshSectionSearch(u2);
    }
    function initMiniSelector(raw, u){
    // Guardar el geojson bruto para futuros re-filtros
    window.AT_DATA = raw;

    __mini.selMun = document.getElementById('mini-sel-mun');
    labelMunicipiosFromCatalog('#mini-sel-mun');

    __mini.selDf  = document.getElementById('mini-sel-df');
    __mini.selDl  = document.getElementById('mini-sel-dl');
    __mini.all    = document.getElementById('mini-all-state');

    const opt = buildMiniOptions(raw);
    fillSelect(__mini.selMun, opt.mun);
    fillSelect(__mini.selDf,  opt.df);
    fillSelect(__mini.selDl,  opt.dl);

    // Reflejar el universo actual
    if(u.scope==='ALL'){ __mini.all.checked = true; }
    if(u.scope==='MUN'){ __mini.selMun.value = String(u.key); }
    if(u.scope==='DF'){  __mini.selDf.value  = String(u.key); }
    if(u.scope==='DL'){  __mini.selDl.value  = String(u.key); }


    
        async function labelMunicipiosFromCatalog(selectId){
        const sel = document.querySelector(selectId);
        if (!sel) return;

        // 1) Ruta del catálogo desde el Portal (AT_PATHS) o fallback
        let catUrl = '../data/catalogo_territorial.json';
        try {
            const paths = JSON.parse(localStorage.getItem('AT_PATHS') || '{}');
            if (paths?.catalog) catUrl = paths.catalog;
        } catch {}

        // 2) Cargar catálogo
        let cat = null;
        try {
            const r = await fetch(catUrl);
            if (!r.ok) throw new Error('HTTP '+r.status);
            cat = await r.json();
        } catch (e) {
            console.warn('[AT] No se pudo cargar el catálogo:', e);
            return; // salimos sin tocar etiquetas
        }

        const mapa = cat?.municipios || {};
        // helper: si el catálogo trae ceros a la izquierda en las llaves
        const getName = (code) => {
            const s = String(code);
            return mapa[s] || mapa[s.padStart(2,'0')] || mapa[s.padStart(3,'0')] || s;
        };

        // 3) Reetiquetar opciones (sin cambiar value)
        for (const opt of sel.options) {
            if (!opt.value) continue; // deja "— Ninguno —"
            const name = getName(opt.value);
            opt.text = `${opt.value} — ${name}`;
        }
        }

   

    // Eventos (auto-ejecuta)
    __mini.selMun.addEventListener('change', ()=> miniExclusivity('MUN'));
    __mini.selDf .addEventListener('change', ()=> miniExclusivity('DF'));
    __mini.selDl .addEventListener('change', ()=> miniExclusivity('DL'));
    __mini.all   .addEventListener('change', ()=> miniExclusivity('ALL'));
    }


    // Nombre fijo del campo (texto) del municipio
    const MUN_NAME_KEY = 'MUNICIPIO';

    // Detecta automáticamente el campo de CÓDIGO de municipio (si no, usa el nombre)
    function detectMunCodeKey(raw){
    const feats = raw.features || [];
    const candidates = ['MUN','CVE_MUN','CLV_MUN','ID_MUN','MUNICIPIO_ID','MUNICIPIO_CVE','CVE_MUNICIPIO','CVE_MPIO'];
    for (const k of candidates) {
        const ok = feats.some(f => {
        const v = f.properties?.[k];
        return v != null && String(v).trim() !== '' && String(v).toUpperCase() !== 'NULL';
        });
        if (ok) return k;
    }
    return null; // fallback será MUN_NAME_KEY
    }



      // —— Utils de texto ——
      function _norm(s){
        if (s==null) return '';
        return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
      }
      function _isDigits(s){ return /^[0-9]+$/.test(String(s||'')); }

      // —— Nombre de municipio desde catálogo (si existe) ——
      function getMunNameFromCatalog(code){
        const cat = window.AT_CATALOG;
        if (!cat?.municipios) return String(code ?? '');
        const s = String(code);
        // maneja posibles ceros a la izquierda
        return cat.municipios[s] || cat.municipios[s.padStart(2,'0')] || cat.municipios[s.padStart(3,'0')] || s;
      }

      // —— Índice de secciones ——
      let __SEC_INDEX = { items: [], global: false };

      function buildSectionIndex(raw, universe, useGlobal){
        const feats = (raw?.features || []);
        const munKey = (window.AT_KEYS?.munCode) || FIELD_KEYS.mun;
        const items = [];

        // dataset base: global = todas, local = filtradas por universo
        const base = useGlobal ? feats : (filterGeojson(raw, universe).features || []);

        for(const f of base){
          const p = f.properties || {};
          const sec = p.SECCION ?? p.Seccion ?? p.seccion ?? null;
          if (sec == null) continue;

          const munCode = p[munKey];
          const munName = getMunNameFromCatalog(munCode);
          const df = p[FIELD_KEYS.df];
          const dl = p[FIELD_KEYS.dl];

          // texto para búsqueda
          const text = `${sec} ${munCode ?? ''} ${munName ?? ''} ${df ?? ''} ${dl ?? ''}`;
          // bounds (si multiparte, Leaflet lo resuelve)
          let bounds = null;
          try { bounds = L.geoJSON(f).getBounds(); } catch(_){}

          items.push({
            sec: String(sec).trim(),
            munCode: munCode,
            munName: munName,
            df, dl, feature: f, textNorm: _norm(text), bounds
          });
        }

        __SEC_INDEX = { items, global: !!useGlobal };
      }

      function searchSections(query, limit=15){
        const q = _norm(query);
        if (!q) return [];
        const ds = __SEC_INDEX.items;

        // Heurística sencilla:
        // - si es numérico puro: prioridad a SECCION que empiece con q
        // - si no: contiene tokens
        if (_isDigits(q)){
          const starts = ds.filter(it => _norm(it.sec).startsWith(q));
          if (starts.length >= limit) return starts.slice(0, limit);
          const contains = ds.filter(it => _norm(it.sec).includes(q));
          return [...starts, ...contains].slice(0, limit);
        } else {
          const tokens = q.split(/\s+/).filter(Boolean);
          return ds.filter(it => tokens.every(t => it.textNorm.includes(t))).slice(0, limit);
        }
      }

      // —— UI de sugerencias ——
      let __SEC_HIGHLIGHT = null;

      function renderSecSuggestions(list){
        const ul = document.getElementById('sec-suggest');
        if (!ul) return;
        if (!list.length){ ul.style.display='none'; ul.innerHTML=''; return; }

        ul.innerHTML = list.map(it => {
          const label = `${it.sec} — ${it.munName || it.munCode || ''}`.replace(/\s+-\s+$/, '');
          const meta  = [];
          if (it.dl!=null) meta.push(`DL ${it.dl}`);
          if (it.df!=null) meta.push(`DF ${it.df}`);
          const sub = meta.length ? `<small style="color:#64748b">${meta.join(' · ')}</small>` : '';
          return `<li data-sec="${it.sec}" style="padding:6px 8px; border-bottom:1px solid #e5e7eb; cursor:pointer">
                    <div>${label}</div>${sub}
                  </li>`;
        }).join('');
        ul.style.display = 'block';


      }

    function gotoSection(item){
      const atMap = (window.AT_CTX?.map) || ensureLeafletMap();

      // 1) Resolver el feature de la sección
      const sec = String(item.sec ?? item.SECCION ?? '');
      let feat = item.feature;

      if (!feat) {
        const feats =
          (window.AT_CTX?.layer?.toGeoJSON?.().features) ||
          (window.AT_DATA?.features) || [];
        feat = feats.find(f => String(f.properties?.SECCION) === sec);
      }

      if (!feat) {
        console.warn('[AT] No encontré el feature para la sección', sec, item);
        return;
      }

      // 2) Pintar selección + adyacentes + labels (esto limpia overlays previos)
      paintSelectionAndAdj(feat);

      // 3) Mostrar panel con DF, DL y LN (24DL_LN)
      showSectionInfo(feat);

      // 4) Feedback visual (parpadeo leve sobre el highlight actual)
      const hl = window.__SEC_HL;
      if (hl && typeof hl.setStyle === 'function') {
        try {
          hl.setStyle({ weight: 4 });
          setTimeout(() => { try { hl.setStyle({ weight: 3 }); } catch(_){} }, 220);
        } catch(_){}
      }

      // 5) Oculta la lista de sugerencias (si está visible)
      const ul = document.getElementById('sec-suggest');
      if (ul) ul.style.display = 'none';
    }


      // Delegación de clic en las sugerencias (una sola vez)
    (function wireSectionSearchEventsOnce(){
      const ul = document.getElementById('sec-suggest');
      const input = document.getElementById('sec-q');
      if (!ul || !input) return;

       // Si está dentro de un form, evita submit al Enter
      const form = input.closest('form');
      form?.addEventListener('submit', e => e.preventDefault());

      // Clic en cualquier <li data-sec="...">
      if (!ul.__wiredClick){
        ul.addEventListener('click', (ev)=>{
          const li = ev.target.closest('li[data-sec]');
          if (!li) return;
          const sec = li.getAttribute('data-sec');
          const item = (__SEC_INDEX?.items||[]).find(x => String(x.sec) === String(sec));
          if (item) gotoSection(item);
          ul.style.display = 'none';
        });
        ul.__wiredClick = true;
      }

      // Enter en el input = ir al primer resultado
      if (!input.__wiredKey){
        input.addEventListener('keydown', (ev)=>{
          if (ev.key === 'Enter'){
            ev.preventDefault(); // <- evita submit/autocomplete
            const results = searchSections(input.value, 1);
        const needle = currentNeedle(input.value);
        const [first] = searchSections(needle, 1);
        if (first) gotoSection(first);
        ul.style.display = 'none';
       }
          if (ev.key === 'Escape'){
            ul.style.display = 'none';
          }
        });
        input.__wiredKey = true;
      }

      // Input: recalcula sugerencias usando el "último token"
      if (!input.__wiredInput){
        input.addEventListener('input', ()=>{
          const needle = currentNeedle(input.value);
          renderSecSuggestions(searchSections(needle, 15));
        });
        input.__wiredInput = true;
      }
    })();


      // —— Inicializar Buscador en el módulo ——
      function initSectionSearch(raw, universe){
        const input   = document.getElementById('sec-q');
        const list    = document.getElementById('sec-suggest');
        const globalC = document.getElementById('sec-global');
        if (!input || !list) return;

        // construir índice (por universo actual)
        buildSectionIndex(raw, universe, !!globalC?.checked);



        // Cambiar ámbito (global / universo actual)
        globalC?.addEventListener('change', () => {
          buildSectionIndex(raw, universe, !!globalC.checked);
          // refresca sugerencias con la query actual
          if (input.value){
            renderSecSuggestions(searchSections(input.value, 15));
          }
        });
      }

      // —— Cuando cambies de universo con tu mini-selector, reindexa ——
      function refreshSectionSearch(universe){
        const input   = document.getElementById('sec-q');
        const globalC = document.getElementById('sec-global');
        if (!window.AT_DATA || !input) return;
        buildSectionIndex(window.AT_DATA, universe, !!globalC?.checked);
        if (input.value){
          renderSecSuggestions(searchSections(input.value, 15));
        }
      }


      function getRawForIndex(){
        // Usa el dataset completo si ya lo cacheaste
        if (window.AT_DATA) return window.AT_DATA;
        // Si no, al menos usa lo ya pintado en el mapa
        const lyr = window.AT_CTX?.layer;
        return (lyr && typeof lyr.toGeoJSON === 'function') ? lyr.toGeoJSON() : null;
  }


  // ===== 3) Boot =====
  document.addEventListener('DOMContentLoaded', async () => {
    AT_dockPanel(document.getElementById('sec-info'));
    AT_dockPanel(document.getElementById('casillas-panel'));
    AT_watchDockPanels();

    // a) Leer universo y rutas puestos en el PORTAL
    const u     = JSON.parse(localStorage.getItem('AT_UNIVERSE') || 'null');
    const paths = JSON.parse(localStorage.getItem('AT_PATHS') || '{"geo":""}');
    if (!u) {
      const hdr = document.querySelector('#panel-header span');
      hdr && (hdr.textContent += ' · selecciona el universo en el Portal');
      setTimeout(()=>{ location.href = '../portal/portal.html'; }, 600);
      return;
    }

    // b) Etiqueta del universo
    const hdr = document.querySelector('#panel-header span');
    hdr && (hdr.textContent += ` · ${u.label}`);

    // c) Mapa único
    const atMap = ensureLeafletMap();
    assertIsLeafletMap(atMap);

    // d) Cargar y filtrar GeoJSON
    const url = paths.geo || '../data/geo/secciones.geojson'; // <-- ajusta si tu ruta difiere

    // Cargar catálogo territorial (para nombres visibles)
    const catUrl = (paths.catalog && paths.catalog.trim()) || '/data/catalogo_territorial.json';
    let catalog = window.AT_CATALOG || null;
    if (!catalog) {
    try {
        const rc = await fetch(catUrl);
        if (!rc.ok) throw new Error(`HTTP ${rc.status} al cargar catálogo ${catUrl}`);
        catalog = await rc.json();
        window.AT_CATALOG = catalog;
    } catch (err) {
        console.warn('[AT] No se pudo cargar el catálogo de nombres:', err);
        window.AT_CATALOG = catalog = null; // seguimos sin nombres amigables
    }
    }


 let raw = window.AT_DATA || null; // usa caché si ya existe
if (!raw) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${url}`);
    raw = await res.json();       // ✅ solo una vez
    window.AT_DATA = raw;         // ✅ guarda en caché aquí
  } catch (err) {
    console.error('[AT] Error cargando GeoJSON:', err);
    alert('No se pudo cargar el GeoJSON');
    return;
  }
}
// a partir de aquí, usa 'raw'

    const filtered = filterGeojson(raw, u);
    console.log('[AT] Universo:', u, 'Total:', raw.features?.length||0, 'Filtradas:', filtered.features?.length||0);

    if(!filtered.features || filtered.features.length===0){
      console.warn('[AT] No hay geometrías para el universo seleccionado:', u);
      alert('No hay datos para el universo seleccionado');
    }

    // Nombre fijo del campo (texto) del municipio
        const MUN_NAME_KEY = 'MUNICIPIO';

    // Detecta campo de CÓDIGO (si existe); si no, usa el de nombre
        function detectMunCodeKey(raw){
        const feats = raw.features || [];
        const candidates = ['MUN','CVE_MUN','CLV_MUN','ID_MUN','MUNICIPIO_ID','MUNICIPIO_CVE','CVE_MUNICIPIO','CVE_MPIO'];
        for (const k of candidates) {
            if (feats.some(f => (f.properties?.[k] ?? '') !== '')) return k;
        }
        return null;
        }

        const munCodeKey = detectMunCodeKey(raw) || MUN_NAME_KEY; // fallback: nombre
        FIELD_KEYS.mun = munCodeKey;
        window.AT_KEYS = { munCode: munCodeKey, munName: MUN_NAME_KEY };


    // e) Dibujar capa
        const layer = L.geoJSON(filtered, {
      style: { color:'#000000', weight:1.2, fillOpacity:0.15 },
      onEachFeature: (feat, lyr) => {
        const p = feat.properties || {};
        const muni = p[FIELD_KEYS.mun] ?? '—';
        const dl   = p[FIELD_KEYS.dl]  ?? '—';
        const df   = p[FIELD_KEYS.df]  ?? '—';
        lyr.bindPopup(`<b>Sección</b>: ${p.SECCION ?? '—'}<br><b>Mun</b>: ${muni}<br><b>DL</b>: ${dl}<br><b>DF</b>: ${df}`);
        lyr.on('mouseover', () => lyr.setStyle({weight:2}));
        lyr.on('mouseout',  () => lyr.setStyle({weight:1.2}));
      }
    }).addTo(atMap);

    try { atMap.fitBounds(layer.getBounds(), { padding:[20,20] }); } catch(e){}
    window.AT_CTX = { universe: u, paths, map: atMap, layer };

    function getMunNameFromCatalog(code){
  const cat = window.AT_CATALOG;
  if (!cat?.municipios) return String(code ?? '');
  return cat.municipios[String(code)] || String(code ?? '');
}
function getDfListFromCatalog(feats){
  return (window.AT_CATALOG?.distritos_federales && window.AT_CATALOG.distritos_federales.length)
    ? window.AT_CATALOG.distritos_federales
    : uniqSorted(feats.map(f => f.properties?.[FIELD_KEYS.df]));
}
function getDlListFromCatalog(feats){
  return (window.AT_CATALOG?.distritos_locales && window.AT_CATALOG.distritos_locales.length)
    ? window.AT_CATALOG.distritos_locales
    : uniqSorted(feats.map(f => f.properties?.[FIELD_KEYS.dl]));
}
    initMiniSelector(raw, u);
    initSectionSearch(window.AT_DATA || raw, u);

  });

  (function wireATHotkeys(){
      if (window.__AT_HOTKEYS) return;
      window.__AT_HOTKEYS = true;

      window.addEventListener('keydown', (e)=>{
        // Esc: cerrar panel
        if (e.key === 'Escape'){
          if (document.getElementById('sec-info')?.style.display !== 'none'){
            e.preventDefault();
            closeSecInfoPanel();
          }
        }
        // Ctrl+K (o Cmd+K en Mac): enfocar buscador de secciones
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){
          e.preventDefault();
          document.getElementById('sec-q')?.focus();
        }
      });
    })();


  

// ---- inline block separator ----

  // cerrar panel casillas
  (function wireCasillasPanel(){
    const panel = document.getElementById('casillas-panel');
    const btn = panel?.querySelector('.cp-close');
    if (!panel || !btn) return;
    btn.addEventListener('click', ()=>{ panel.style.display = 'none'; });

    // drag
    const hdr = panel.querySelector('.cp-hdr');
    let dragging = false, sx=0, sy=0, px=0, py=0;
    hdr?.addEventListener('mousedown', (e)=>{
      if (AT_isDockedPanel(panel)) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect();
      px = r.left; py = r.top;
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e)=>{
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      panel.style.left = (px + dx) + 'px';
      panel.style.top  = (py + dy) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.position = 'absolute';
    });
    window.addEventListener('mouseup', ()=>{
      dragging = false;
      document.body.style.userSelect = '';
    });
  })();

  // Toolbar: botón para cargar casillas Abasolo
  (function wireToolbarCasillas(){
    const btn = document.getElementById('btn-cargar-casillas');
    if (!btn) return;
    btn.addEventListener('click', loadCasillasAbasolo);
  })();
