      // =============================
      // Carga de catálogo territorial
      // =============================
      document.addEventListener("DOMContentLoaded", function () {
        fetch("../data/catalogo_territorial.json")
          .then(response => response.json())
          .then(data => {
            cargarMunicipios(data.municipios);              // Llena el select de municipios
            cargarDistritos("sel-df", data.distritos_federales); // Llena el select de DF
            cargarDistritos("sel-dl", data.distritos_locales);   // Llena el select de DL

            // ✅ AQUÍ: ya existen allSt, selMun, selDf, selDl
            AT_initUniverseDefault();
          })
          .catch(error => console.error("Error al cargar el catálogo:", error));
      });


      // =============================
      // Funciones para llenar selects
      // =============================
      function cargarMunicipios(municipios) {
        const select = document.getElementById("sel-mun");
        Object.entries(municipios).forEach(([id, nombre]) => {
          const option = document.createElement("option");
          option.value = id;
          option.textContent = nombre;
          select.appendChild(option);
        });
      }

      function cargarDistritos(selectId, distritos) {
        const select = document.getElementById(selectId);
        distritos.forEach(num => {
          const option = document.createElement("option");
          option.value = num;
          option.textContent = `Distrito ${num}`;
          select.appendChild(option);
        });
      }

      // =============================
      // Habilitar/deshabilitar módulos
      // =============================
      document.addEventListener('DOMContentLoaded', function () {
        const selMun = document.getElementById('sel-mun');
        const selDf  = document.getElementById('sel-df');
        const selDl  = document.getElementById('sel-dl');

        // Habilita los módulos si hay selección
        function habilitarModulos() {
          const tarjetas = document.querySelectorAll('#mods .modcard');
          tarjetas.forEach(card => {
            card.classList.remove('disabled');
            const boton = card.querySelector('.mod-btn');
            boton.removeAttribute('disabled');
          });
        }

        // Deshabilita los módulos si no hay selección
        function deshabilitarModulos() {
          const tarjetas = document.querySelectorAll('#mods .modcard');
          tarjetas.forEach(card => {
            card.classList.add('disabled');
            const boton = card.querySelector('.mod-btn');
            boton.setAttribute('disabled', true);
          });
        }

        // Evalúa si hay selección válida
        function evaluarSeleccion() {
          const mun = selMun.value;
          const df  = selDf.value;
          const dl  = selDl.value;

          if (mun || df || dl) {
            habilitarModulos();
          } else {
            deshabilitarModulos();
          }
        }

        selMun.addEventListener('change', evaluarSeleccion);
        selDf.addEventListener('change', evaluarSeleccion);
        selDl.addEventListener('change', evaluarSeleccion);
      });
    

// ---- inline block separator ----

