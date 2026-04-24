      // ===== 0) Campos (ajusta si tus nombres son distintos) =====
      // DL = Distrito Local, DF = Distrito Federal
      const FIELD_KEYS = {
        mun: "MUNICIPIO",
        dl: "DISTRITO_L",
        df: "DISTRITO_F",
      };

      const paths = JSON.parse(localStorage.getItem("AT_PATHS") || "{}");
      const urlGeo = paths.geo || "../data/geo/secciones.geojson";
      const catUrl =
        paths.catalog || "../data/catalogo_territorial.json";
      const ELP = paths.electoral?.P || "../data/electoral/P.json";
      // ...

      // ====== RUTAS ======
      function getPath(key, def) {
        try {
          const p = JSON.parse(localStorage.getItem("AT_PATHS") || "{}");
          return p[key] || def;
        } catch (_) {
          return def;
        }
      }
      const URL_SECC = getPath("geo", "../data/geo/secciones.geojson"); // para leer DL y municipio de la sección
      const URL_CASSEC = getPath(
        "casillas_sec",
        "../data/casillas/casillas_min_por_seccion.json"
      ); // tu JSON plano agrupado por sección
      const URL_ETPTS = getPath("et27", null); // opcional: puntos capturados en CAMPO (si aún no los tienes, déjalo null)

      function getET27PointsURL() {
        // 1) prioridad a lo que venga en AT_PATHS.et27 si existe
        const paths = getPaths();
        if (paths.et27) return paths.et27;

        // 2) fallback fijo al archivo de la app
        return ET27_POINTS_URL || "../data/campo/puntos_campo.geojson";
      }

      let ET27_CASILLAS_GEOJSON = null;

      async function cargarGeojsonCasillas() {
        if (ET27_CASILLAS_GEOJSON) return ET27_CASILLAS_GEOJSON;

        const ruta = "../data/casillas/puntos_casillas.geojson";
        const res = await fetch(ruta);
        if (!res.ok) throw new Error(`No se pudo cargar ${ruta}`);
        ET27_CASILLAS_GEOJSON = await res.json();
        return ET27_CASILLAS_GEOJSON;
      }

      /** 1) Ruta del GeoJSON de puntos */
      const ET27_POINTS_URL = "../data/campo/puntos_campo.geojson";

      /** 2) Mapa de colores por TIPO (ajusta si tus valores difieren) */

      // ====== CACHE ======
      let __ET_CAS_POR_SEC = null; // Map sec -> { req_rep, casillas:[{CASILLA,LOCALIDAD,DOMICILIO}] }

      // Índice global de personas ET: siempre usamos el mismo objeto en window y en la variable local
      window.__ET_PERS_INDEX = window.__ET_PERS_INDEX || null;
      let __ET_PERS_INDEX = window.__ET_PERS_INDEX; // alias local al global

      let __SECC_INDEX = null; // Map sec -> feature de secciones (para DL/muni)
      let ET27_CAPTURE_MODE = null; // { pid, secId, li }
      const ET27_MARKERS_BY_PID = new Map();

      window.ET27_EDITS = window.ET27_EDITS || new Map();

      // ====== HELPERS ======
      async function fetchJSON(u) {
        const r = await fetch(u);
        if (!r.ok) throw new Error(u);
        return r.json();
      }

      async function inicializarCampoEnEstructura() {
        const geojsonCampo = await cargarGeojsonCampo();
        window.__ET_PERS_INDEX = construirIndicePersonas(geojsonCampo);

        //console.log("Indice de personas listo:", window.__ET_PERS_INDEX);
      }

      function focusET27Person(pid, secId, li) {
        const map = ensureLeafletMap();
        const secKey = String(secId);

        let persona = null;

        // 1) Intentar primero la persona asociada al <li>
        if (li && li.__persona) {
          persona = li.__persona;
        }

        // 2) Si no viene del <li>, buscar en el índice por sección
        if (!persona && window.__ET_PERS_INDEX) {
          const bucket = window.__ET_PERS_INDEX.get(secKey);
          if (bucket) {
            const listas = [
              bucket.rep_casilla,
              bucket.rep_seccion,
              bucket.coord_distrito,
              bucket.otros,
            ];
            for (const arr of listas) {
              if (!arr) continue;
              const found = arr.find(
                (x) =>
                  x.id === pid ||
                  x.ID_PERSONA === pid ||
                  (x._pid && x._pid === pid)
              );
              if (found) {
                persona = found;
                break;
              }
            }
          }
        }

        if (!persona) return;

        // 3) Resolver coordenadas (persona → dataset del <li> como respaldo)
        let lat = persona.lat ?? persona.LAT ?? null;
        let lng = persona.lng ?? persona.LNG ?? null;

        if ((lat == null || lng == null) && li && li.dataset) {
          if (li.dataset.lat && li.dataset.lng) {
            lat = parseFloat(li.dataset.lat);
            lng = parseFloat(li.dataset.lng);
          }
        }

        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
          alert(
            "Esta persona aún no tiene ubicación en el mapa. Usa el botón 📍Mapa para capturarla."
          );
          return;
        }

        // Guardar de vuelta por si luego se usa en otro lado
        persona.lat = lat;
        persona.lng = lng;

        // 4) Asegurarnos de tener marcador y centrar
        addOrUpdatePersonMarker(pid, secKey, persona);
        const marker = ET27_MARKERS_BY_PID.get(pid);
        if (!marker) return;

        const latlng = marker.getLatLng();

        // 🔍 Zoom más cercano (tipo puerta de casa)
        map.setView(latlng, 19, { animate: true });

        // 🔆 Overlay de resaltado con halo / ping
        try {
          // quitar resaltado anterior si existe
          if (window.ET27_HL) {
            map.removeLayer(window.ET27_HL);
          }

          window.ET27_HL = L.marker(latlng, {
            icon: L.divIcon({
              className: "et27-hl-wrapper",
              html: '<div class="et27-hl-ping"></div>',
              iconSize: [40, 40],
              iconAnchor: [20, 20],
            }),
            interactive: false,
            pane: "markerPane", // arriba de los puntos normales
          }).addTo(map);
        } catch (e) {
          console.warn("[ET] No se pudo dibujar resaltado de persona:", e);
        }

        // 5) Feedback visual normal
        marker.openPopup?.();
        try {
          document
            .querySelectorAll(".pers-item.pers-active")
            .forEach((el) => el.classList.remove("pers-active"));
          if (li) li.classList.add("pers-active");
        } catch (_) {}

        try {
          document
            .querySelectorAll(".pers-item.pers-active")
            .forEach((el) => el.classList.remove("pers-active"));
          if (li) li.classList.add("pers-active");
        } catch (_) {}
      }

      function startET27CaptureForPerson(pid, secId, li) {
        ET27_CAPTURE_MODE = { pid, secId: String(secId), li };
        try {
          li.classList.add("pers-capturing");
        } catch (_) {}
        alert("Ahora haz clic en el mapa para ubicar a esta persona.");
      }

      function addOrUpdatePersonMarker(pid, secId, persona) {
        const map = ensureLeafletMap();
        const cluster = ensureCluster();

        if (!persona || persona.lat == null || persona.lng == null) return;

        const feat = {
          type: "Feature",
          properties: {
            TIPO: persona.rol || persona.TIPO_ASIGNACION || "SIMPATIZANTE",
            NOMBRE:
              persona.nombre ||
              persona.NOMBRE ||
              persona.NOMBRE_COMPLETO ||
              "—",
            TELEFONO: persona.tel || persona.TELEFONO || persona.TEL || "",
            SECCION: secId,
            PROMOTOR_PIN: persona.PROMOTOR_PIN || "ET-27",
            DOMICILIO: persona.domicilio || persona.DOMICILIO || "",
          },
        };

        const latlng = L.latLng(persona.lat, persona.lng);

        const prev = ET27_MARKERS_BY_PID.get(pid);
        if (prev) {
          cluster.removeLayer(prev);
        }

        const marker = markerFromFeature(feat, latlng);
        cluster.addLayer(marker);
        ET27_MARKERS_BY_PID.set(pid, marker);
      }

      function bySecMapFromCasillas(arr) {
        const m = new Map();
        (arr || []).forEach((row) => {
          const s = String(row.SECCION ?? "").trim();
          if (!s) return;
          m.set(s, {
            req_rep: Number(row.req_rep || 0),
            casillas: row.casillas || [],
          });
        });
        return m;
      }
      function indexSecciones(gj) {
        const m = new Map();
        (gj.features || []).forEach((f) => {
          const s = String(f.properties?.SECCION ?? "").trim();
          if (!s) return;
          m.set(s, f);
        });
        return m;
      }
      function bucketPersonasET(points) {
        const m = new Map();

        (points?.features || []).forEach((f) => {
          const p = f.properties || {};
          const sec = String(p.SECCION ?? p.SEC ?? "").trim();
          if (!sec) return;

          // Tipo / rol normalizado
          const tipoRaw = (
            p.TIPO_ASIGNACION ||
            p.ROL ||
            p.TIPO || // SIMPATIZANTE, LIDER, OBSERVADOR, REP_CASILLA, etc.
            ""
          )
            .toUpperCase()
            .trim();

          // Coordenadas desde geometría o campos auxiliares
          let lat = null;
          let lng = null;

          if (f.geometry && Array.isArray(f.geometry.coordinates)) {
            // GeoJSON: [lon, lat]
            lng = f.geometry.coordinates[0];
            lat = f.geometry.coordinates[1];
          }
          if (p.LAT != null && p.LON != null) {
            lat = Number(p.LAT);
            lng = Number(p.LON);
          }
          if (p.lat != null && p.lng != null) {
            lat = Number(p.lat);
            lng = Number(p.lng);
          }

          const persona = {
            id: p.ID_PERSONA || null,
            nombre: p.NOMBRE || p.NOMBRE_COMPLETO || p.nombre || "—",
            tel: p.TELEFONO || p.TEL || p.tel || "",
            casilla: p.CASILLA || p.casilla || "",
            domicilio: p.DOMICILIO || p.domicilio || "",
            rol: tipoRaw,
            lat,
            lng,
            _raw: p,
          };

          if (!m.has(sec)) {
            m.set(sec, {
              rep_casilla: [],
              rep_seccion: [],
              coord_distrito: [],
              otros: [],
            });
          }
          const b = m.get(sec);

          if (
            tipoRaw === "REP_CASILLA" ||
            tipoRaw === "REPRESENTANTE DE CASILLA"
          ) {
            b.rep_casilla.push(persona);
          } else if (
            tipoRaw === "REP_SECCION" ||
            tipoRaw === "REP_GENERAL" ||
            tipoRaw === "REPRESENTANTE DE SECCIÓN" ||
            tipoRaw === "REPRESENTANTE GENERAL"
          ) {
            b.rep_seccion.push(persona);
          } else if (
            tipoRaw === "COORDINADOR_DISTRITAL" ||
            tipoRaw === "COORDINADOR DISTRITAL"
          ) {
            b.coord_distrito.push(persona);
          } else {
            b.otros.push(persona);
          }
        });

        return m;
      }

      // Carga índices una vez
      async function ensureETIndexes() {
        const paths = JSON.parse(localStorage.getItem("AT_PATHS") || "{}");

        // 1) Casillas por sección
        if (!__ET_CAS_POR_SEC) {
          const cas = await fetchJSON(URL_CASSEC);
          __ET_CAS_POR_SEC = bySecMapFromCasillas(cas);
        }

        // 2) Índice de secciones
        if (!__SECC_INDEX) {
          const secc = await fetchJSON(URL_SECC);
          __SECC_INDEX = indexSecciones(secc);
        }

        // 3) Personas ET (puntos de campo)
        const ptsUrl = getET27PointsURL();

        // Si aún no hay índice ni global ni local, cargar desde el GeoJSON
        if (ptsUrl && !window.__ET_PERS_INDEX && !__ET_PERS_INDEX) {
          try {
            const pts = await fetchJSON(ptsUrl);
            __ET_PERS_INDEX = bucketPersonasET(pts); // Map<secId, bucket>
            window.__ET_PERS_INDEX = __ET_PERS_INDEX;
            console.log(
              "[ET] Personas ET cargadas desde",
              ptsUrl,
              ":",
              __ET_PERS_INDEX.size
            );
          } catch (err) {
            console.warn("[ET] No se pudieron cargar puntos ET27:", err);
            __ET_PERS_INDEX = new Map();
            window.__ET_PERS_INDEX = __ET_PERS_INDEX;
          }
        }

        // Si existe solo uno de los dos, sincronizarlos
        if (!__ET_PERS_INDEX && window.__ET_PERS_INDEX) {
          __ET_PERS_INDEX = window.__ET_PERS_INDEX;
        }
        if (!window.__ET_PERS_INDEX && __ET_PERS_INDEX) {
          window.__ET_PERS_INDEX = __ET_PERS_INDEX;
        }

        // Último recurso: si siguen siendo null, crea un Map vacío
        if (!__ET_PERS_INDEX) {
          __ET_PERS_INDEX = new Map();
          window.__ET_PERS_INDEX = __ET_PERS_INDEX;
        }
      }

      // —— Lógica de estado por CASILLA (meta = 2 representantes de casilla)
      function statusCasilla(asignados) {
        if (asignados >= 2) return { cls: "ok", lbl: `${asignados}/2` };
        if (asignados === 1) return { cls: "mid", lbl: "1/2" };
        return { cls: "bad", lbl: "0/2" };
      }

      // —— Construye las métricas de la sección
      function computeSectionStats(secId) {
        const sec = String(secId);

        const cas = __ET_CAS_POR_SEC?.get(sec) || {
          req_rep: 0,
          casillas: []
        };

        cas.casillas = Array.isArray(cas.casillas) ? cas.casillas : [];

        const per =
          window.__ET_PERS_INDEX?.get(sec) ||
          __ET_PERS_INDEX?.get(sec) ||
          {
            rep_casilla: [],
            rep_seccion: [],
            coord_distrito: [],
            otros: []
          };

        per.rep_casilla = Array.isArray(per.rep_casilla) ? per.rep_casilla : [];
        per.rep_seccion = Array.isArray(per.rep_seccion) ? per.rep_seccion : [];
        per.coord_distrito = Array.isArray(per.coord_distrito) ? per.coord_distrito : [];
        per.otros = Array.isArray(per.otros) ? per.otros : [];

        // Conteo directo por casilla SOLO para quienes ya traen CASILLA capturada
        const repCasByCas = new Map();
        per.rep_casilla.forEach((p) => {
          const c = String(p.casilla || "").trim();
          const key = c || "__SIN_CASILLA__";
          repCasByCas.set(key, (repCasByCas.get(key) || 0) + 1);
        });

        // Totales de personas por rol
        const asigCasTotal = per.rep_casilla.length;
        const repSec = per.rep_seccion.length;
        const coord = per.coord_distrito.length;

        // —— Reparto automático de reps SIN CASILLA entre B1, C1, C2, ...
        let sinAsignar = repCasByCas.get("__SIN_CASILLA__") || 0;
        repCasByCas.delete("__SIN_CASILLA__"); // ya no la usamos como casilla real

        const casillasStats = cas.casillas.map((c) => {
          const key = String(c.CASILLA || "").trim() || "__SIN_CASILLA__";

          // Asignados explícitos (cuando ya traen CASILLA en el geojson)
          let asignados = repCasByCas.get(key) || 0;

          // Repartimos reps sin casilla aquí hasta llegar a 2 por casilla
          while (asignados < 2 && sinAsignar > 0) {
            asignados++;
            sinAsignar--;
          }

          return { ...c, asignados };
        });

        return {
          reqRepCasillas: cas.req_rep,
          asigRepCasillas: asigCasTotal,
          repSecion: repSec,
          coordDistrital: coord,
          casillas: casillasStats,
        };
      }

            async function calcularResumenOperativoSeccion(secId) {
        const geojsonCasillas = await cargarGeojsonCasillas();

        const resumen = calcularResumenSeccion(secId, geojsonCasillas);
        const necesidades = calcularNecesidades(resumen);
        const cobertura = calcularCoberturaActualSeccion(secId);

        return {
          SECCION: secId,
          RESUMEN: resumen,
          NECESIDADES: necesidades,
          COBERTURA: cobertura,
          FALTANTES: {
            REP_CASILLA: Math.max(0, necesidades.REP_CASILLA - cobertura.REP_CASILLA_LLEVO),
            REP_GENERAL: Math.max(0, necesidades.REP_GENERAL - cobertura.REP_GENERAL_LLEVO),
            OBSERVADORES: Math.max(0, necesidades.OBSERVADORES - cobertura.OBSERVADORES_LLEVO)
          }
        };
      }

      // ====== RENDER DEL PANEL ======
      function renderSecPanel(secId) {
        const $tools = document.querySelector(
          "#et27-tab-casillas .et27-cas-tools"
        );
        const S = computeSectionStats(secId);
        const $search = document.getElementById("et27-cas-search");
        const $sort = document.getElementById("et27-cas-sort");
        const $miss = document.getElementById("et27-cas-missing");
        const $p = document.getElementById("et27-sec-panel");
        if (!$p) {
          console.warn("[ET] renderSecPanel: panel et27-sec-panel no encontrado");
          return;
        }
        const $ttl = $p.querySelector(".ttl");
        const $ulc = document.getElementById("et27-cas-list");
        const $rc = document.getElementById("et27-list-repcas");
        const $rs = document.getElementById("et27-list-repsec");
        const $cd = document.getElementById("et27-list-coord");
        const $ot = document.getElementById("et27-list-otros");
        const $rz = document.getElementById("et27-resumen-text");

        // --- PERSONAS: importar desde __ET_PERS_INDEX y hacerlas editables ---
        let personas = getPersonasBySection(secId);

        if (!Array.isArray(personas)) {
          console.warn(
            "[ET] Personas para sección no es array, valor crudo:",
            personas
          );
          personas = [];
        }

        // Limpia listas
        $rc.innerHTML = "";
        $rs.innerHTML = "";
        $cd.innerHTML = "";
        $ot.innerHTML = "";

        // helper para crear una fila editable
        // helper para crear una fila editable
        function makeEditableRow(p) {
          const li = document.createElement("li");
          li.className = "pers-item";

          const raw = p._raw || {};

          // ID estable (si no viene del geojson, generamos uno)
          const pid =
            p.id ||
            raw.ID_PERSONA ||
            raw.ID ||
            p._pid ||
            `${secId}_${(p.casilla || raw.CASILLA || "").toString()}_${(
              p.nombre ||
              raw.NOMBRE ||
              raw.NOMBRE_COMPLETO ||
              ""
            )
              .slice(0, 10)
              .replace(/\s+/g, "_")}_${Math.random().toString(36).slice(2, 6)}`;

          li.dataset.pid = pid;
          p.id = pid;
          p._pid = pid;

          const nombre = p.nombre || raw.NOMBRE || raw.NOMBRE_COMPLETO || "";
          const tel = p.tel || raw.TELEFONO || raw.TEL || "";
          const casilla = p.casilla || raw.CASILLA || "";
          const rolRaw = (
            p.rol ||
            raw.TIPO_ASIGNACION ||
            raw.ROL ||
            raw.TIPO ||
            ""
          ).toUpperCase();
          const domicilio = p.domicilio || raw.DOMICILIO || "";

          li.innerHTML = `
          <div class="pers-main">
            <input class="pers-nom" type="text" value="${nombre}" placeholder="Nombre completo" />
            <input class="pers-tel" type="text" value="${tel}" placeholder="Teléfono" /> 
          </div>
            <input class="pers-dom" type="text" value="${domicilio}" placeholder="Domicilio" />
          </div>
          <div class="pers-meta">
            <input class="pers-cas" type="text" value="${casilla}" placeholder="Casilla" />
            <select class="pers-rol">
              <option value="REP_CASILLA" ${
                rolRaw === "REP_CASILLA" ? "selected" : ""
              }>Rep. casilla</option>
              <option value="REP_SECCION" ${
                rolRaw === "REP_SECCION" ? "selected" : ""
              }>Rep. sección</option>
              <option value="COORDINADOR_DISTRITAL" ${
                rolRaw === "COORDINADOR_DISTRITAL" ? "selected" : ""
              }>Coord. distrital</option>
              <option value="OTRO" ${
                rolRaw !== "REP_CASILLA" &&
                rolRaw !== "REP_SECCION" &&
                rolRaw !== "COORDINADOR_DISTRITAL"
                  ? "selected"
                  : ""
              }>Otro</option>
            </select>
            <button type="button" class="pers-map-btn">📍Mapa</button>
          </div>
          `;

          const nomInput = li.querySelector(".pers-nom");
          const telInput = li.querySelector(".pers-tel");
          const casInput = li.querySelector(".pers-cas");
          const rolSel = li.querySelector(".pers-rol");
          const domInput = li.querySelector(".pers-dom");
          const mapBtn = li.querySelector(".pers-map-btn");

          function pushEdit() {
            // Actualizamos también el objeto en memoria
            p.nombre = nomInput.value.trim();
            p.tel = telInput.value.trim();
            p.casilla = casInput.value.trim();
            p.rol = rolSel.value;
            p.domicilio = domInput.value.trim();

            const prev = ET27_EDITS.get(pid) || {};
            ET27_EDITS.set(pid, {
              ...prev,
              id: pid,
              SECCION: secId,
              CASILLA: casInput.value.trim(),
              TIPO_ASIGNACION: rolSel.value,
              NOMBRE: nomInput.value.trim(),
              TELEFONO: telInput.value.trim(),
              DOMICILIO: domInput.value.trim(),
              _orig: p,
            });
          }

          [nomInput, telInput, casInput, rolSel, domInput].forEach((el) => {
            el.addEventListener("change", pushEdit);
            el.addEventListener("blur", pushEdit);
          });

          if (mapBtn) {
            mapBtn.addEventListener("click", () => {
              startET27CaptureForPerson(pid, secId, li);
            });
          }

          // Clic en la fila => centrar / resaltar en el mapa
          li.addEventListener("click", (ev) => {
            const t = ev.target;
            // No interceptar clics en inputs o select o botón mapa
            if (
              t.classList.contains("pers-nom") ||
              t.classList.contains("pers-tel") ||
              t.classList.contains("pers-dom") ||
              t.classList.contains("pers-cas") ||
              t.tagName === "SELECT" ||
              t.classList.contains("pers-map-btn")
            ) {
              return;
            }
            focusET27Person(pid, secId, li);
          });

          return li;
        }

        // 3) 👉 AQUÍ va el bloque del forEach
        // === BLOQUE PERSONAS ET-27 EN EL PANEL DE SECCIÓN ===

        // 1) Obtener personas de esta sección desde el índice global

        // 2) Limpiar las listas del panel
        [$rc, $rs, $cd, $ot].forEach((ul) => (ul.innerHTML = ""));

        // 3) Buckets por rol
        const roles = {
          rep_casilla: [],
          rep_seccion: [],
          coord_distrito: [],
          otros: [],
        };

        // 3) Pintar personas sin tocar el índice global (evitamos duplicados)
        personas.forEach((p) => {
          const li = makeEditableRow(p);

          const rol = (p.rol || p.TIPO_ASIGNACION || p.ROL || "").toUpperCase();

          if (rol.includes("CASILLA")) {
            $rc.appendChild(li);
          } else if (rol.includes("SECCION") || rol.includes("GENERAL")) {
            $rs.appendChild(li);
          } else if (rol.includes("COORD")) {
            $cd.appendChild(li);
          } else {
            $ot.appendChild(li);
          }
        });

        // 5) Pintar en el panel usando filas editables
        roles.rep_casilla.forEach((p) =>
          $rc.appendChild(makeEditableRow(p, secId))
        );
        roles.rep_seccion.forEach((p) =>
          $rs.appendChild(makeEditableRow(p, secId))
        );
        roles.coord_distrito.forEach((p) =>
          $cd.appendChild(makeEditableRow(p, secId))
        );
        roles.otros.forEach((p) => $ot.appendChild(makeEditableRow(p, secId)));

        // === FIN BLOQUE PERSONAS ET-27 ===

        function crearPersona(tipo) {
          // Recuperar el bucket real de esta sección
          const secKey = String(secId);

          // Intentar leer primero del índice global y luego del local
          let bucket =
            (window.__ET_PERS_INDEX && window.__ET_PERS_INDEX.get(secKey)) ||
            (__ET_PERS_INDEX && __ET_PERS_INDEX.get(secKey));

          if (!bucket) {
            bucket = {
              rep_casilla: [],
              rep_seccion: [],
              coord_distrito: [],
              otros: [],
            };

            if (!window.__ET_PERS_INDEX) {
              window.__ET_PERS_INDEX = new Map();
            }
            if (!__ET_PERS_INDEX) {
              __ET_PERS_INDEX = window.__ET_PERS_INDEX;
            }

            window.__ET_PERS_INDEX.set(secKey, bucket);
          }

          // Generar ID estable para esta persona nueva
          const pid = `NEW_${secId}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 6)}`;

          const persona = {
            id: pid,
            nombre: "",
            tel: "",
            casilla: "",
            rol: tipo, // "REP_CASILLA" o "REP_SECCION"
          };

          // Meterla al bucket para que computeSectionStats la cuente
          if (tipo === "REP_CASILLA") {
            bucket.rep_casilla.push(persona);
            $rc.appendChild(makeEditableRow(persona));
          } else if (tipo === "REP_SECCION") {
            bucket.rep_seccion.push(persona);
            $rs.appendChild(makeEditableRow(persona));
          } else {
            bucket.otros.push(persona);
            $ot.appendChild(makeEditableRow(persona));
          }

          // Registrar edición inicial para que salga en el CSV
          ET27_EDITS.set(pid, {
            id: pid,
            SECCION: secId,
            CASILLA: "",
            TIPO_ASIGNACION: tipo,
            NOMBRE: "",
            TELEFONO: "",
            _orig: persona,
          });
        }

        // --- Botones "Agregar Rep. casilla / Rep. sección" ---
        const btnAddRepCas = document.getElementById("et27-add-rep-casilla");
        const btnAddRepSec = document.getElementById("et27-add-rep-seccion");

        if (btnAddRepCas && !btnAddRepCas.__wiredEt27) {
          btnAddRepCas.addEventListener("click", () =>
            crearPersona("REP_CASILLA")
          );
          btnAddRepCas.__wiredEt27 = true;
        }

        if (btnAddRepSec && !btnAddRepSec.__wiredEt27) {
          btnAddRepSec.addEventListener("click", () =>
            crearPersona("REP_SECCION")
          );
          btnAddRepSec.__wiredEt27 = true;
        }

        // Botón EXPORTAR CAMBIOS (CSV) para esta sección
        const btnExport = document.getElementById("et27-personas-export");
        if (btnExport) {
          btnExport.onclick = () => {
            const rows = [];
            ET27_EDITS.forEach((v) => {
              if (String(v.SECCION) === String(secId)) rows.push(v);
            });
            if (!rows.length) {
              alert("No hay cambios por exportar en esta sección.");
              return;
            }
            const csv = ["id,seccion,casilla,tipo_asignacion,nombre,telefono"];
            rows.forEach((r) => {
              csv.push(
                [
                  JSON.stringify(r.id),
                  JSON.stringify(r.SECCION),
                  JSON.stringify(r.CASILLA || ""),
                  JSON.stringify(r.TIPO_ASIGNACION || ""),
                  JSON.stringify(r.NOMBRE || ""),
                  JSON.stringify(r.TELEFONO || ""),
                ].join(",")
              );
            });
            const blob = new Blob([csv.join("\n")], {
              type: "text/csv;charset=utf-8;",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `et27_ediciones_sec_${secId}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
          };
        }

        const feat = __SECC_INDEX.get(String(secId));
        const muni = feat?.properties?.MUNICIPIO ?? "—";
        const dl = feat?.properties?.DISTRITO_L ?? feat?.properties?.DL ?? "—";

        $ttl.textContent = `Sección ${secId} · DL ${dl} · ${muni}`;

        // 3) >>> AQUI define buildCasillas() como función interna <<<
        function buildCasillas() {
          const q = ($search?.value || "").trim();
          const mode = $sort?.value || "pend-desc";
          const onlyMissing = !!$miss?.checked;

          let list = S.casillas.slice();
          if (onlyMissing) list = list.filter((c) => (c.asignados || 0) < 2);
          if (q) list = list.filter((c) => casMatchFilter(c, q));
          list = sortCasillas(list, mode);

          $ulc.innerHTML = "";
          if (!list.length) {
            $ulc.innerHTML = `<li class="cas-meta" style="padding:6px 0;">— Sin resultados —</li>`;
            return;
          }
          list.forEach((c) => {
            const st = statusCasilla(c.asignados || 0);
            const li = document.createElement("li");
            li.className = "cas-item";
            li.innerHTML = `
                    <div>
                      <div class="cas-head">Casilla ${c.CASILLA || "—"}</div>
                      <div class="cas-meta">${(
                        c.LOCALIDAD || ""
                      ).toUpperCase()} · ${c.DOMICILIO || ""}</div>
                      <button class="btn-copy" title="Copiar domicilio">Copiar</button>
                    </div>
                    <div class="badge ${st.cls}">${st.lbl}</div>
                  `;
            li.querySelector(".badge").addEventListener("click", () => {
              switchTab("personas");
              highlightCasillaInList?.(c.CASILLA);
            });
            li.querySelector(".btn-copy").addEventListener(
              "click",
              async () => {
                const ok = await copyText(
                  `${c.CASILLA || ""} · ${c.LOCALIDAD || ""} · ${
                    c.DOMICILIO || ""
                  }`
                );
                if (ok) {
                  const b = li.querySelector(".btn-copy");
                  b.textContent = "Copiado ✓";
                  setTimeout(() => (b.textContent = "Copiar"), 1200);
                }
              }
            );
            $ulc.appendChild(li);
          });
        }

        // 4) >>> listeners y render inicial (también dentro de renderSecPanel) <<<
        $search?.addEventListener("input", buildCasillas);
        $sort?.addEventListener("change", buildCasillas);
        $miss?.addEventListener("change", buildCasillas);
        buildCasillas();

        // Casillas
        $ulc.innerHTML = "";
        S.casillas.forEach((c) => {
          const st = statusCasilla(c.asignados);
          const li = document.createElement("li");
          li.className = "cas-item";
          li.innerHTML = `
                  <div>
                    <div><b>Casilla ${c.CASILLA || "—"}</b></div>
                    <div class="cas-meta">${(
                      c.LOCALIDAD || ""
                    ).toUpperCase()} · ${c.DOMICILIO || ""}</div>
                  </div>
                  <div class="badge ${st.cls}">${st.lbl}</div>
                `;
          li.addEventListener("click", () => {
            // Aquí mostramos “personas” asociadas a esta casilla (si CAMPO guarda CASILLA en sus registros)
            switchTab("personas");
            highlightCasillaInList(c.CASILLA);
          });
          $ulc.appendChild(li);
        });

        const faltCas = Math.max(0, 2 * S.casillas.length - S.asigRepCasillas);
        const faltRepSec = Math.max(0, 2 - S.repSecion);
        const faltCoord = Math.max(0, 1 - S.coordDistrital);
        $rz.innerHTML = `
                <p><b>Meta por sección</b>: 2 representantes por cada casilla (${
                  S.casillas.length
                } casillas → <b>${
          2 * S.casillas.length
        }</b> reps), 2 representantes de sección, 1 coordinador distrital.</p>
                <p><b>Asignados</b>: ${S.asigRepCasillas} rep. de casilla, ${
          S.repSecion
        } rep. de sección, ${S.coordDistrital} coord.</p>
                <p><b>Faltan</b>: ${faltCas} rep. de casilla, ${faltRepSec} rep. de sección, ${faltCoord} coord. distrital.</p>
              `;

        // Mostrar panel
        $p.style.display = "block";
      }

      function casMatchFilter(c, q) {
        if (!q) return true;
        q = q.toLowerCase();
        return (
          String(c.CASILLA || "")
            .toLowerCase()
            .includes(q) ||
          String(c.LOCALIDAD || "")
            .toLowerCase()
            .includes(q) ||
          String(c.DOMICILIO || "")
            .toLowerCase()
            .includes(q)
        );
      }
      function sortCasillas(arr, mode) {
        const pend = (a) => Math.max(0, 2 - (a.asignados || 0)); // pendientes por casilla (meta 2)
        const byName = (a, b) =>
          String(a.CASILLA || "").localeCompare(String(b.CASILLA || ""));
        if (mode === "pend-desc")
          return [...arr].sort((a, b) => pend(b) - pend(a) || byName(a, b));
        if (mode === "pend-asc")
          return [...arr].sort((a, b) => pend(a) - pend(b) || byName(a, b));
        if (mode === "cas-desc") return [...arr].sort((a, b) => byName(b, a));
        return [...arr].sort(byName); // cas-asc
      }
      async function copyText(txt) {
        try {
          await navigator.clipboard.writeText(txt);
          return true;
        } catch (_) {
          return false;
        }
      }

      // Tabs
      function switchTab(name) {
        document.querySelectorAll("#et27-sec-panel .tab").forEach((b) => {
          b.classList.toggle("on", b.dataset.tab === name);
        });
        document.querySelectorAll("#et27-sec-panel .tabc").forEach((c) => {
          c.classList.toggle("on", c.id === `et27-tab-${name}`);
        });
      }
      function highlightCasillaInList(cas) {
        /* opcional: resaltar personas de esa casilla */
      }

      // ====== API pública para tu buscador ======
      async function openETPanelForSection(seccion) {
        await ensureETIndexes();
        renderSecPanel(String(seccion));
      }
      window.openETPanelForSection = openETPanelForSection;

      // ===== 1) Mapa único y chequeo =====
      function ensureLeafletMap() {
        if (window.__AT_MAP && window.__AT_MAP instanceof L.Map)
          return window.__AT_MAP;
        // Validar existencia del contenedor antes de crear el mapa
        const mapEl = document.getElementById("map");
        if (!mapEl) {
          console.warn(
            "[AT] ensureLeafletMap: contenedor #map no encontrado. Devolviendo map cached si existe."
          );
          return window.__AT_MAP;
        }
        const m = L.map("map", { zoomControl: true }).setView(
          [21.0, -101.3],
          7
        );
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OSM",
        }).addTo(m);
        window.__AT_MAP = m;
        // Asegura tamaño correcto al redimensionar la ventana
        window.addEventListener("resize", () => {
          try {
            m.invalidateSize();
          } catch (_) {}
        });
        return m;
      }

      function bindET27CaptureClick() {
        const map = ensureLeafletMap();
        if (!map || typeof map.on !== "function" || map.__et27CaptureBound)
          return false;

        map.on("click", (ev) => {
          if (!ET27_CAPTURE_MODE) return;

          const { pid, secId, li } = ET27_CAPTURE_MODE;
          ET27_CAPTURE_MODE = null;
          try {
            li.classList.remove("pers-capturing");
          } catch (_) {}

          const lat = ev.latlng.lat;
          const lng = ev.latlng.lng;

          // Buscar persona en el bucket de la sección
          const bucket =
            window.__ET_PERS_INDEX && window.__ET_PERS_INDEX.get(String(secId));
          let persona = null;
          if (bucket) {
            const listas = [
              bucket.rep_casilla,
              bucket.rep_seccion,
              bucket.coord_distrito,
              bucket.otros,
            ];
            for (const arr of listas) {
              const found = arr.find(
                (x) =>
                  x.id === pid ||
                  x.ID_PERSONA === pid ||
                  (x._pid && x._pid === pid)
              );
              if (found) {
                persona = found;
                break;
              }
            }
          }

          if (!persona) {
            persona = {};
          }

          persona.lat = lat;
          persona.lng = lng;

          // Actualizar edición acumulada
          const prev = ET27_EDITS.get(pid) || {};
          ET27_EDITS.set(pid, {
            ...prev,
            id: pid,
            SECCION: secId,
            LAT: lat,
            LNG: lng,
          });

          // Dibujar / actualizar marcador
          addOrUpdatePersonMarker(pid, secId, persona);
        });

        map.__et27CaptureBound = true;
        return true;
      }

      if (!bindET27CaptureClick() && document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindET27CaptureClick, {
          once: true,
        });
      }

      function assertIsLeafletMap(m) {
        if (!(m instanceof L.Map) || typeof m.addLayer !== "function") {
          throw new Error(
            '[AT] addTo(): destino no es un Leaflet Map. Revisa variables llamadas "map" o dobles inicializaciones.'
          );
        }
      }

      function closeSecInfoPanel() {
        const box = document.getElementById("sec-info");
        if (box) box.style.display = "none";
        // Si quieres limpiar resaltado y etiquetas al cerrar:
        if (typeof clearSectionOverlays === "function") clearSectionOverlays();
      }

      function AT_isDockedPanel(el) {
        return !!(el && el.classList && el.classList.contains("dock-panel"));
      }
      function AT_dockPanel(el) {
        if (!el) return;
        el.classList.add("dock-panel");
        const host = document.getElementById("dash-panels");
        if (host && el.parentElement !== host) host.appendChild(el);
      }
      function AT_watchDockPanels() {
        const host = document.getElementById("dash-panels");
        if (!host || host.__dockObserver) return;
        const dockIfNeeded = (node) => {
          if (!node || node.nodeType !== 1) return;
          if (node.id && /^(AT27_|et27-).*(panel|toolbar|tab)$/.test(node.id)) {
            AT_dockPanel(node);
          }
        };
        const obs = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (const n of m.addedNodes) {
              dockIfNeeded(n);
              if (n.querySelectorAll) {
                n
                  .querySelectorAll('[id^="AT27_"], [id^="et27-"]')
                  .forEach(dockIfNeeded);
              }
            }
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        host.__dockObserver = true;
      }

      function ensureSecInfoPanelWired() {
        const box = document.getElementById("sec-info");
        const hdr = box?.querySelector(".hdr");
        if (!box || !hdr || box.__wired) return;

        // Bloquear propagación al mapa (no “parpadea” al arrastrar)
        if (window.L && L.DomEvent) {
          L.DomEvent.disableClickPropagation(box);
          L.DomEvent.disableScrollPropagation(box);
        }

        // Drag del panel
        let dragging = false,
          sx = 0,
          sy = 0,
          bx = 0,
          by = 0;
        hdr.addEventListener("mousedown", (e) => {
          if (AT_isDockedPanel(box)) return;
          if (e.target.closest(".btn-close")) return; // no iniciar drag si clic en "×"
          e.preventDefault();
          e.stopPropagation();
          dragging = true;
          const r = box.getBoundingClientRect();
          sx = e.clientX;
          sy = e.clientY;
          bx = r.left;
          by = r.top;
          box.style.position = "absolute";
          box.style.right = "auto";
          box.style.bottom = "auto";
          document.body.style.userSelect = "none";
        });
        window.addEventListener("mousemove", (e) => {
          if (!dragging) return;
          e.preventDefault();
          e.stopPropagation();
          const dx = e.clientX - sx,
            dy = e.clientY - sy;
          box.style.left = bx + dx + "px";
          box.style.top = by + dy + "px";
        });
        window.addEventListener("mouseup", () => {
          if (!dragging) return;
          dragging = false;
          document.body.style.userSelect = "";
        });

        // Botón “×”
        const btn = document.getElementById("sec-close");
        if (btn && !btn.__wired) {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeSecInfoPanel();
          });
          btn.__wired = true;
        }

        box.__wired = true;
      }

      // ===== 2) Filtrado por universo =====
      function toComp(v) {
        if (v == null) return "";
        const s = String(v).trim();
        return isFinite(s) && s !== "" ? Number(s) : s.toUpperCase();
      }
      function matches(props, u) {
        if (u.scope === "ALL") return true;
        const keyField =
          u.scope === "MUN"
            ? FIELD_KEYS.mun
            : u.scope === "DL"
            ? FIELD_KEYS.dl
            : FIELD_KEYS.df;
        return toComp(props?.[keyField]) === toComp(u.key);
      }
      function filterGeojson(geojson, u) {
        if (u.scope === "ALL") return geojson;
        const features = (geojson.features || []).filter((f) =>
          matches(f.properties, u)
        );
        return { ...geojson, features };
      }

      // ====== CARGA ELECTORAL (para obtener 24DL_LN) ======
      function getPaths() {
        try {
          return JSON.parse(localStorage.getItem("AT_PATHS") || "{}");
        } catch {
          return {};
        }
      }
      function getPuestoPath(p) {
        const paths = getPaths();
        return paths?.electoral?.[p] || `../data/electoral/${p}.json`;
      }

      window.AT_ELECT = window.AT_ELECT || {};
      async function getElectData(puesto) {
        if (window.AT_ELECT[puesto]) return window.AT_ELECT[puesto];
        const res = await fetch(getPuestoPath(puesto));
        if (!res.ok) throw new Error(`HTTP ${res.status} en ${puesto}`);
        const js = await res.json();
        window.AT_ELECT[puesto] = js;
        return js;
      }
      // LN para 2024 desde DL; si no hay, intenta P (fallback)
      async function getLN24DL(sec) {
        const key = String(sec);
        try {
          const dl = await getElectData("DL");
          const ln = dl?.secciones?.[key]?.["2024"]?.LN;
          if (typeof ln === "number") return ln;
        } catch (_) {}
        try {
          const p = await getElectData("P");
          const ln = p?.secciones?.[key]?.["2024"]?.LN;
          if (typeof ln === "number") return ln;
        } catch (_) {}
        return null;
      }

      // ====== ADYACENCIAS (Turf) ======
      function bboxIntersects(b1, b2) {
        return !(
          b2[0] > b1[2] ||
          b2[2] < b1[0] ||
          b2[1] > b1[3] ||
          b2[3] < b1[1]
        );
      }
      function getAdjacents(feat) {
        const all =
          window.AT_DATA?.features ||
          window.AT_CTX?.layer?.toGeoJSON?.()?.features ||
          [];
        if (!all.length) return [];
        const b1 = turf.bbox(feat);
        const out = [];
        const sec1 = feat.properties?.SECCION;
        for (const f of all) {
          const p = f.properties || {};
          if (p.SECCION === sec1) continue;
          const b2 = turf.bbox(f);
          if (!bboxIntersects(b1, b2)) continue;
          try {
            if (
              turf.booleanTouches(feat, f) ||
              turf.booleanOverlap(feat, f) ||
              turf.booleanIntersects(feat, f)
            ) {
              out.push(f);
            }
          } catch (_) {}
        }
        return out.slice(0, 25); // cota de seguridad
      }

      // ====== LABELS SOBRE EL MAPA ======
      function addLabelForFeature(feat, className, text) {
        try {
          const c = turf.centerOfMass(feat).geometry.coordinates; // [lon, lat]
          const m = L.marker([c[1], c[0]], {
            icon: L.divIcon({ className, html: text, iconSize: [0, 0] }),
          });
          window.__SEC_LABELS =
            window.__SEC_LABELS || L.layerGroup().addTo(ensureLeafletMap());
          window.__SEC_LABELS.addLayer(m);
          return m;
        } catch (_) {}
        return null;
      }

      function clearSectionOverlays() {
        const atMap = ensureLeafletMap();
        if (window.__SEC_HL) {
          try {
            atMap.removeLayer(__SEC_HL);
          } catch (_) {}
          window.__SEC_HL = null;
        }
        if (window.__SEC_ADJ) {
          try {
            atMap.removeLayer(__SEC_ADJ);
          } catch (_) {}
          window.__SEC_ADJ = null;
        }
        if (window.__SEC_LABELS) {
          try {
            atMap.removeLayer(__SEC_LABELS);
          } catch (_) {}
          window.__SEC_LABELS = null;
        }
      }

      // Dibuja selección + adyacentes + labels
      function paintSelectionAndAdj(feat) {
        const atMap = ensureLeafletMap();
        clearSectionOverlays();

        // resaltado principal
        window.__SEC_HL = L.geoJSON(feat, {
          style: { color: "#e91e63", weight: 3, fillOpacity: 0.25 },
        }).addTo(atMap);
        try {
          atMap.fitBounds(window.__SEC_HL.getBounds(), { padding: [28, 28] });
        } catch (_) {}

        // adyacentes
        const adj = getAdjacents(feat);
        if (adj.length) {
          window.__SEC_ADJ = L.geoJSON(
            { type: "FeatureCollection", features: adj },
            {
              style: {
                color: "#90a4ae",
                weight: 1.2,
                dashArray: "4,4",
                fillOpacity: 0.05,
              },
            }
          ).addTo(atMap);
        }

        // labels
        const sec = feat.properties?.SECCION ?? "—";
        addLabelForFeature(feat, "sec-label", `Sección ${sec}`);
        for (const f of adj) {
          const s2 = f.properties?.SECCION ?? "—";
          addLabelForFeature(f, "sec-label-adj", s2);
        }
      }

      // ====== PANEL FLOTANTE (drag + datos) ======
      (function wireSecInfoPanel() {
        const box = document.getElementById("sec-info");
        const hdr = box?.querySelector(".hdr");
        if (!box || !hdr || box.__wired) return;
        let dragging = false,
          sx = 0,
          sy = 0,
          bx = 0,
          by = 0;
        hdr.addEventListener("mousedown", (e) => {
          if (AT_isDockedPanel(box)) return;
          dragging = true;
          sx = e.clientX;
          sy = e.clientY;
          const r = box.getBoundingClientRect();
          bx = r.left;
          by = r.top;
          document.body.style.userSelect = "none";
        });
        window.addEventListener("mousemove", (e) => {
          if (!dragging) return;
          const dx = e.clientX - sx,
            dy = e.clientY - sy;
          box.style.left = bx + dx + "px";
          box.style.top = by + dy + "px";
          box.style.right = "auto";
          box.style.bottom = "auto";
          box.style.position = "absolute";
        });
        window.addEventListener("mouseup", () => {
          dragging = false;
          document.body.style.userSelect = "";
        });
        box.__wired = true;
      })();

      function calcularCoberturaActualSeccion(secId) {
        const sec = String(secId);

        const per =
          (window.__ET_PERS_INDEX && window.__ET_PERS_INDEX.get(sec)) ||
          {
            rep_casilla: [],
            rep_seccion: [],
            otros: []
          };

        const otros = per.otros || [];

        return {
          TOTAL_REGISTROS: 
            (per.rep_casilla?.length || 0) +
            (per.rep_seccion?.length || 0) +
            (otros.length || 0),

          REP_CASILLA_LLEVO: per.rep_casilla?.length || 0,

          REP_GENERAL_LLEVO: per.rep_seccion?.length || 0,

          OBSERVADORES_LLEVO: otros.filter(p =>
            String(p.TIPO || "").toUpperCase().includes("OBSERVADOR")
          ).length,

          LIDERES_LLEVO: otros.filter(p =>
            String(p.TIPO || "").toUpperCase().includes("LIDER") ||
            String(p.TIPO || "").toUpperCase().includes("LÍDER")
          ).length,

          SIMPATIZANTES_LLEVO: otros.filter(p =>
            String(p.TIPO || "").toUpperCase().includes("SIMPATIZANTE")
          ).length,

          ADVERSARIOS_LLEVO: otros.filter(p =>
            String(p.TIPO || "").toUpperCase().includes("ADVERSARIO")
          ).length
        };
      }

      async function showSectionInfo(feat) {
        ensureSecInfoPanelWired();
        const p = feat.properties || {};
        const sec = p.SECCION ?? "—";
        const df = p[FIELD_KEYS.df] ?? "—";
        const dl = p[FIELD_KEYS.dl] ?? "—";

        // LN 24DL_LN
        let ln = await getLN24DL(sec);
        if (ln == null) ln = "—";

        // Pintar
        const box = document.getElementById("sec-info");
        const ttl = box.querySelector(".ttl");
        if (ttl) ttl.textContent = `Sección ${sec}`;
        document.getElementById("si-sec").textContent = sec;
        document.getElementById("si-df").textContent = df;
        document.getElementById("si-dl").textContent = dl;
        document.getElementById("si-ln").textContent = ln;
        box.style.display = "block";
      }

      // ENTER + CLIC + ULTIMO TOKEN

      function currentNeedle(q) {
        if (!q) return "";
        const parts = String(q)
          .split(/[,;\s]+/)
          .filter(Boolean);
        return parts.length ? parts[parts.length - 1] : "";
      }

      // ===== Mini-selector de universo dentro del módulo =====
      let __mini = { selMun: null, selDf: null, selDl: null, all: null };

      function uniqueSorted(values) {
        const arr = values.map((v) => String(v ?? "").trim()).filter(Boolean);
        const set = Array.from(new Set(arr));
        return set.sort((a, b) =>
          isFinite(a) && isFinite(b)
            ? Number(a) - Number(b)
            : a.localeCompare(b, "es")
        );
      }
      function buildMiniOptions(raw) {
        const feats = raw.features || [];
        const grab = (k) => uniqueSorted(feats.map((f) => f.properties?.[k]));
        return {
          mun: grab(FIELD_KEYS.mun),
          df: grab(FIELD_KEYS.df),
          dl: grab(FIELD_KEYS.dl),
        };
      }
      function fillSelect(sel, arr) {
        sel.innerHTML =
          '<option value="">— Ninguno —</option>' +
          arr.map((v) => `<option value="${v}">${v}</option>`).join("");
      }
      function getMiniUniverse() {
        const { selMun, selDf, selDl, all } = __mini;
        if (all.checked)
          return { scope: "ALL", key: null, label: "Estado completo" };
        if (selMun.value)
          return {
            scope: "MUN",
            key: selMun.value,
            label: `Municipio ${selMun.options[selMun.selectedIndex].text}`,
          };
        if (selDf.value)
          return {
            scope: "DF",
            key: selDf.value,
            label: `Distrito Federal ${selDf.value}`,
          };
        if (selDl.value)
          return {
            scope: "DL",
            key: selDl.value,
            label: `Distrito Local ${selDl.value}`,
          };
        return null;
      }
      function miniExclusivity(which) {
        const { selMun, selDf, selDl, all } = __mini;
        if (which === "ALL") {
          selMun.value = "";
          selDf.value = "";
          selDl.value = "";
        }
        if (which === "MUN") {
          selDf.value = "";
          selDl.value = "";
          all.checked = false;
        }
        if (which === "DF") {
          selMun.value = "";
          selDl.value = "";
          all.checked = false;
        }
        if (which === "DL") {
          selMun.value = "";
          selDf.value = "";
          all.checked = false;
        }
        applyMiniUniverse();
      }
      function applyMiniUniverse() {
        const u2 = getMiniUniverse();
        if (!u2) return;
        // 1) Persistir
        localStorage.setItem(
          "AT_UNIVERSE",
          JSON.stringify({ ...u2, ts: Date.now() })
        );
        // 2) Redibujar con el nuevo universo usando el raw ya cargado
        const atMap = ensureLeafletMap();
        const filtered2 = filterGeojson(window.AT_DATA, u2);
        if (window.AT_CTX?.layer) {
          atMap.removeLayer(AT_CTX.layer);
        }
        const layer2 = L.geoJSON(filtered2, {
          style: { color: "#7d0025", weight: 1.2, fillOpacity: 0.15 },
        }).addTo(atMap);
        try {
          atMap.fitBounds(layer2.getBounds(), { padding: [20, 20] });
        } catch (e) {}
        window.AT_CTX = {
          ...(window.AT_CTX || {}),
          universe: u2,
          layer: layer2,
        };
        // 3) Header
        const hdr = document.querySelector("#panel-header span");
        if (hdr) {
          hdr.textContent = `Análisis Territorial · ${u2.label}`;
        }
        refreshSectionSearch(u2);
      }
      function initMiniSelector(raw, u) {
        // Guardar el geojson bruto para futuros re-filtros
        window.AT_DATA = raw;

        __mini.selMun = document.getElementById("mini-sel-mun");
        labelMunicipiosFromCatalog("#mini-sel-mun");

        __mini.selDf = document.getElementById("mini-sel-df");
        __mini.selDl = document.getElementById("mini-sel-dl");
        __mini.all = document.getElementById("mini-all-state");

        const opt = buildMiniOptions(raw);
        fillSelect(__mini.selMun, opt.mun);
        fillSelect(__mini.selDf, opt.df);
        fillSelect(__mini.selDl, opt.dl);

        // Reflejar el universo actual
        if (u.scope === "ALL") {
          __mini.all.checked = true;
        }
        if (u.scope === "MUN") {
          __mini.selMun.value = String(u.key);
        }
        if (u.scope === "DF") {
          __mini.selDf.value = String(u.key);
        }
        if (u.scope === "DL") {
          __mini.selDl.value = String(u.key);
        }

        async function labelMunicipiosFromCatalog(selectId) {
          const sel = document.querySelector(selectId);
          if (!sel) return;

          // 1) Ruta del catálogo desde el Portal (AT_PATHS) o fallback
          let catUrl = "../data/catalogo_territorial.json";
          try {
            const paths = JSON.parse(localStorage.getItem("AT_PATHS") || "{}");
            if (paths?.catalog) catUrl = paths.catalog;
          } catch {}

          // 2) Cargar catálogo
          let cat = null;
          try {
            const r = await fetch(catUrl);
            if (!r.ok) throw new Error("HTTP " + r.status);
            cat = await r.json();
          } catch (e) {
            console.warn("[AT] No se pudo cargar el catálogo:", e);
            return; // salimos sin tocar etiquetas
          }

          const mapa = cat?.municipios || {};
          // helper: si el catálogo trae ceros a la izquierda en las llaves
          const getName = (code) => {
            const s = String(code);
            return (
              mapa[s] ||
              mapa[s.padStart(2, "0")] ||
              mapa[s.padStart(3, "0")] ||
              s
            );
          };

          // 3) Reetiquetar opciones (sin cambiar value)
          for (const opt of sel.options) {
            if (!opt.value) continue; // deja "— Ninguno —"
            const name = getName(opt.value);
            opt.text = `${opt.value} — ${name}`;
          }
        }

        // Eventos (auto-ejecuta)
        __mini.selMun.addEventListener("change", () => miniExclusivity("MUN"));
        __mini.selDf.addEventListener("change", () => miniExclusivity("DF"));
        __mini.selDl.addEventListener("change", () => miniExclusivity("DL"));
        __mini.all.addEventListener("change", () => miniExclusivity("ALL"));
      }

      // Nombre fijo del campo (texto) del municipio
      const MUN_NAME_KEY = "MUNICIPIO";

      // Detecta automáticamente el campo de CÓDIGO de municipio (si no, usa el nombre)
      function detectMunCodeKey(raw) {
        const feats = raw.features || [];
        const candidates = [
          "MUN",
          "CVE_MUN",
          "CLV_MUN",
          "ID_MUN",
          "MUNICIPIO_ID",
          "MUNICIPIO_CVE",
          "CVE_MUNICIPIO",
          "CVE_MPIO",
        ];
        for (const k of candidates) {
          const ok = feats.some((f) => {
            const v = f.properties?.[k];
            return (
              v != null &&
              String(v).trim() !== "" &&
              String(v).toUpperCase() !== "NULL"
            );
          });
          if (ok) return k;
        }
        return null; // fallback será MUN_NAME_KEY
      }

      // —— Utils de texto ——
      function _norm(s) {
        if (s == null) return "";
        return String(s)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toUpperCase()
          .trim();
      }
      function _isDigits(s) {
        return /^[0-9]+$/.test(String(s || ""));
      }

      // —— Nombre de municipio desde catálogo (si existe) ——
      function getMunNameFromCatalog(code) {
        const cat = window.AT_CATALOG;
        if (!cat?.municipios) return String(code ?? "");
        const s = String(code);
        // maneja posibles ceros a la izquierda
        return (
          cat.municipios[s] ||
          cat.municipios[s.padStart(2, "0")] ||
          cat.municipios[s.padStart(3, "0")] ||
          s
        );
      }

      // —— Índice de secciones ——
      let __SEC_INDEX = { items: [], global: false };

      function buildSectionIndex(raw, universe, useGlobal) {
        const feats = raw?.features || [];
        const munKey = window.AT_KEYS?.munCode || FIELD_KEYS.mun;
        const items = [];

        // dataset base: global = todas, local = filtradas por universo
        const base = useGlobal
          ? feats
          : filterGeojson(raw, universe).features || [];

        for (const f of base) {
          const p = f.properties || {};
          const sec = p.SECCION ?? p.Seccion ?? p.seccion ?? null;
          if (sec == null) continue;

          const munCode = p[munKey];
          const munName = getMunNameFromCatalog(munCode);
          const df = p[FIELD_KEYS.df];
          const dl = p[FIELD_KEYS.dl];

          // texto para búsqueda
          const text = `${sec} ${munCode ?? ""} ${munName ?? ""} ${df ?? ""} ${
            dl ?? ""
          }`;
          // bounds (si multiparte, Leaflet lo resuelve)
          let bounds = null;
          try {
            bounds = L.geoJSON(f).getBounds();
          } catch (_) {}

          items.push({
            sec: String(sec).trim(),
            munCode: munCode,
            munName: munName,
            df,
            dl,
            feature: f,
            textNorm: _norm(text),
            bounds,
          });
        }

        __SEC_INDEX = { items, global: !!useGlobal };
      }

      function searchSections(query, limit = 15) {
        const q = _norm(query);
        if (!q) return [];
        const ds = __SEC_INDEX.items;

        // Heurística sencilla:
        // - si es numérico puro: prioridad a SECCION que empiece con q
        // - si no: contiene tokens
        if (_isDigits(q)) {
          const starts = ds.filter((it) => _norm(it.sec).startsWith(q));
          if (starts.length >= limit) return starts.slice(0, limit);
          const contains = ds.filter((it) => _norm(it.sec).includes(q));
          return [...starts, ...contains].slice(0, limit);
        } else {
          const tokens = q.split(/\s+/).filter(Boolean);
          return ds
            .filter((it) => tokens.every((t) => it.textNorm.includes(t)))
            .slice(0, limit);
        }
      }

      // —— UI de sugerencias ——
      let __SEC_HIGHLIGHT = null;

      function renderSecSuggestions(list) {
        const ul = document.getElementById("sec-suggest");
        if (!ul) return;
        if (!list.length) {
          ul.style.display = "none";
          ul.innerHTML = "";
          return;
        }

        ul.innerHTML = list
          .map((it) => {
            const label = `${it.sec} — ${
              it.munName || it.munCode || ""
            }`.replace(/\s+-\s+$/, "");
            const meta = [];
            if (it.dl != null) meta.push(`DL ${it.dl}`);
            if (it.df != null) meta.push(`DF ${it.df}`);
            const sub = meta.length
              ? `<small style="color:#64748b">${meta.join(" · ")}</small>`
              : "";
            return `<li data-sec="${it.sec}" style="padding:6px 8px; border-bottom:1px solid #e5e7eb; cursor:pointer">
                                <div>${label}</div>${sub}
                              </li>`;
          })
          .join("");
        ul.style.display = "block";
      }

      function gotoSection(item) {
        const atMap = window.AT_CTX?.map || ensureLeafletMap();

        // 1) Resolver el feature de la sección
        const sec = String(item.sec ?? item.SECCION ?? "");
        let feat = item.feature;

        if (!feat) {
          const feats =
            window.AT_CTX?.layer?.toGeoJSON?.().features ||
            window.AT_DATA?.features ||
            [];
          feat = feats.find((f) => String(f.properties?.SECCION) === sec);
        }

        if (!feat) {
          console.warn(
            "[AT] No encontré el feature para la sección",
            sec,
            item
          );
          return;
        }

        // En vez de function zoomToCurrentUniverse() { ... }
        window.zoomToCurrentUniverse = function () {
          const layer = getSeccionesLayer();
          if (!layer) {
            console.warn("[ET] No se encontró capa de secciones para zoom.");
            return;
          }

          const selMun = document.getElementById("mini-sel-mun");
          const selDl = document.getElementById("mini-sel-dl");
          const selDf = document.getElementById("mini-sel-df");
          const chkAll = document.getElementById("mini-all-state");

          let ambito = "ESTADO";
          let munVal = selMun?.value || "";
          let dlVal = selDl?.value || "";
          let dfVal = selDf?.value || "";
          const allOn =
            chkAll && (chkAll.checked || chkAll.classList?.contains("active"));

          if (!allOn) {
            if (dlVal) ambito = "DL";
            else if (dfVal) ambito = "DF";
            else if (munVal) ambito = "MUNICIPIO";
          }

          const bounds = L.latLngBounds([]);

          layer.eachLayer((lyr) => {
            const prop = lyr.feature?.properties || {};
            const municipio = (prop.MUNICIPIO || "").toString();
            const dl = Number(prop.DISTRITO_L ?? prop.DL ?? NaN);
            const df = Number(prop.DISTRITO_F ?? prop.DF ?? NaN);

            let incluye = false;

            if (ambito === "ESTADO") incluye = true;
            else if (ambito === "MUNICIPIO" && munVal)
              incluye = municipio === munVal;
            else if (ambito === "DL" && dlVal) incluye = dl === Number(dlVal);
            else if (ambito === "DF" && dfVal) incluye = df === Number(dfVal);

            if (incluye) {
              const b =
                typeof lyr.getBounds === "function" ? lyr.getBounds() : null;
              if (b && b.isValid()) bounds.extend(b);
            }
          });

          if (bounds.isValid()) {
            const map = window.AT_CTX?.map || ensureLeafletMap();
            if (map && typeof map.fitBounds === "function") {
              map.fitBounds(bounds, { padding: [40, 40] });
            } else {
              console.warn(
                "[ET] No se encontró un mapa Leaflet válido para fitBounds."
              );
            }
          } else {
            console.warn(
              "[ET] No se encontraron secciones para el ámbito actual:",
              ambito
            );
          }
        };

        // 2) Pintar selección + adyacentes + labels (esto limpia overlays previos)
        paintSelectionAndAdj(feat);

        // 3) Mostrar panel con DF, DL y LN (24DL_LN)
        showSectionInfo(feat);

        // 4) Feedback visual (parpadeo leve sobre el highlight actual)
        const hl = window.__SEC_HL;
        if (hl && typeof hl.setStyle === "function") {
          try {
            hl.setStyle({ weight: 4 });
            setTimeout(() => {
              try {
                hl.setStyle({ weight: 3 });
              } catch (_) {}
            }, 220);
          } catch (_) {}
        }

        // 5) Oculta la lista de sugerencias (si está visible)
        const ul = document.getElementById("sec-suggest");
        if (ul) ul.style.display = "none";

        seleccionarSeccionET27(item.sec);
      }

      // Delegación de clic en las sugerencias (una sola vez)
      (function wireSectionSearchEventsOnce() {
        const ul = document.getElementById("sec-suggest");
        const input = document.getElementById("sec-q");
        if (!ul || !input) return;

        // Si está dentro de un form, evita submit al Enter
        const form = input.closest("form");
        form?.addEventListener("submit", (e) => e.preventDefault());

        // Clic en cualquier <li data-sec="...">
        if (!ul.__wiredClick) {
          ul.addEventListener("click", (ev) => {
            const li = ev.target.closest("li[data-sec]");
            if (!li) return;
            const sec = li.getAttribute("data-sec");
            const item = (__SEC_INDEX?.items || []).find(
              (x) => String(x.sec) === String(sec)
            );
            if (item) gotoSection(item);
            ul.style.display = "none";
          });
          ul.__wiredClick = true;
        }

        // Enter en el input = ir al primer resultado
        if (!input.__wiredKey) {
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault(); // <- evita submit/autocomplete
              const results = searchSections(input.value, 1);
              const needle = currentNeedle(input.value);
              const [first] = searchSections(needle, 1);
              if (first) {
                gotoSection(first);

                // ⬇⬇ MOSTRAR PANEL ET-27 PARA LA SECCIÓN SELECCIONADA
                const sec = String(
                  first.SECCION ??
                    first.sec ??
                    first.id ??
                    first.properties?.SECCION ??
                    ""
                ).trim();
                if (sec) openETPanelForSection(sec);
              }
              ul.style.display = "none";
            }
            if (ev.key === "Escape") {
              ul.style.display = "none";
            }
          });
          input.__wiredKey = true;
        }

        // Input: recalcula sugerencias usando el "último token"
        if (!input.__wiredInput) {
          input.addEventListener("input", () => {
            const needle = currentNeedle(input.value);
            renderSecSuggestions(searchSections(needle, 15));
          });
          input.__wiredInput = true;
        }
      })();

      function initET27DragResize() {
        const panel = document.getElementById("et27-sec-panel");
        if (!panel) {
          console.warn("[ET] panel no encontrado");
          return;
        }
        if (AT_isDockedPanel(panel)) return;

        const header = panel.querySelector(".hdr");
        const resizer = panel.querySelector(".et27-resizer");

        console.log("[ET] drag/resize init", {
          panel: !!panel,
          header: !!header,
          resizer: !!resizer,
        });

        const POS_KEY = "ET27_PANEL_POS";
        const SIZE_KEY = "ET27_PANEL_SIZE";

        // Restaurar tamaño/posición guardados
        try {
          const s = JSON.parse(localStorage.getItem(SIZE_KEY) || "null");
          if (s && s.w && s.h) {
            panel.style.width = s.w + "px";
            panel.style.height = s.h + "px";
            panel.style.maxHeight = "80vh";
            panel.style.overflow = "auto";
          }
          const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
          if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
            panel.style.right = "auto";
            panel.style.left = p.left + "px";
            panel.style.top = p.top + "px";
          }
        } catch (_) {}

        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        const bounds = () => {
          const pad = 8,
            vw = innerWidth,
            vh = innerHeight,
            pw = panel.offsetWidth,
            ph = panel.offsetHeight;
          return {
            minL: pad,
            maxL: vw - pw - pad,
            minT: pad,
            maxT: vh - ph - pad,
          };
        };

        // Drag
        let drag = null;
        function onDragStart(ev) {
          if (ev.target.closest(".x")) return;
          const e = (ev.touches && ev.touches[0]) || ev;
          const r = panel.getBoundingClientRect();
          drag = { ox: e.clientX, oy: e.clientY, left: r.left, top: r.top };
          panel.style.right = "auto";
          panel.style.left = r.left + "px";
          panel.style.top = r.top + "px";
          document.body.classList.add("et27-dragging");
          addEventListener("mousemove", onDragMove);
          addEventListener("mouseup", onDragEnd);
          addEventListener("touchmove", onDragMove, { passive: false });
          addEventListener("touchend", onDragEnd);
        }
        function onDragMove(ev) {
          if (!drag) return;
          const e = (ev.touches && ev.touches[0]) || ev;
          const dx = e.clientX - drag.ox,
            dy = e.clientY - drag.oy,
            b = bounds();
          panel.style.left = clamp(drag.left + dx, b.minL, b.maxL) + "px";
          panel.style.top = clamp(drag.top + dy, b.minT, b.maxT) + "px";
          ev.preventDefault?.();
        }
        function onDragEnd() {
          if (!drag) return;
          document.body.classList.remove("et27-dragging");
          const r = panel.getBoundingClientRect();
          localStorage.setItem(
            "ET27_PANEL_POS",
            JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })
          );
          removeEventListener("mousemove", onDragMove);
          removeEventListener("mouseup", onDragEnd);
          removeEventListener("touchmove", onDragMove);
          removeEventListener("touchend", onDragEnd);
          drag = null;
        }
        header?.addEventListener("mousedown", onDragStart);
        header?.addEventListener("touchstart", onDragStart, { passive: true });

        // Resize
        let rez = null;
        function onResizeStart(ev) {
          const e = (ev.touches && ev.touches[0]) || ev;
          rez = {
            ox: e.clientX,
            oy: e.clientY,
            w: panel.offsetWidth,
            h: panel.offsetHeight,
          };
          panel.style.maxHeight = "80vh";
          panel.style.overflow = "auto";
          document.body.classList.add("et27-resizing");
          addEventListener("mousemove", onResizeMove);
          addEventListener("mouseup", onResizeEnd);
          addEventListener("touchmove", onResizeMove, { passive: false });
          addEventListener("touchend", onResizeEnd);
          ev.preventDefault?.();
        }
        function onResizeMove(ev) {
          if (!rez) return;
          const e = (ev.touches && ev.touches[0]) || ev;
          const dx = e.clientX - rez.ox,
            dy = e.clientY - rez.oy;
          const minW = 340,
            minH = 260,
            maxW = Math.min(innerWidth - 24, 680),
            maxH = Math.min(innerHeight - 24, 800);
          panel.style.width = clamp(rez.w + dx, minW, maxW) + "px";
          panel.style.height = clamp(rez.h + dy, minH, maxH) + "px";
          ev.preventDefault?.();
        }
        function onResizeEnd() {
          if (!rez) return;
          document.body.classList.remove("et27-resizing");
          localStorage.setItem(
            "ET27_PANEL_SIZE",
            JSON.stringify({
              w: Math.round(panel.offsetWidth),
              h: Math.round(panel.offsetHeight),
            })
          );
          removeEventListener("mousemove", onResizeMove);
          removeEventListener("mouseup", onResizeEnd);
          removeEventListener("touchmove", onResizeMove);
          removeEventListener("touchend", onResizeEnd);
          rez = null;
        }
        resizer?.addEventListener("mousedown", onResizeStart);
        resizer?.addEventListener("touchstart", onResizeStart, {
          passive: true,
        });

        // Mantener dentro del viewport al cambiar tamaño de ventana
        addEventListener("resize", () => {
          const r = panel.getBoundingClientRect(),
            b = bounds();
          panel.style.left = clamp(r.left, b.minL, b.maxL) + "px";
          panel.style.top = clamp(r.top, b.minT, b.maxT) + "px";
        });
      }

      // hazla visible globalmente (por si la llamas desde consola)
      window.initET27DragResize = initET27DragResize;

      // —— Inicializar Buscador en el módulo ——
      function initSectionSearch(raw, universe) {
        const input = document.getElementById("sec-q");
        const list = document.getElementById("sec-suggest");
        const globalC = document.getElementById("sec-global");
        if (!input || !list) return;

        // construir índice (por universo actual)
        buildSectionIndex(raw, universe, !!globalC?.checked);

        // Cambiar ámbito (global / universo actual)
        globalC?.addEventListener("change", () => {
          buildSectionIndex(raw, universe, !!globalC.checked);
          // refresca sugerencias con la query actual
          if (input.value) {
            renderSecSuggestions(searchSections(input.value, 15));
          }
        });
      }

      // —— Cuando cambies de universo con tu mini-selector, reindexa ——
      function refreshSectionSearch(universe) {
        const input = document.getElementById("sec-q");
        const globalC = document.getElementById("sec-global");
        if (!window.AT_DATA || !input) return;
        buildSectionIndex(window.AT_DATA, universe, !!globalC?.checked);
        if (input.value) {
          renderSecSuggestions(searchSections(input.value, 15));
        }
      }

      function getRawForIndex() {
        // Usa el dataset completo si ya lo cacheaste
        if (window.AT_DATA) return window.AT_DATA;
        // Si no, al menos usa lo ya pintado en el mapa
        const lyr = window.AT_CTX?.layer;
        return lyr && typeof lyr.toGeoJSON === "function"
          ? lyr.toGeoJSON()
          : null;
      }

      // ===== 3) Boot =====
      document.addEventListener("DOMContentLoaded", async () => {
        AT_dockPanel(document.getElementById("sec-info"));
        AT_dockPanel(document.getElementById("et27-toolbar"));
        AT_dockPanel(document.getElementById("et27-toolbar-tab"));
        AT_dockPanel(document.getElementById("et27-panel"));
        AT_dockPanel(document.getElementById("et27-sec-panel"));
        AT_watchDockPanels();

        // a) Leer universo y rutas puestos en el PORTAL
        const u = JSON.parse(localStorage.getItem("AT_UNIVERSE") || "null");
        const paths = JSON.parse(
          localStorage.getItem("AT_PATHS") || '{"geo":""}'
        );
        if (!u) {
          const hdr = document.querySelector("#panel-header span");
          hdr && (hdr.textContent += " · selecciona el universo en el Portal");
          setTimeout(() => {
            location.href = "../portal/portal.html";
          }, 600);
          return;
        }

        // b) Etiqueta del universo
        const hdr = document.querySelector("#panel-header span");
        hdr && (hdr.textContent += ` · ${u.label}`);

        // c) Mapa único
        const atMap = ensureLeafletMap();
        assertIsLeafletMap(atMap);

        // d) Cargar y filtrar GeoJSON
        const url = paths.geo || "../data/geo/secciones.geojson"; // <-- ajusta si tu ruta difiere

        // Cargar catálogo territorial (para nombres visibles)
        const catUrl =
          (paths.catalog && paths.catalog.trim()) ||
          "../data/catalogo_territorial.json";
        let catalog = window.AT_CATALOG || null;
        if (!catalog) {
          try {
            const rc = await fetch(catUrl);
            if (!rc.ok)
              throw new Error(`HTTP ${rc.status} al cargar catálogo ${catUrl}`);
            catalog = await rc.json();
            window.AT_CATALOG = catalog;
          } catch (err) {
            console.warn("[AT] No se pudo cargar el catálogo de nombres:", err);
            window.AT_CATALOG = catalog = null; // seguimos sin nombres amigables
          }
        }

        let raw = window.AT_DATA || null; // usa caché si ya existe
        if (!raw) {
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${url}`);
            raw = await res.json(); // ✅ solo una vez
            window.AT_DATA = raw; // ✅ guarda en caché aquí
          } catch (err) {
            console.error("[AT] Error cargando GeoJSON:", err);
            alert("No se pudo cargar el GeoJSON");
            return;
          }
        }
        // a partir de aquí, usa 'raw'

        const filtered = filterGeojson(raw, u);
        console.log(
          "[AT] Universo:",
          u,
          "Total:",
          raw.features?.length || 0,
          "Filtradas:",
          filtered.features?.length || 0
        );

        if (!filtered.features || filtered.features.length === 0) {
          console.warn(
            "[AT] No hay geometrías para el universo seleccionado:",
            u
          );
          alert("No hay datos para el universo seleccionado");
        }

        // Nombre fijo del campo (texto) del municipio
        const MUN_NAME_KEY = "MUNICIPIO";

        // Detecta campo de CÓDIGO (si existe); si no, usa el de nombre
        function detectMunCodeKey(raw) {
          const feats = raw.features || [];
          const candidates = [
            "MUN",
            "CVE_MUN",
            "CLV_MUN",
            "ID_MUN",
            "MUNICIPIO_ID",
            "MUNICIPIO_CVE",
            "CVE_MUNICIPIO",
            "CVE_MPIO",
          ];
          for (const k of candidates) {
            if (feats.some((f) => (f.properties?.[k] ?? "") !== "")) return k;
          }
          return null;
        }

        const munCodeKey = detectMunCodeKey(raw) || MUN_NAME_KEY; // fallback: nombre
        FIELD_KEYS.mun = munCodeKey;
        window.AT_KEYS = { munCode: munCodeKey, munName: MUN_NAME_KEY };

        // e) Dibujar capa
        const layer = L.geoJSON(filtered, {
          style: { color: "#000000", weight: 1.2, fillOpacity: 0.15 },
          onEachFeature: (feat, lyr) => {
            const p = feat.properties || {};
            const muni = p[FIELD_KEYS.mun] ?? "—";
            const dl = p[FIELD_KEYS.dl] ?? "—";
            const df = p[FIELD_KEYS.df] ?? "—";

            lyr.bindPopup(
              `<b>Sección</b>: ${
                p.SECCION ?? "—"
              }<br><b>Mun</b>: ${muni}<br><b>DL</b>: ${dl}<br><b>DF</b>: ${df}`
            );

            lyr.on("mouseover", () => lyr.setStyle({ weight: 2 }));
            lyr.on("mouseout", () => lyr.setStyle({ weight: 1.2 }));

            lyr.on("click", () => {
              seleccionarSeccionET27(p.SECCION);
            });
          },
        }).addTo(atMap);

        try {
          atMap.fitBounds(layer.getBounds(), { padding: [20, 20] });
        } catch (e) {}
        window.AT_CTX = { universe: u, paths, map: atMap, layer };

        function getMunNameFromCatalog(code) {
          const cat = window.AT_CATALOG;
          if (!cat?.municipios) return String(code ?? "");
          return cat.municipios[String(code)] || String(code ?? "");
        }
        function getDfListFromCatalog(feats) {
          return window.AT_CATALOG?.distritos_federales &&
            window.AT_CATALOG.distritos_federales.length
            ? window.AT_CATALOG.distritos_federales
            : uniqSorted(feats.map((f) => f.properties?.[FIELD_KEYS.df]));
        }
        function getDlListFromCatalog(feats) {
          return window.AT_CATALOG?.distritos_locales &&
            window.AT_CATALOG.distritos_locales.length
            ? window.AT_CATALOG.distritos_locales
            : uniqSorted(feats.map((f) => f.properties?.[FIELD_KEYS.dl]));
        }
        initMiniSelector(raw, u);
        initSectionSearch(window.AT_DATA || raw, u);
      });

      (function wireATHotkeys() {
        if (window.__AT_HOTKEYS) return;
        window.__AT_HOTKEYS = true;

        window.addEventListener("keydown", (e) => {
          // Esc: cerrar panel
          if (e.key === "Escape") {
            if (document.getElementById("sec-info")?.style.display !== "none") {
              e.preventDefault();
              closeSecInfoPanel();
            }
          }
          // Ctrl+K (o Cmd+K en Mac): enfocar buscador de secciones
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            document.getElementById("sec-q")?.focus();
          }
        });
      })();
    

