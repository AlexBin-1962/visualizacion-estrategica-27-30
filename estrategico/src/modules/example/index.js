import { loadSectionsModel } from "../../services/dataService.js";

export async function run({ map, cfg, mode='analisis' }) {
  const data = await loadSectionsModel(cfg.datasets.sections, cfg.allowedSections);
  if (!data.rows.length) { alert("No hay filas (revisa filtro o CSV)."); return; }

  const panel = ensurePanel(); panel.innerHTML="";
  panel.appendChild(el("div",{class:"blk"}, `<h3 style="margin:0 0 8px">${mode.toUpperCase()}</h3>`));

  // ★ Universo seleccionado
  const universo = cfg.filter?.label || 'Estado completo';
  const nsecs = cfg.allowedSections ? cfg.allowedSections.size : data.rows.length;
  panel.appendChild(el("div",{class:"blk"}, `<div style="font-size:12px;color:#6b7280">Universo: <b>${universo}</b> · ${nsecs} secciones</div>`));

  // ... lo que ya tenías (input sección, render, etc.)
  // (no muevo nada de abajo)
  const form = el("div",{class:"blk"});
  form.appendChild(el("label",{style:"font-size:12px;color:#6b7280"},"Sección"));
  const input = el("input",{type:"text",placeholder:"ej. 0123",style:"width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:10px;margin-top:6px"});
  form.appendChild(input);
  const out = el("div",{class:"blk"}); panel.appendChild(form); panel.appendChild(out);

  function show(sec){
    const row = data.rows.find(r => r.SECCION === sec);
    if (!row){ out.innerHTML = `<div style="color:#6b7280;font-size:12px">Sección no encontrada…</div>`; return; }
    out.innerHTML = renderRow(row, data.parties);
  }

  input.addEventListener("input", ()=>{
    const sec = (input.value||"").replace(/\D/g,"").padStart(4,"0");
    show(sec);
  });

  window.addEventListener("section:selected", ev => {
    input.value = ev.detail.sec;
    input.dispatchEvent(new Event("input"));
  });

  input.value = data.rows[0].SECCION;
  input.dispatchEvent(new Event("input"));
}


// helpers UI
function ensurePanel() {
  let panel = document.getElementById("at-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "at-panel";
    panel.style.cssText = `
      position:absolute; top:96px; left:16px; width:320px; background:#fff; 
      border:1px solid #e5e7eb; border-radius:16px; box-shadow:0 8px 30px rgba(0,0,0,.08);
      padding:12px; z-index:6000; font-size:14px;
    `;
    document.body.appendChild(panel);
  }
  return panel;
}
function el(tag, attrs = {}, html = "") {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (html) n.innerHTML = html;
  return n;
}
function renderRow(r, parties) {
  // top-2 partidos
  const pares = parties.map(p => [p, +r[p] || 0]);
  const top = pares.sort((a, b) => b[1] - a[1]).slice(0, 2);
  const topTxt = top.map(([p, v], i) => `<span style="font-weight:${i ? 400 : 700}">${p}</span>: ${v.toLocaleString()}`).join(" · ");

  const partyRows = parties.map(p => `
    <tr><td>${p}</td><td style="text-align:right">${(+r[p]||0).toLocaleString()}</td></tr>
  `).join("");

  return `
    <div style="margin:8px 0 12px 0">
      <div><b>SECCIÓN:</b> ${r.SECCION}</div>
      ${"LISTA_NOMINAL" in r ? `<div><b>LN:</b> ${(+r.LISTA_NOMINAL||0).toLocaleString()}</div>` : ""}
      <div><b>Votos totales:</b> ${(+r.TOTAL_VOTOS_CALCULADOS||0).toLocaleString()}</div>
      ${"PARTICIPACION" in r ? `<div><b>Participación:</b> ${(+r.PARTICIPACION||0).toFixed(2)}%</div>` : ""}
      <div style="margin-top:6px;color:#6b7280">${topTxt}</div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="text-align:left;border-bottom:1px solid #eee">Partido</th><th style="text-align:right;border-bottom:1px solid #eee">Votos</th></tr></thead>
      <tbody>${partyRows}</tbody>
    </table>
  `;
}