(function(){
  // Ajusta estos IDs a los que tengas en el portal:
  const selMun = document.getElementById('sel-mun') || document.getElementById('selMun');
  const selDf  = document.getElementById('sel-df')  || document.getElementById('selDF');
  const selDl  = document.getElementById('sel-dl')  || document.getElementById('selDL');
  const allSt  = document.getElementById('all-state') || document.getElementById('allState');
  const uSum   = document.getElementById('u-sum');

  // (Opcional) si pides las rutas en inputs/controles:
  const inGeo  = document.getElementById('geo');
  const inCat  = document.getElementById('catalog');

  function clear(el){ if(el) el.value = ''; }
  function exclusividad(changed){
    if(changed === 'MUN'){ clear(selDf); clear(selDl); if(allSt) allSt.checked = false; }
    if(changed === 'DF'){  clear(selMun); clear(selDl); if(allSt) allSt.checked = false; }
    if(changed === 'DL'){  clear(selMun); clear(selDf); if(allSt) allSt.checked = false; }
    if(changed === 'ALL'){ clear(selMun); clear(selDf); clear(selDl); }
    evaluarSeleccion();
  }

  function obtenerUniverso(){
    if(allSt && allSt.checked) return {scope:'ALL', key:null, label:'Estado completo'};
    if(selMun && selMun.value) return {scope:'MUN', key:selMun.value, label:`Municipio ${selMun.options[selMun.selectedIndex].text}`};
    if(selDf  && selDf.value)  return {scope:'DF',  key:selDf.value,  label:`Distrito Federal ${selDf.value}`};
    if(selDl  && selDl.value)  return {scope:'DL',  key:selDl.value,  label:`Distrito Local ${selDl.value}`};
    return null;
  }

  function pintarResumen(u){
    if(!uSum) return;
    uSum.textContent = u ? `Universo: ${u.label}` : 'Universo: —';
  }

  function persistir(u){
    // Defaults de producción (tu nueva estructura):
    const defaults = {
      geo: '../data/geo/secciones.geojson',
      catalog: '../data/catalogo_territorial.json',
      electoral: {
        P:  '../data/electoral/P.json',
        G:  '../data/electoral/G.json',
        A:  '../data/electoral/A.json',
        DF: '../data/electoral/DF.json',
        DL: '../data/electoral/DL.json',
        S:  '../data/electoral/S.json'
      },
      // opcional
      extra: '../data/Datos_Electoral.json'
    };

    // Si tienes inputs en el portal, respétalos; si no, usa defaults.
    const paths = {
      geo: (inGeo?.value || defaults.geo).trim(),
      catalog: (inCat?.value || defaults.catalog).trim(),
      electoral: defaults.electoral,
      extra: defaults.extra
    };

    AT_setUniverse(u);

    localStorage.setItem('AT_PATHS', JSON.stringify(paths));
  }


  function habilitarModulos(){
    document.querySelectorAll('#mods .modcard').forEach(card=>{
      card.classList.remove('disabled');
      card.querySelector('.mod-btn')?.removeAttribute('disabled');
    });
  }
  function deshabilitarModulos(){
    document.querySelectorAll('#mods .modcard').forEach(card=>{
      card.classList.add('disabled');
      card.querySelector('.mod-btn')?.setAttribute('disabled', true);
    });
  }

  function evaluarSeleccion(){
    const u = obtenerUniverso();
    pintarResumen(u);
    if(u){
      persistir(u);
      habilitarModulos();
    } else {
      deshabilitarModulos();
    }
  }

  selMun?.addEventListener('change', ()=>exclusividad('MUN'));
  selDf?.addEventListener('change',  ()=>exclusividad('DF'));
  selDl?.addEventListener('change',  ()=>exclusividad('DL'));
  allSt?.addEventListener('change',  ()=>exclusividad('ALL'));

  // Inicial:
  evaluarSeleccion();
})();

function AT_initUniverseDefault(){
  // si ya hay universo guardado, lo respetamos
  const saved = localStorage.getItem("AT_UNIVERSE");
  if (saved) return;

  // default = Estado completo
  if (allSt) allSt.checked = true;

  const uDefault = { scope: "ALL", key: null, label: "Estado completo" };
  AT_setUniverse(uDefault);
}

// ---- inline block separator ----

  (function(){
    const panel = document.getElementById('sr-panel');
    const btn = document.getElementById('sr-toggle');
    if(!panel || !btn) return;

    // Estado inicial abierto
    panel.classList.remove('sr-closed');
    btn.setAttribute('aria-expanded', 'true');

    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const isClosed = panel.classList.toggle('sr-closed');
      btn.setAttribute('aria-expanded', String(!isClosed));
    });
  })();

// ---- inline block separator ----

  (function(){
    const modal   = document.getElementById('sr-modal');
    const openBtn = document.querySelector('.sr-cta');   // tu botón "Ver guía rápida"
    const closeEls = modal.querySelectorAll('[data-sr-close], .sr-modal__backdrop');

    if(!modal || !openBtn) return;

    let lastFocus = null;

    function trapFocus(e){
      const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if(!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];

      if(e.key === 'Tab'){
        if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      } else if(e.key === 'Escape'){
        close();
      }
    }

    function open(e){
      if(e) e.preventDefault();
      lastFocus = document.activeElement;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      // foco al botón cerrar
      const closeBtn = modal.querySelector('.sr-modal__close');
      if(closeBtn) closeBtn.focus();
      document.addEventListener('keydown', trapFocus);
    }

    function close(){
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', trapFocus);
      if(lastFocus) lastFocus.focus();
    }

    openBtn.addEventListener('click', open);
    closeEls.forEach(el => el.addEventListener('click', close));
  })();

