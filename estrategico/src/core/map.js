// src/core/map.js
function showBanner(msg, color = '#b91c1c') {
  let n = document.getElementById('at-banner');
  if (!n) {
    n = document.createElement('div');
    n.id = 'at-banner';
    n.style.cssText = 'position:fixed;left:16px;bottom:16px;padding:8px 12px;border-radius:10px;color:#fff;font:12px system-ui;z-index:9999';
    document.body.appendChild(n);
  }
  n.style.background = color;
  n.textContent = msg;
}

export function createMap(elId, cfg){
  const map = L.map(elId, { minZoom: 5, maxZoom: 19 });
  map.setView([21.0, -101.0], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);
  return map;
}

function boundsFromCoords(coords, isLonLat = true) {
  let minX=+Infinity, minY=+Infinity, maxX=-Infinity, maxY=-Infinity;
  const walk = a => Array.isArray(a) && typeof a[0] === 'number'
    ? [[a[0], a[1]]]
    : a.flatMap(walk);
  const pts = walk(coords);
  for (const [x,y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export async function loadGeoJSON(map, cfg){
  try {
    const url = cfg.datasets.geojson;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${url}`);
    const text = await res.text();
    let gj;
    try { gj = JSON.parse(text); }
    catch (e) { showBanner('El archivo no es JSON válido', '#000'); console.error(e); return; }

    // Detecta TopoJSON
    if (gj && gj.type === 'Topology') {
      showBanner('El archivo es TopoJSON (Topology). Convierte a GeoJSON EPSG:4326.', '#000');
      console.warn('TopoJSON detectado. Convierte en QGIS/Mapshaper a GeoJSON WGS84.');
      return;
    }

    // GeoJSON válido para Leaflet
    const layer = L.geoJSON(gj, {
      style: { color: '#f70c17ff', weight: 2, fillOpacity: 0.15 }, // más visible
      onEachFeature: (f, lyr) => {
        const secRaw = f.properties?.SECCION ?? f.properties?.seccion ?? f.properties?.SEC ?? '';
        const sec = String(secRaw).replace(/\D/g,'').padStart(4,'0');
        if (sec) lyr.bindTooltip(`Sección ${sec}`, { sticky: true, direction: 'top' });
      }
    }).addTo(map);

    const count = layer.getLayers().length;
    console.log('[AT] GeoJSON cargado. Features:', count);
    if (!count) {
      showBanner('GeoJSON cargó pero no tiene features', '#b45309');
      return;
    }

    // Revisa rangos de coordenadas para detectar CRS incorrecto
    // Toma la primera geometría
    const g0 = (gj.features?.[0]?.geometry) || gj.geometry;
    if (g0 && g0.coordinates) {
      const bb = boundsFromCoords(g0.coordinates);
      const looksLonLat = Math.max(Math.abs(bb.minX), Math.abs(bb.maxX)) <= 180
                       && Math.max(Math.abs(bb.minY), Math.abs(bb.maxY)) <= 90;
      if (!looksLonLat) {
        showBanner('Coordenadas no parecen lon/lat. Reproyecta a EPSG:4326.', '#b91c1c');
        console.warn('Rangos detectados', bb);
      }
    }

    // encuadre
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [12,12] });
      showBanner(`GeoJSON OK · ${count} features`, '#166534'); // verde
      setTimeout(()=>{ const b = document.getElementById('at-banner'); if (b) b.remove(); }, 3000);
    } else {
      showBanner('No pude calcular bounds del GeoJSON', '#b45309');
    }

    map.__sectionsLayer = layer;
  } catch (e) {
    showBanner('Error cargando GeoJSON (ver consola)', '#b91c1c');
    console.error('[AT] Error cargando GeoJSON:', e);
  }
}
