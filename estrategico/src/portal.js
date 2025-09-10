// ===== Portal: versión robusta =====
const $ = s => document.querySelector(s);
const selMun = $('#sel-mun'), selDF = $('#sel-df'), selDL = $('#sel-dl');
const allState = $('#all-state');
const geoEl = $('#geo'), catEl = $('#catalog');
const mods = document.querySelector('#mods');

let GJ_CACHE = null; // cache ligero del geojson para la vista previa


console.log('[PORTAL] boot');
window.AT = { ping: () => console.log('[PORTAL] pong'), ver: 'portal-r1' }; // para debug

async function previewUniverse(){
  const sum = document.querySelector('#u-sum');
  if (!sum) return;

  try{
    if (!GJ_CACHE){
      const res = await fetch(geoEl.value);
      if(!res.ok) throw new Error('HTTP '+res.status);
      GJ_CACHE = await res.json();
    }
    const feats = GJ_CACHE.features || [];
    let label = '—', n = 0;

    if (allState.checked){
      label = 'Estado completo';
      n = feats.length;
    } else if (selMun.value){
      label = selMun.options[selMun.selectedIndex].text;
      n = feats.filter(f => String((f.properties||{}).MUNICIPIO) === String(selMun.value)).length;
    } else if (selDF.value){
      label = 'DF ' + selDF.options[selDF.selectedIndex].text;
      n = feats.filter(f => String((f.properties||{}).DISTRITO_F) === String(selDF.value)).length;
    } else if (selDL.value){
      label = 'DL ' + selDL.options[selDL.selectedIndex].text;
      n = feats.filter(f => String((f.properties||{}).DISTRITO_L) === String(selDL.value)).length;
    }

    sum.textContent = `Universo: ${label} · ${n} secciones`;
  }catch(e){
    console.warn('[PORTAL] previewUniverse:', e.message);
    document.querySelector('#u-sum').textContent = 'Universo: (no disponible)';
  }
}


init();

function init(){
  // 1) Exclusividad (mantén esta línea)
  [selMun, selDF, selDL].forEach(sel =>
    sel.addEventListener('change', onExclusiveSelect)
  );

  // 2) Actualiza el resumen cuando cambie cualquiera (AGREGA esta línea)
  [selMun, selDF, selDL, allState].forEach(el =>
    el.addEventListener('change', previewUniverse)
  );

  // 3) Estado completo deshabilita selects + refresca resumen
  allState.addEventListener('change', () => {
    const on = allState.checked;
    [selMun, selDF, selDL].forEach(s => { s.disabled = on; if (on) s.value = ''; });
    previewUniverse(); // ← importante
  });


}


function onExclusiveSelect(ev){
  const who = ev.target.id;
  if (who === 'sel-mun' && selMun.value){ selDF.value=''; selDL.value=''; }
  if (who === 'sel-df'  && selDF.value){  selMun.value=''; selDL.value=''; }
  if (who === 'sel-dl'  && selDL.value){  selMun.value=''; selDF.value=''; }
  if (selMun.value || selDF.value || selDL.value) allState.checked = false;
}

async function loadOptions(){
  const catURL = (catEl.value || 'config/catalogo_territorial.json').trim();
  console.log('[PORTAL] leyendo catálogo:', catURL);

  let catalog;
  try{
    const res = await fetch(catURL, { cache: 'no-cache' });
    console.log('[PORTAL] catalog HTTP', res.status);
    if(!res.ok) throw new Error('HTTP '+res.status);
    catalog = await res.json();
  }catch(e){
    console.error('[PORTAL] error cargando catálogo', e);
    alert('No pude cargar el catálogo territorial. Revisa la ruta.');
    return;
  }

  // Validación mínima
  const okMun = catalog && typeof catalog.municipios === 'object';
  const okDF  = Array.isArray(catalog?.distritos_federales);
  const okDL  = Array.isArray(catalog?.distritos_locales);
  if (!okMun || !okDF || !okDL){
    console.warn('[PORTAL] claves faltantes en catálogo:', Object.keys(catalog||{}));
    alert('El catálogo debe tener: municipios (obj), distritos_federales (array), distritos_locales (array).');
    return;
  }

  // Municipios: objeto id->nombre
  const munPairs = Object.entries(catalog.municipios).map(([id,name]) => [String(id), String(name)]);
  munPairs.sort((a,b)=> (+a[0]) - (+b[0]));
  fillSelect(selMun, munPairs, ([id,name]) => `${id} — ${name}`);

  // DF / DL: arrays
  const dflist = [...catalog.distritos_federales].map(n => String(n)).sort((a,b)=> (+a) - (+b));
  const dllist = [...catalog.distritos_locales ].map(n => String(n)).sort((a,b)=> (+a) - (+b));
  fillSelect(selDF, dflist, id => id.toString().padStart(2,'0'));
  fillSelect(selDL, dllist, id => id.toString().padStart(2,'0'));

  // habilita tarjetas
  setModulesEnabled(true);

  console.log('[PORTAL] listas cargadas -> mun:', munPairs.length, 'df:', dflist.length, 'dl:', dllist.length);
  alert('Opciones cargadas del catálogo.');

  GJ_CACHE = null;           // por si cambió la ruta del geojson
  await previewUniverse();   // mostrar conteo al usuario

}

function fillSelect(sel, items, labelFn){
  sel.innerHTML = '<option value="">— Ninguno —</option>';
  items.forEach(item => {
    const id   = Array.isArray(item) ? item[0] : item;
    const text = labelFn ? labelFn(item) : String(id);
    const opt = document.createElement('option');
    opt.value = String(id);
    opt.textContent = text;
    sel.appendChild(opt);
  });
}

function setModulesEnabled(enabled){
  document.querySelectorAll('#mods .mod').forEach(card => {
    card.classList.toggle('disabled', !enabled);
    const btn = card.querySelector('.mod-btn');
    if (btn) btn.disabled = !enabled;
  });
  console.log('[PORTAL] módulos', enabled ? 'habilitados' : 'deshabilitados');
}

function getChosenFilter(){
  if (allState.checked) return { level:'ESTADO', id:'', label:'Estado completo' };
  if (selMun.value) return { level:'MUNICIPIO', id: selMun.value, label: selMun.options[selMun.selectedIndex].text };
  if (selDF.value)  return { level:'DF',        id: selDF.value,  label: 'DF ' + selDF.options[selDF.selectedIndex].text };
  if (selDL.value)  return { level:'DL',        id: selDL.value,  label: 'DL ' + selDL.options[selDL.selectedIndex].text };
  return null;
}

function openModule(moduleId){
  // si no se han cargado las opciones, los botones siguen deshabilitados
  if (mods.querySelector('.mod-btn[disabled]')) {
    alert('Primero haz clic en "Cargar opciones".');
    return;
  }
  const choice = getChosenFilter();
  if (!choice) { alert('Elige Municipio o DF o DL, o marca Estado completo.'); return; }

  const cfg = {
    datasets: { geojson: geoEl.value.trim() || 'data/secciones.geojson' },
    filter: choice,
    module: { id: moduleId }
  };
  localStorage.setItem('at_portal', JSON.stringify(cfg));
  location.href = 'index.html';
}