// ---- inline block separator ----

      /* ===== ET-27 core ===== */
      const ET27_CFG = {
        get paths() {
          const p = JSON.parse(localStorage.getItem("AT_PATHS") || "{}");
          const et = p.et27 || {};
          return {
            puntos: et.puntos || "../data/campo/puntos_campo.geojson",
            casillas: et.casillas || "../data/casillas/puntos_casillas.geojson",
            secciones: p.geo || "../data/geo/secciones.geojson",
          };
        },
        rolesColor: {
          SIMPATIZANTE: "#6CAB5A",
          LIDER: "#D4A017",
          ADVERSARIO: "#D9534F",
          REP_CASILLA: "#1F77B4",
          REP_GENERAL: "#6F42C1",
          OBSERVADOR: "#2AA198",
        },
        cobertura: {
          rep_por_casilla: 2,
          obs_por_casilla: 0,
          rep_general_por_seccion: 1,
        },
      };

      // Padrón de ediciones hechas desde el panel ET-27
      const ET27_EDITS = new Map();
      // key: id persona, val: objeto con los campos editados

      function getPersonasBySection(secId) {
        if (!window.__ET_PERS_INDEX) return [];

        const key = String(secId);

        let raw;

        // Caso 1: __ET_PERS_INDEX es un Map
        if (typeof window.__ET_PERS_INDEX.get === "function") {
          raw = window.__ET_PERS_INDEX.get(key);
        } else {
          // Caso 2: es un objeto plano { "1428": [...] }
          raw = window.__ET_PERS_INDEX[key];
        }

        if (!raw) return [];

        // ✔ Si ya es arreglo de personas:
        //    - y sus elementos NO son arreglos → lo regresamos tal cual
        // ✔ Si es arreglo de arreglos (tu caso): lo aplanamos
        if (Array.isArray(raw)) {
          if (raw.length > 0 && Array.isArray(raw[0])) {
            // array de arrays -> flatten a 1 nivel
            return raw.flat();
          }
          // array simple de personas
          return raw;
        }

        // Si es objeto con listas por rol, tipo:
        // { repCasilla:[...], repSeccion:[...], coord:[...], otros:[...] }
        if (typeof raw === "object") {
          const vals = Object.values(raw);
          if (!vals.length) return [];
          if (Array.isArray(vals[0])) {
            return vals.flat();
          }
          return vals;
        }

        return [];
      }

      const ET27 = {
        map: null,
        grpPoints: null,
        grpCasillas: null,
        grpSecCover: null,
        data: { puntos: null, casillas: null, secciones: null },
        faltantes: [],

        ensureMap() {
          if (!this.map) {
            if (typeof ensureLeafletMap === "function")
              this.map = ensureLeafletMap();
            else this.map = L.map("map").setView([21.12, -101.68], 10);
          }
          return this.map;
        },

        async loadAll() {
          const { puntos, casillas, secciones } = ET27_CFG.paths;
          const fetchJSON = async (u) => {
            const r = await fetch(u);
            if (!r.ok) throw new Error(`HTTP ${r.status} en ${u}`);
            return r.json();
          };

          const [pts, cas, secc] = await Promise.allSettled([
            fetchJSON(puntos),
            fetchJSON(casillas),
            window.AT_CTX?.layer
              ? Promise.resolve(window.AT_CTX.layer.toGeoJSON())
              : fetchJSON(secciones),
          ]);

          this.data.puntos =
            pts.status === "fulfilled"
              ? pts.value
              : { type: "FeatureCollection", features: [] };
          this.data.casillas =
            cas.status === "fulfilled"
              ? cas.value
              : { type: "FeatureCollection", features: [] };
          this.data.secciones =
            secc.status === "fulfilled"
              ? secc.value
              : { type: "FeatureCollection", features: [] };

          // Si hay universo activo en tu app, filtramos a ese universo
          const u = window.AT_CTX?.universe;
          if (u) {
            const keyMap = {
              MUN: "MUNICIPIO",
              DF: "DISTRITO_F",
              DL: "DISTRITO_L",
            };
            const fk = keyMap[u.scope];
            if (fk) {
              const k = String(u.key);
              const by = (fc, kfield) => ({
                type: "FeatureCollection",
                features: (fc.features || []).filter(
                  (f) => String(f.properties?.[kfield] ?? "") === k
                ),
              });
              this.data.puntos = by(this.data.puntos, fk);
              this.data.casillas = by(this.data.casillas, fk);
              if (!window.AT_CTX?.layer) {
                this.data.secciones = by(this.data.secciones, fk);
              }
            }
          }

          this.paintPoints();
          this.paintCasillas();
          this.updateKPIs();
          document.getElementById("et27-legend").style.display = "block";
        },

        paintPoints() {
          const m = this.ensureMap();
          if (this.grpPoints) {
            try {
              m.removeLayer(this.grpPoints);
            } catch (_) {}
            this.grpPoints = null;
          }

          const cluster = L.markerClusterGroup({
            disableClusteringAtZoom: 15,
            spiderfyOnMaxZoom: true,
          });
          (this.data.puntos.features || []).forEach((f) => {
            const p = f.properties || {},
              c = f.geometry?.coordinates;
            if (!c) return;
            const role = String(p.TIPO || "").toUpperCase();
            const color = ET27_CFG.rolesColor[role] || "#111827";
            const icon = L.divIcon({
              className: "et27-role-dot",
              html: `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};border:1px solid #11182722"></span>`,
              iconSize: [10, 10],
            });
            const mk = L.marker([c[1], c[0]], { icon });
            mk.bindPopup(`<div style="min-width:220px">
        <div style="font-weight:700">${p.NOMBRE || "—"}</div>
        <div><b>Tipo:</b> ${role}</div>
        <div><b>Sección:</b> ${p.SECCION ?? "—"}</div>
        <div><b>Municipio:</b> ${p.MUNICIPIO_NOMBRE ?? p.MUNICIPIO ?? "—"}</div>
        <div><b>Tel:</b> ${p.TELEFONO ?? "—"}</div>
        ${p.CASILLA_ID ? `<div><b>Casilla:</b> ${p.CASILLA_ID}</div>` : ""}
        ${p.PROMOTOR_PIN ? `<div><b>Promotor:</b> ${p.PROMOTOR_PIN}</div>` : ""}
        <div style="font-size:11px;color:#64748b">${p.ESTATUS ?? "ACTIVO"}</div>
      </div>`);
            cluster.addLayer(mk);
          });
          this.grpPoints = cluster.addTo(m);
        },

        paintCasillas() {
          const m = this.ensureMap();
          if (this.grpCasillas) {
            try {
              m.removeLayer(this.grpCasillas);
            } catch (_) {}
            this.grpCasillas = null;
          }

          const g = L.layerGroup();
          const req = ET27_CFG.cobertura.rep_por_casilla;

          const repsByCasilla = {};
          (this.data.puntos.features || []).forEach((f) => {
            const p = f.properties || {};
            if (String(p.TIPO || "").toUpperCase() !== "REP_CASILLA") return;
            const id = p.CASILLA_ID || null;
            if (!id) return;
            repsByCasilla[id] = (repsByCasilla[id] || 0) + 1;
          });

          (this.data.casillas.features || []).forEach((f) => {
            const p = f.properties || {},
              c = f.geometry?.coordinates;
            if (!c) return;
            const cid =
              p.CASILLA_ID || (p.SECCION || "") + "-" + (p.TIPO_CASILLA || "");
            const asig = repsByCasilla[cid] || 0;
            let est = "NONE";
            if (asig >= req) est = "COVERED";
            else if (asig > 0) est = "PARTIAL";
            const fill =
              est === "COVERED"
                ? "#2ca02c"
                : est === "PARTIAL"
                ? "#ffbf00"
                : "#d62728";
            const icon = L.divIcon({
              className: "et27-casilla-dot",
              html: `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${fill};border:1px solid #11182722"></span>`,
              iconSize: [12, 12],
            });
            L.marker([c[1], c[0]], { icon })
              .bindPopup(
                `<div style="min-width:220px">
          <div style="font-weight:700">Casilla ${cid}</div>
          <div><b>Sección:</b> ${p.SECCION ?? "—"}</div>
          <div><b>Tipo:</b> ${p.TIPO_CASILLA ?? "B"}</div>
          <div><b>Req.Rep:</b> ${req}</div>
          <div><b>Asig.Rep:</b> ${asig}</div>
          <div><b>Estatus:</b> ${est}</div>
          ${p.DOMICILIO ? `<div><b>Domicilio:</b> ${p.DOMICILIO}</div>` : ""}
        </div>`
              )
              .addTo(g);
          });

          this.grpCasillas = g.addTo(m);
        },

        computeCoverageBySection() {
          const req = ET27_CFG.cobertura.rep_por_casilla;
          const casBySec = {};
          (this.data.casillas.features || []).forEach((f) => {
            const s = String(f.properties?.SECCION ?? "");
            if (!s) return;
            (casBySec[s] = casBySec[s] || []).push(f);
          });

          const repsByCasilla = {};
          (this.data.puntos.features || []).forEach((f) => {
            const p = f.properties || {};
            if (String(p.TIPO || "").toUpperCase() !== "REP_CASILLA") return;
            const id = p.CASILLA_ID || null;
            if (id) repsByCasilla[id] = (repsByCasilla[id] || 0) + 1;
          });

          const summary = {};
          Object.keys(casBySec).forEach((sec) => {
            const list = casBySec[sec];
            let covered = 0,
              partial = 0,
              none = 0,
              reqTot = 0,
              asigTot = 0;
            list.forEach((cf) => {
              const cid =
                cf.properties?.CASILLA_ID ||
                `${sec}-${cf.properties?.TIPO_CASILLA || ""}`;
              const asig = repsByCasilla[cid] || 0;
              asigTot += asig;
              reqTot += req;
              if (asig >= req) covered++;
              else if (asig > 0) partial++;
              else none++;
            });
            const total = list.length || 0;
            const pct = total ? Math.round((covered / total) * 100) : 0;
            summary[sec] = {
              total,
              covered,
              partial,
              none,
              reqTot,
              asigTot,
              pct,
            };
          });

          this.faltantes = Object.entries(summary)
            .map(([sec, s]) => {
              const faltan = Math.max(0, s.reqTot - s.asigTot);
              let est = "NONE";
              if (s.covered === s.total && s.total > 0) est = "COVERED";
              else if (s.covered > 0 || s.partial > 0) est = "PARTIAL";
              return {
                ambito: "SECCION",
                clave: sec,
                casillas: s.total,
                req: s.reqTot,
                asig: s.asigTot,
                faltan,
                est,
                pct: s.pct,
              };
            })
            .sort((a, b) => b.faltan - a.faltan);

          return summary;
        },

        paintSectionCoverage() {
          const m = this.ensureMap();
          if (this.grpSecCover) {
            try {
              m.removeLayer(this.grpSecCover);
            } catch (_) {}
            this.grpSecCover = null;
          }

          const sum = this.computeCoverageBySection();
          const layer = L.geoJSON(this.data.secciones, {
            style: (feat) => {
              const sec = String(feat.properties?.SECCION ?? "");
              const s = sum[sec] || { pct: 0 };
              const pct = s.pct;
              let fill = "#fee2e2";
              if (pct >= 100) fill = "#dcfce7";
              else if (pct >= 50) fill = "#fde68a";
              return {
                color: "#64748b",
                weight: 1,
                fillColor: fill,
                fillOpacity: 0.55,
              };
            },
            onEachFeature: (f, ly) => {
              const sec = String(f.properties?.SECCION ?? "");
              const s = sum[sec] || {
                total: 0,
                covered: 0,
                partial: 0,
                none: 0,
                reqTot: 0,
                asigTot: 0,
                pct: 0,
              };
              ly.bindTooltip(`Sección ${sec}: ${s.pct}%`, { sticky: true });
              ly.on("click", () => {
                try {
                  this.map.fitBounds(ly.getBounds(), { padding: [20, 20] });
                } catch (_) {}
              });
            },
          });
          this.grpSecCover = layer.addTo(m);
        },

        updateKPIs() {
          const pts = (this.data.puntos.features || []).length;
          const cas = (this.data.casillas.features || []).length;
          const secSum = this.computeCoverageBySection();
          const keys = Object.keys(secSum);
          const secCovered = keys.filter((k) => secSum[k].pct >= 100).length;

          const req = ET27_CFG.cobertura.rep_por_casilla;
          const repsByCasilla = {};
          (this.data.puntos.features || []).forEach((f) => {
            const p = f.properties || {};
            if (String(p.TIPO || "").toUpperCase() !== "REP_CASILLA") return;
            const id = p.CASILLA_ID || null;
            if (id) repsByCasilla[id] = (repsByCasilla[id] || 0) + 1;
          });
          let total = 0,
            cub = 0;
          (this.data.casillas.features || []).forEach((cf) => {
            total++;
            const cid =
              cf.properties?.CASILLA_ID ||
              `${cf.properties?.SECCION || ""}-${
                cf.properties?.TIPO_CASILLA || ""
              }`;
            const asig = repsByCasilla[cid] || 0;
            if (asig >= req) cub++;
          });
          const pctCas = total ? Math.round((cub / total) * 100) : 0;
        },

        openFaltantes() {
          const tb = document.querySelector("#et27-table tbody");
          tb.innerHTML = "";
          this.faltantes.forEach((r) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${r.ambito}</td><td>${r.clave}</td><td>${r.casillas}</td>
                      <td>${r.req}</td><td>${r.asig}</td><td><b>${r.faltan}</b></td><td>${r.est}</td>`;
            tr.style.cursor = "pointer";
            tr.addEventListener("click", () => {
              if (this.grpSecCover) {
                const sec = r.clave;
                this.grpSecCover.eachLayer((ly) => {
                  if (
                    String(ly.feature?.properties?.SECCION ?? "") ===
                    String(sec)
                  ) {
                    try {
                      this.map.fitBounds(ly.getBounds(), { padding: [20, 20] });
                    } catch (_) {}
                  }
                });
              }
            });
            tb.appendChild(tr);
          });
          document.getElementById("et27-panel").style.display = "block";
        },
        closeFaltantes() {
          document.getElementById("et27-panel").style.display = "none";
        },

        exportCSV() {
          const rows = [
            [
              "Scope",
              "Key",
              "PollingPlaces",
              "ReqReps",
              "Assigned",
              "Missing",
              "Status",
              "PctSection",
            ],
          ];
          this.faltantes.forEach((r) =>
            rows.push([
              r.ambito,
              r.clave,
              r.casillas,
              r.req,
              r.asig,
              r.faltan,
              r.est,
              r.pct,
            ])
          );
          const csv = rows
            .map((r) =>
              r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
            )
            .join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "ET27_faltantes.csv";
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        },
      };

      // Wire de botones (se monta una sola vez)
      (function () {
        const $ = (s) => document.querySelector(s);
        $("#et27-export-csv")?.addEventListener("click", () =>
          ET27.exportCSV()
        );
        $("#et27-close-panel")?.addEventListener("click", () =>
          ET27.closeFaltantes()
        );
      })();

      /* ========= ET-27: CARGA DE PUNTOS (CLUSTER) ========= */

      const ET27_COLORS_BY_TIPO = {
        SIMPATIZANTE: "#6cab5a",
        LÍDER: "#d4a017",
        LIDER: "#d4a017",
        ADVERSARIO: "#d9534f",
        REP_CASILLA: "#1f77b4",
        REP_GENERAL: "#6f42c1",
        OBSERVADOR: "#2aa198",
      };
      function colorForTipo(t) {
        const k = String(t || "")
          .trim()
          .toUpperCase();
        return ET27_COLORS_BY_TIPO[k] || "#888888";
      }

      /** 3) Capa cluster y helpers */
      let ET27_CLUSTER = null;
      let ET27_POINTS_COUNT = 0;

      function ensureCluster() {
        if (ET27_CLUSTER) return ET27_CLUSTER;
        ET27_CLUSTER = L.markerClusterGroup({
          showCoverageOnHover: false,
          spiderfyOnEveryZoom: false,
          maxClusterRadius: 48,
        }).addTo(ensureLeafletMap());
        return ET27_CLUSTER;
      }

      /** 4) Crear marker desde feature GeoJSON */
      function markerFromFeature(feature, latlng) {
        const p = feature.properties || {};
        const col = colorForTipo(p.TIPO);
        const html = `
    <div style="
      width:14px;height:14px;border-radius:50%;
      background:${col};border:1px solid #11182722;
      box-shadow:0 1px 4px rgba(0,0,0,.25);
    "></div>`;
        const icon = L.divIcon({ html, className: "", iconSize: [14, 14] });

        const m = L.marker(latlng, { icon });

        // Popup bonito y compacto
        const safe = (v) => (v == null ? "—" : String(v));
        m.bindPopup(`
    <div style="font:12px/1.3 'Segoe UI',Arial">
      <div style="font-weight:700;margin-bottom:4px">${safe(p.NOMBRE)}</div>
      <div><b>Tipo:</b> ${safe(p.TIPO)}</div>
      <div><b>Tel.:</b> ${safe(p.TELEFONO)}</div>
      <div><b>Sección:</b> ${safe(p.SECCION)}</div>
      <div><b>Promotor PIN:</b> ${safe(p.PROMOTOR_PIN)}</div>
      <hr style="border:none;border-top:1px solid #eee;margin:6px 0" />
      <div style="color:#64748b">${safe(p.DOMICILIO)}</div>
    </div>
  `);
        return m;
      }

      /** 5) Cargar GeoJSON y pintar */
      async function loadET27Points() {
        try {
          const res = await fetch(ET27_POINTS_URL, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status} al cargar puntos`);
          const gj = await res.json();

          const cluster = ensureCluster();
          cluster.clearLayers();
          ET27_POINTS_COUNT = 0;

          const layer = L.geoJSON(gj, {
            pointToLayer: (feat, latlng) => {
              ET27_POINTS_COUNT++;
              return markerFromFeature(feat, latlng);
            },
          });

          cluster.addLayer(layer);

          // Ajuste de vista
          try {
            const b = cluster.getBounds();
            if (b && b.isValid())
              ensureLeafletMap().fitBounds(b, { padding: [24, 24] });
          } catch (_) {}

          // Asegura que la leyenda se muestre
          document.getElementById("et27-legend")?.style &&
            (document.getElementById("et27-legend").style.display = "block");

          console.log(`[ET-27] Puntos cargados: ${ET27_POINTS_COUNT}`);
        } catch (err) {
          console.error("[ET-27] Error al cargar puntos:", err);
          alert(
            "No se pudo cargar los puntos ET-27. Revisa la ruta del GeoJSON en ET27_POINTS_URL."
          );
        }
      }

      // === ET-27: Cobertura por Casilla — Carga y pinta ===
      const CASILLAS_URL = "../data/casillas/puntos_casillas.geojson";

      let ET27_CASILLAS_LAYER = null;

      function styleCasilla() {
        return {
          radius: 5,
          weight: 1,
          color: "#11182722", // borde tenue
          fillColor: "#2ca02c", // verde base (luego aplicamos cub/part/sin)
          fillOpacity: 0.9,
        };
      }

      async function loadCasillasET27() {
        try {
          const res = await fetch(CASILLAS_URL, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status} al cargar casillas`);

          const gj = await res.json();

          // Limpia capa previa
          if (
            ET27_CASILLAS_LAYER &&
            ensureLeafletMap().hasLayer(ET27_CASILLAS_LAYER)
          ) {
            ensureLeafletMap().removeLayer(ET27_CASILLAS_LAYER);
          }

          ET27_CASILLAS_LAYER = L.geoJSON(gj, {
            pointToLayer: (f, latlng) => L.circleMarker(latlng, styleCasilla()),
            onEachFeature: (f, m) => {
              const p = f.properties || {};
              m.bindPopup(
                `<div style="font:12px/1.3 'Segoe UI',Arial">
             <div style="font-weight:700;margin-bottom:4px">${
               p.ID_CASILLA || "Casilla"
             }</div>
             <div><b>Sección:</b> ${p.SECCION || "—"}</div>
             <div><b>Tipo:</b> ${p.TIPO || "—"}</div>
             <hr style="border:none;border-top:1px solid #eee;margin:6px 0" />
             <div style="color:#64748b">${p.DOMICILIO || ""}</div>
           </div>`
              );
            },
          }).addTo(ensureLeafletMap());

          // Ajuste de vista
          try {
            const b = ET27_CASILLAS_LAYER.getBounds();
            if (b && b.isValid())
              ensureLeafletMap().fitBounds(b, { padding: [24, 24] });
          } catch (_) {}

          // KPI Casillas
          const casillasCount = (gj.features || []).length;

          // Muestra la leyenda si estuviera oculta
          document.getElementById("et27-legend")?.style &&
            (document.getElementById("et27-legend").style.display = "block");

          console.log(`[ET-27] Casillas cargadas: ${casillasCount}`);
        } catch (err) {
          console.error("[ET-27] Error al cargar casillas:", err);
          alert(
            "No se pudo cargar ubi_casillas.geojson. Revisa la ruta y vuelve a intentar."
          );
        }
      }

      // ========= UTIL: localizar capa de SECCIONES =========
      function getSeccionesLayer() {
        // Si guardaste una ref global, úsala aquí (e.g., window.capaSecciones)
        if (window.capaSecciones) {
          console.debug(
            "[ET] getSeccionesLayer: reusando window.capaSecciones"
          );
          return window.capaSecciones;
        }

        // Fallback: busca por tipo y por propiedad .feature
        let candidate = null;
        // Asegurarnos de usar el mapa singleton creado por ensureLeafletMap()
        const m = ensureLeafletMap();
        console.debug("[ET] getSeccionesLayer: escaneando capas en mapa...");
        m.eachLayer((l) => {
          try {
            const info = l && l.constructor && l.constructor.name;
            // debug: informar tipo de capa encontrada
            console.debug(
              "[ET] capa encontrada:",
              info,
              l?.feature?.properties
                ? Object.keys(l.feature.properties).slice(0, 6)
                : "no-feature"
            );
          } catch (_) {}
          if (l instanceof L.GeoJSON && !candidate) {
            // heurística: un feature con .properties.SECCION
            const any = (l.getLayers?.() || [])[0];
            if (any?.feature?.properties?.SECCION != null) {
              candidate = l;
              // guarda en window para acelerar próximas llamadas
              window.capaSecciones = candidate;
              // intenta contar features (varias estrategias según implementación de la capa)
              let count = 0;
              try {
                if (typeof candidate.getLayers === "function")
                  count = candidate.getLayers().length;
                else if (candidate.toGeoJSON && candidate.toGeoJSON().features)
                  count = (candidate.toGeoJSON().features || []).length;
              } catch (e) {}
              console.info(
                `[ET] getSeccionesLayer: capa de secciones localizada (features: ${count}) y cacheada en window.capaSecciones`
              );
            }
          }
        });
        if (!candidate)
          console.warn(
            "[ET] getSeccionesLayer: no encontré ninguna capa de secciones"
          );
        return candidate;
      }

      // Helper de desarrollo: limpiar cache de capa de secciones
      window.clearCapaSecciones = function () {
        if (window.capaSecciones) {
          try {
            // intentar remover de mapa si es posible
            const m = ensureLeafletMap();
            if (m && m.removeLayer && window.capaSecciones)
              m.removeLayer(window.capaSecciones);
          } catch (_) {}
          delete window.capaSecciones;
          console.info(
            "[ET] clearCapaSecciones: window.capaSecciones eliminada"
          );
        } else {
          console.info("[ET] clearCapaSecciones: no había capa cacheada");
        }
      };

      // ========= PINTAR COBERTURA POR SECCIÓN =========
      // Colores:
      //  - Verde  = meta cumplida (reps casilla asignados >= 2 * #casillas)
      //  - Ámbar  = avance 1/2 en la mayoría (progreso entre 1 y <2 por casilla)
      //  - Rojo   = 0/2 predominante (asignados muy por debajo de meta)
      //  - Gris   = sin datos
      function styleFromStats(S) {
        const meta = 2 * (S.casillas?.length || 0);
        if (!meta)
          return {
            color: "#999",
            weight: 1,
            fillColor: "#e5e7eb",
            fillOpacity: 0.6,
          };

        const a = S.asigRepCasillas || 0;
        const ratio = a / meta; // 0..1+
        if (ratio >= 1)
          return {
            color: "#0f5132",
            weight: 2,
            fillColor: "#d1fae5",
            fillOpacity: 0.7,
          }; // verde
        if (ratio >= 0.5)
          return {
            color: "#664d03",
            weight: 2,
            fillColor: "#fff3cd",
            fillOpacity: 0.7,
          }; // ámbar
        return {
          color: "#842029",
          weight: 2,
          fillColor: "#ffe5e9",
          fillOpacity: 0.7,
        }; // rojo
      }

      async function pintarCoberturaSeccion({ dlTarget = null } = {}) {
        await ensureETIndexes();

        const layer = getSeccionesLayer();
        if (!layer) {
          alert("No encontré la capa de secciones.");
          return;
        }

        layer.eachLayer((lyr) => {
          const sec = String(lyr.feature?.properties?.SECCION || "").trim();
          if (!sec) return;

          // Si pides filtrar por DL:
          if (dlTarget != null) {
            const dl = Number(
              lyr.feature?.properties?.DISTRITO_L ??
                lyr.feature?.properties?.DL ??
                NaN
            );
            if (Number(dlTarget) !== dl) {
              lyr.setStyle({ opacity: 0.3, fillOpacity: 0.15 });
              return;
            }
          }

          const S = computeSectionStats(sec);
          const st = styleFromStats(S);
          lyr.setStyle({ opacity: 1, ...st });

          // Reabrir panel al hacer clic (ya lo tenías en onEachFeature, lo dejo por si acaso)
          lyr.off("click").on("click", () => openETPanelForSection(sec));
        });
      }

      // ========= COBERTURA POR CASILLA (placeholder demo) =========
      async function cargarCasillasDL(dl = 9) {
        // Aquí iría tu lógica por casilla (cuando tengas puntos/ET por casilla).
        // De momento mostramos un aviso mínimo:
        console.log("[ET] Cobertura por Casilla (demo) DL=", dl);
        alert(
          "Cobertura por Casilla (demo). Pronto conectamos con los puntos por casilla."
        );
      }

      // ========= PANEL DE FALTANTES =========
      function ensureFaltantesDOM() {
        let p = document.getElementById("et27-faltantes");
        if (p) return p;
        p = document.createElement("div");
        p.id = "et27-faltantes";
        p.style.cssText = `
        position:fixed; right:16px; top:96px; z-index:4500; width:420px; max-height:70vh; overflow:auto;
        background:#fff; border:1px solid #e5e7eb; border-radius:14px; box-shadow:0 14px 36px rgba(0,0,0,.14);
      `;
        p.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #f1f5f9;background:linear-gradient(180deg,#f8fafc,#eef2f7)">
          <div style="font-weight:700">Faltantes por Sección</div>
          <div style="display:flex;gap:6px;align-items:center">
            <button id="et27-falt-csv" style="border:1px solid #e5e7eb;background:#f8fafc;border-radius:8px;padding:4px 8px;cursor:pointer">CSV</button>
            <button id="et27-falt-close" style="border:none;background:#ffe7ea;color:#7f1d1d;width:26px;height:26px;border-radius:8px;cursor:pointer">×</button>
          </div>
        </div>
        <div style="padding:10px 12px">
          <div style="font-size:12px;color:#475569;margin-bottom:8px">Click en una fila para ir a la sección.</div>
          <table id="et27-falt-table" style="width:100%;border-collapse:separate;border-spacing:0 6px"></table>
        </div>
      `;

        document.body.appendChild(p);
        p.querySelector("#et27-falt-close").onclick = () =>
          (p.style.display = "none");
        return p;
      }

      async function abrirPanelFaltantes({ dlTarget = null, topN = 100 } = {}) {
        await ensureETIndexes();
        const p = ensureFaltantesDOM();
        const tbl = p.querySelector("#et27-falt-table");
        tbl.innerHTML = "";

        // Construye ranking: faltantes = meta - asignados
        // meta = 2 * #casillas; asignados = total rep_casilla
        const rows = [];
        (__SECC_INDEX || new Map()).forEach((feat, sec) => {
          // Filtra por DL si se indicó
          const dl = Number(
            feat.properties?.DISTRITO_L ?? feat.properties?.DL ?? NaN
          );
          if (dlTarget != null && Number(dlTarget) !== dl) return;

          const S = computeSectionStats(sec);
          const meta = 2 * (S.casillas?.length || 0);
          const faltCas = Math.max(0, meta - (S.asigRepCasillas || 0));
          const faltRepSec = Math.max(0, 2 - (S.repSecion || 0));
          const faltCoord = Math.max(0, 1 - (S.coordDistrital || 0));
          const faltTotal = faltCas + faltRepSec + faltCoord;

          rows.push({
            sec,
            dl,
            muni: feat.properties?.MUNICIPIO || "—",
            cas: S.casillas.length,
            meta,
            asig: S.asigRepCasillas || 0,
            faltCas,
            faltRepSec,
            faltCoord,
            faltTotal,
          });
        });

        rows.sort((a, b) => b.faltTotal - a.faltTotal);
        const take = rows.slice(0, topN);

        // Header
        const th = document.createElement("thead");
        th.innerHTML = `
        <tr style="font-size:12px;color:#64748b">
          <th style="text-align:left;padding:4px 8px">Sección</th>
          <th style="text-align:left;padding:4px 8px">Muni</th>
          <th style="text-align:right;padding:4px 8px">Cas</th>
          <th style="text-align:right;padding:4px 8px">Meta</th>
          <th style="text-align:right;padding:4px 8px">Asig</th>
          <th style="text-align:right;padding:4px 8px">Falt.</th>
        </tr>`;
        tbl.appendChild(th);

        const tb = document.createElement("tbody");
        take.forEach((r) => {
          const tr = document.createElement("tr");
          tr.style.background = "#fff";
          tr.style.boxShadow = "0 1px 0 #eef";
          tr.innerHTML = `
          <td style="padding:6px 8px"><b>${r.sec}</b> · DL ${r.dl}</td>
          <td style="padding:6px 8px">${r.muni}</td>
          <td style="padding:6px 8px;text-align:right">${r.cas}</td>
          <td style="padding:6px 8px;text-align:right">${r.meta}</td>
          <td style="padding:6px 8px;text-align:right">${r.asig}</td>
          <td style="padding:6px 8px;text-align:right;color:#7f1d1d;font-weight:700">${r.faltTotal}</td>
        `;
          tr.style.cursor = "pointer";
          tr.onclick = () => {
            p.style.display = "none";
            // ve a la sección y abre panel
            if (typeof gotoSection === "function") {
              gotoSection({ SECCION: r.sec }); // tu helper existente
            }

            openETPanelForSection(r.sec);
          };
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);

        // Habilita botón CSV para exportar las filas mostradas (usa la variable `take` local)
        const csvBtn = p.querySelector("#et27-falt-csv");
        if (csvBtn) {
          csvBtn.onclick = () => {
            const csv = ["seccion,dl,municipio,cas,meta,asig,falt_total"];
            take.forEach((r) =>
              csv.push(
                [r.sec, r.dl, r.muni, r.cas, r.meta, r.asig, r.faltTotal].join(
                  ","
                )
              )
            );
            const blob = new Blob([csv.join("\n")], {
              type: "text/csv;charset=utf-8;",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "faltantes_et27.csv";
            a.click();
            URL.revokeObjectURL(a.href);
          };
        }

        p.style.display = "block";
      }

      // ========= WIRING BOTONES (si no lo tenías ya) =========
      (function wireToolbarButtons() {
        const $load = document.getElementById("btn-et-load");
        const $sec = document.getElementById("btn-et-sec");
        const $cas = document.getElementById("btn-et-cas");
        const $fal = document.getElementById("btn-et-falt");

        const setLoading = (btn, on) =>
          btn && btn.classList.toggle("loading", !!on);
        const setActive = (btn, on) =>
          btn && btn.classList.toggle("active", !!on);
        const enable = (btn, on) => {
          if (btn) btn.disabled = !on;
        };

        // Arranque: deshabilita mientras no haya índices
        enable($sec, false);
        enable($cas, false);
        enable($fal, false);

        $load?.addEventListener("click", async () => {
          try {
            setLoading($load, true);
            await ensureETIndexes();
            await loadET27Points();
            enable($sec, true);
            enable($cas, true);
            enable($fal, true);
          } finally {
            setLoading($load, false);
          }
        });

        $sec?.addEventListener("click", async () => {
          try {
            setLoading($sec, true);

            // Si quieres seguir filtrando por DL, toma mini-sel-dl:
            const selDl = document.getElementById("mini-sel-dl");
            const dlTarget = selDl && selDl.value ? Number(selDl.value) : null;

            await pintarCoberturaSeccion({ dlTarget });

            // Y luego ajustas zoom al universo actual (Estado / Mun / DL / DF)
            zoomToCurrentUniverse();

            setActive($sec, true);
            setActive($cas, false);
          } finally {
            setLoading($sec, false);
          }
        });

        $cas?.addEventListener("click", async () => {
          try {
            setLoading($cas, true);
            await cargarCasillasDL(9); // demo
            setActive($cas, true);
            setActive($sec, false);
          } finally {
            setLoading($cas, false);
          }
        });

        $fal?.addEventListener("click", async () => {
          // Si usas DL del select, pásalo igual aquí
          const sel = document.getElementById("filtro-dl");
          const dlTarget =
            sel && sel.value && sel.value !== "— Ninguno —"
              ? Number(sel.value)
              : null;
          await abrirPanelFaltantes({ dlTarget, topN: 200 });
        });
      })();
    

// ---- inline block separator ----

      // Wiring básico del panel. Puede ejecutarse antes de que exista el
      // markup porque estructura.html inserta el script antes del panel.
      function bindET27SecPanel() {
        const P = document.getElementById("et27-sec-panel");
        if (!P || P.dataset.bound === "1") return;

        const close = document.getElementById("et27-sec-close");
        close?.addEventListener("click", () => (P.style.display = "none"));
        P.querySelectorAll(".tab").forEach((b) =>
          b.addEventListener("click", () => switchTab(b.dataset.tab))
        );
        P.dataset.bound = "1";
      }

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindET27SecPanel, {
          once: true,
        });
      } else {
        bindET27SecPanel();
      }
    

// ---- inline block separator ----

      document.addEventListener("DOMContentLoaded", () => {
        initET27DragResize();
      });

      // Ejecutar carga inicial de cobertura de forma segura (IIFE async)
      (async () => {
        try {
          const sel = document.getElementById("filtro-dl");
          const dlTarget =
            sel && sel.value && sel.value !== "— Ninguno —"
              ? Number(sel.value)
              : null;
          await pintarCoberturaSeccion({ dlTarget });
        } catch (e) {
          console.warn("[ET] pintarCoberturaSeccion (inicio) falló:", e);
        }
      })();

      function limpiarCoberturaSeccion() {
        const layer = getSeccionesLayer();
        if (!layer) return;
        layer.eachLayer((lyr) => {
          lyr.setStyle({
            color: "#333",
            weight: 1,
            fillColor: "#d1d5db",
            fillOpacity: 0.35,
            opacity: 1,
          });
        });
      }

      function ensureLeyenda() {
        if (document.getElementById("et27-legend")) return;
        const d = L.control({ position: "bottomright" });
        d.onAdd = function () {
          const el = L.DomUtil.create("div", "leaflet-control");
          el.id = "et27-legend";
          el.style.cssText =
            "background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:6px 8px;font-size:12px";
          el.innerHTML = `
            <div><b>Cobertura</b></div>
            <div><span style="display:inline-block;width:10px;height:10px;background:#d1fae5;border:1px solid #0f5132;margin-right:6px"></span>Meta cumplida</div>
            <div><span style="display:inline-block;width:10px;height:10px;background:#fff3cd;border:1px solid #664d03;margin-right:6px"></span>Parcial (≥50%)</div>
            <div><span style="display:inline-block;width:10px;height:10px;background:#ffe5e9;border:1px solid #842029;margin-right:6px"></span>Baja (&lt;50%)</div>`;
          return el;
        };
        d.addTo(ensureLeafletMap());
      }



      function removeLeyenda() {
        const el = document.getElementById("et27-legend");
        el?.parentNode?.removeChild(el);
      }

      // en consola (una sola vez o en tu init)
      localStorage.setItem(
        "AT_PATHS",
        JSON.stringify({
          geo: "../data/geo/secciones.geojson",
          casillas_sec: "../data/json/casillas_min_por_seccion.json",
          et27: "../data/campo/puntos_campo.geojson", // ajusta ruta/nombre
        })
      );

      // al cargar la página
      document.addEventListener("DOMContentLoaded", () => {
        const last = localStorage.getItem("ET27_LAST_SEC");
        if (last) openETPanelForSection(last);
      });


      window.addEventListener("load", async () => {
        await inicializarCampoEnEstructura();
         
      });



      let ET27_CAMPO_GEOJSON = null;

      async function cargarGeojsonCampo() {
        if (ET27_CAMPO_GEOJSON) return ET27_CAMPO_GEOJSON;

        const ruta = "../data/campo/puntos_campo.geojson"; // ajusta si cambia ruta
        const res = await fetch(ruta);
        if (!res.ok) throw new Error(`No se pudo cargar ${ruta}`);
        ET27_CAMPO_GEOJSON = await res.json();
        return ET27_CAMPO_GEOJSON;
      }

      function construirIndicePersonas(geojsonCampo) {
        const index = new Map();

        geojsonCampo.features.forEach((f) => {
          const p = f.properties;

          const sec = String(p.SECCION || "").trim();
          if (!sec) return;

          if (!index.has(sec)) {
            index.set(sec, {
              rep_casilla: [],
              rep_seccion: [],
              otros: [],
            });
          }

          const bucket = index.get(sec);
          const rol = String(p.TIPO || "").toUpperCase();

          if (rol.includes("CASILLA")) {
            bucket.rep_casilla.push(p);
          } else if (rol.includes("GENERAL")) {
            bucket.rep_seccion.push(p);
          } else {
            bucket.otros.push(p);
          }
        });

        return index;
      }

  

      function et27ClaseSemaforo(faltan, necesito) {
        if (faltan <= 0) return "et27-ok";
        if (faltan < necesito) return "et27-mid";
        return "et27-bad";
      }

      async function renderResumenOperativoSeccion(secId) {
        const contenedor = document.getElementById("et27-resumen-operativo");
        if (contenedor) contenedor.style.display = "block";
        const body = document.getElementById("et27-resumen-operativo-body");

        if (!body) return;

        const data = await calcularResumenOperativoSeccion(secId);

        const n = data.NECESIDADES;
        const c = data.COBERTURA;
        const f = data.FALTANTES;
        const r = data.RESUMEN;

        body.innerHTML = `
          <div style="font-size:13px; margin-bottom:8px; color:#475569;">
            <b>Sección ${data.SECCION}</b> · ${r.TOTAL} casillas
            (${r.BASICA} B, ${r.CONTIGUA} C, ${r.EXTRAORDINARIA} E, ${r.ESPECIAL} S)
          </div>

          <div class="et27-resumen-row">
            <b>Rep. casilla</b>
            <span>Necesito: ${n.REP_CASILLA}</span>
            <span>Llevo: ${c.REP_CASILLA_LLEVO}</span>
            <span class="et27-pill ${et27ClaseSemaforo(f.REP_CASILLA, n.REP_CASILLA)}">Faltan: ${f.REP_CASILLA}</span>
          </div>

          <div class="et27-resumen-row">
            <b>Rep. general</b>
            <span>Necesito: ${n.REP_GENERAL}</span>
            <span>Llevo: ${c.REP_GENERAL_LLEVO}</span>
            <span class="et27-pill ${et27ClaseSemaforo(f.REP_GENERAL, n.REP_GENERAL)}">Faltan: ${f.REP_GENERAL}</span>
          </div>

          <div class="et27-resumen-row">
            <b>Observadores</b>
            <span>Necesito: ${n.OBSERVADORES}</span>
            <span>Llevo: ${c.OBSERVADORES_LLEVO}</span>
            <span class="et27-pill ${et27ClaseSemaforo(f.OBSERVADORES, n.OBSERVADORES)}">Faltan: ${f.OBSERVADORES}</span>
          </div>

          <div style="margin-top:10px; font-size:12px; color:#475569;">
            Total registros: <b>${c.TOTAL_REGISTROS}</b> ·
            Líderes: <b>${c.LIDERES_LLEVO}</b> ·
            Simpatizantes: <b>${c.SIMPATIZANTES_LLEVO}</b> ·
            Adversarios: <b>${c.ADVERSARIOS_LLEVO}</b>
          </div>
        `;
      }

      
      async function seleccionarSeccionET27(secId) {
        if (!secId) return;

        const sec = String(secId).trim();

        await renderResumenOperativoSeccion(sec);
      }

      function cerrarResumenOperativo() {
        const cont = document.getElementById("et27-resumen-operativo");
        if (cont) cont.style.display = "none";
      }

      document.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("et27-btn-cerrar");
        if (btn) {
          btn.addEventListener("click", cerrarResumenOperativo);
        }
      });

      function habilitarDragResumenOperativo() {
        const panel = document.getElementById("et27-resumen-operativo");
        const header = document.getElementById("et27-resumen-header");

        if (!panel || !header || panel.__dragReady) return;

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        header.addEventListener("mousedown", (e) => {
          if (e.target.closest("#et27-btn-cerrar")) return;

          const rect = panel.getBoundingClientRect();

          dragging = true;
          startX = e.clientX;
          startY = e.clientY;
          startLeft = rect.left;
          startTop = rect.top;

          panel.style.left = `${startLeft}px`;
          panel.style.top = `${startTop}px`;
          panel.style.right = "auto";
          panel.style.bottom = "auto";

          document.body.style.userSelect = "none";
        });

        window.addEventListener("mousemove", (e) => {
          if (!dragging) return;

          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          panel.style.left = `${startLeft + dx}px`;
          panel.style.top = `${startTop + dy}px`;
        });

        window.addEventListener("mouseup", () => {
          if (!dragging) return;
          dragging = false;
          document.body.style.userSelect = "";
        });

        panel.__dragReady = true;
      }

      document.addEventListener("DOMContentLoaded", () => {
        habilitarDragResumenOperativo();
      });