// ---- inline block separator ----

  (function(){
    function togglePreso(){
      document.body.classList.toggle('presentation-mode');
    }
    function bindPresoButton() {
      const btn = document.getElementById('preso-btn');
      if (!btn || btn.__wired) return;
      btn.addEventListener('click', togglePreso);
      btn.__wired = true;
    }
    bindPresoButton();
    document.addEventListener('DOMContentLoaded', bindPresoButton, { once: true });
    // Atajo: P
    window.addEventListener('keydown', (e)=>{
      if (e.key.toLowerCase() === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey){
        e.preventDefault(); togglePreso();
      }
    });
  })();

// ---- inline block separator ----

  (function(){
    // Formateo simple
    const fmt = (n)=> new Intl.NumberFormat('es-MX').format(Math.max(0, Math.round(n||0)));

    // Animación de conteo
    function countTo(el, to, ms=500){
      const from = parseInt((el.textContent||'0').replace(/\D/g,'')) || 0;
      const start = performance.now();
      const dur = Math.max(0, ms);
      function tick(t){
        const p = Math.min(1, (t - start)/dur);
        el.textContent = fmt(from + (to - from)*p);
        if(p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    // Set de KPIs + progreso
    function setKPIs({ topSecciones, margenMenor3, abstAlta, rutaPorc }){
      // Elementos (con fallback si no pusiste IDs)
      const elTop  = document.getElementById('kpi-top')  || document.querySelector('.sr-kpis .sr-kpi:nth-child(1) .sr-kpi-value');
      const elM3   = document.getElementById('kpi-m3')   || document.querySelector('.sr-kpis .sr-kpi:nth-child(2) .sr-kpi-value');
      const elAbst = document.getElementById('kpi-abst') || document.querySelector('.sr-kpis .sr-kpi:nth-child(3) .sr-kpi-value');
      const bar    = document.querySelector('.sr-prog-bar i');
      const num    = document.querySelector('.sr-prog-num');

      if(elTop)  countTo(elTop,  Number(topSecciones||0), 600);
      if(elM3)   countTo(elM3,   Number(margenMenor3||0), 600);
      if(elAbst) countTo(elAbst, Number(abstAlta||0),     600);

      const p = Math.max(0, Math.min(100, Number(rutaPorc||0)));
      if(bar) bar.style.width = p + '%';
      if(num) num.textContent = p + '%';
    }

    // Exponer a global por si llamas desde tu lógica de consultas
    window.ATKPI = { set: setKPIs };

    // 🔵 RELLENO RÁPIDO (DF 2 DEMO): reemplaza con tus valores reales
    // Ejemplo: 10 secciones foco, 7 con margen <3%, 14 con abstención alta, avance 68%
    setKPIs({ topSecciones: 10, margenMenor3: 7, abstAlta: 14, rutaPorc: 68 });

    // Opcional: actualizar cuando ejecutes la consulta principal (si tienes un botón)
    document.getElementById('btn-ejecutar')?.addEventListener('click', ()=>{
      // Llama aquí con tus números calculados:
      // ATKPI.set({ topSecciones: X, margenMenor3: Y, abstAlta: Z, rutaPorc: R });
    });
  })();
  

// ---- inline block separator ----

    const btnVerManual = document.getElementById('btnVerManual');
    const vistaQuick = document.querySelector('.sr-view--quick');
    const vistaManual = document.querySelector('.sr-view--manual');
    const titulo = document.getElementById('sr-modal-title');

    if (btnVerManual && vistaQuick && vistaManual) {
      btnVerManual.addEventListener('click', () => {
        vistaQuick.hidden = true;
        vistaManual.hidden = false;
        titulo.textContent = 'Manual AT Análisis 27-30';
      });
    }

  

// ---- inline block separator ----

    function AT_clearLegacyKeys(){
      ["AT_SCOPE","AT_MUN_ID","AT_DF_ID","AT_DL_ID"].forEach(k => localStorage.removeItem(k));
    }

    function AT_setUniverse(u){
      if(!u) return;

      // Evita loops por eventos encadenados
      if (AT_setUniverse.__locking) return;
      AT_setUniverse.__locking = true;

      try {
        // Limpia keys viejas (pero SIN disparar setUniverse otra vez)
        AT_clearLegacyKeys();

        // Guarda universo
        localStorage.setItem("AT_UNIVERSE", JSON.stringify({ ...u, ts: Date.now() }));
        localStorage.setItem("AT_SCOPE", u.scope || "");

        // Guarda id según scope
        if (u.scope === "MUN") localStorage.setItem("AT_MUN_ID", String(u.key));
        if (u.scope === "DF")  localStorage.setItem("AT_DF_ID",  String(u.key));
        if (u.scope === "DL")  localStorage.setItem("AT_DL_ID",  String(u.key));

        // (Opcional) debug
        console.log("[AT] Universo guardado:", u);

      } finally {
        AT_setUniverse.__locking = false;
      }
    }




    (() => {
      let manualLoaded = false;

      const applyInlineFormatting = (text) =>
        text.replace(/'''(.*?)'''/g, '<strong>$1</strong>');

      const buildManualHtml = (raw) => {
        const prepared = raw.replace(/:\s*([*#])\s+/g, ':\n$1 ');
        const lines = prepared.split(/\r?\n/);
        const html = [];
        let listType = null;
        let inParagraph = false;

        const closeList = () => {
          if (listType) {
            html.push(`</${listType}>`);
            listType = null;
          }
        };

        const closeParagraph = () => {
          if (inParagraph) {
            html.push('</p>');
            inParagraph = false;
          }
        };

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            closeParagraph();
            closeList();
            continue;
          }

          const headingMatch = trimmed.match(/^(=+)\s*(.+?)\s*=+$/);
          if (headingMatch) {
            closeParagraph();
            closeList();
            const level = Math.min(3, headingMatch[1].length);
            const tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
            const headingText = applyInlineFormatting(headingMatch[2].trim());
            const capMatch = headingMatch[2].match(/CAP[ÍI]TULO\s+(\d+)/i);
            const idAttr = capMatch ? ` id="cap${capMatch[1]}"` : '';
            html.push(`<${tag}${idAttr}>${headingText}</${tag}>`);
            continue;
          }

          const listMatch = trimmed.match(/^([*#])\s+(.*)$/);
          if (listMatch) {
            closeParagraph();
            const nextListType = listMatch[1] === '*' ? 'ul' : 'ol';
            if (listType && listType !== nextListType) {
              closeList();
            }
            if (!listType) {
              listType = nextListType;
              html.push(`<${listType}>`);
            }
            html.push(`<li>${applyInlineFormatting(listMatch[2])}</li>`);
            continue;
          }

          if (!inParagraph) {
            closeList();
            html.push('<p>');
            inParagraph = true;
            html.push(applyInlineFormatting(trimmed));
          } else {
            html.push('<br>' + applyInlineFormatting(trimmed));
          }
        }

        closeParagraph();
        closeList();
        return html.join('');
      };

      const bindManualModal = () => {
        const btnManual = document.getElementById('btnManualAT');
        const manualModal = document.getElementById('manualATModal');
        const closeManual = document.getElementById('cerrarManualAT');
        const manualContent = document.getElementById('manualATContent');
        const manualSrc = manualContent?.dataset.src || '../data/Manual/manual.txt';

        if (!btnManual || !manualModal || !closeManual || !manualContent) {
          console.warn('[PORTAL][manual] No se pudo enlazar el manual: faltan nodos en el DOM.', {
            btnManual: !!btnManual,
            manualModal: !!manualModal,
            closeManual: !!closeManual,
            manualContent: !!manualContent
          });
          return;
        }

        if (btnManual.__wired) return;

        const loadManual = async () => {
          manualContent.innerHTML = '<p>Cargando manual...</p>';
          try {
            const response = await fetch(manualSrc, { cache: 'no-store' });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const text = await response.text();
            manualContent.innerHTML = buildManualHtml(text);
            manualLoaded = true;
          } catch (error) {
            manualContent.innerHTML =
              '<p>No se pudo cargar el manual. Revisa la ruta de <code>data/Manual/manual.txt</code>.</p>';
          }
        };

        const openManual = () => {
          manualModal.classList.remove('hidden');
          if (!manualLoaded) loadManual();
        };

        const closeManualFn = () => {
          manualModal.classList.add('hidden');
        };

        btnManual.addEventListener('click', openManual);
        closeManual.addEventListener('click', closeManualFn);
        manualModal.addEventListener('click', (event) => {
          if (event.target === manualModal) {
            closeManualFn();
          }
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && !manualModal.classList.contains('hidden')) {
            closeManualFn();
          }
        });

        btnManual.__wired = true;
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindManualModal, { once: true });
      } else {
        bindManualModal();
      }
    })();
  
