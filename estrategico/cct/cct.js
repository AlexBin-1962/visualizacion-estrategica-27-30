      /**************************************************************
       * CONFIG (Abasolo)
       **************************************************************/
      const CCT_CFG = {
        municipio: "ABASOLO",
        paths: {
          geo: "../data/geo/secciones_abasolo.geojson",
          electoralA: "../data/electoral/A.json",
          socio: "../data/Datos_Socioeconomicos.json",
        },

        // Seguridad (PIN hashed SHA-256)
        // PIN actual (ejemplo) = "cct-2026-abasolo"
        // Si quieres cambiarlo, dime el PIN nuevo y te paso el hash ya hecho,
        // o genera con: await crypto.subtle.digest('SHA-256', new TextEncoder().encode('PIN'))
        pinHashHex:
          "fde02b449a2b7c0d386e829c6e365f62058a1aa4e1fa6a18e517b7b72a85168f",

        sessionKey: "CCT_AUTH_OK",
        idleMinutes: 30,

        // Clasificación competitividad (margen en puntos)
        baseMarginPts: 8,
        recMarginPts: -8,
      };

      /**************************************************************
       * Utils
       **************************************************************/
      const $ = (id) => document.getElementById(id);

      function toNum(v) {
        if (v === null || v === undefined) return 0;
        const n = Number(String(v).replace(/,/g, "").trim());
        return Number.isFinite(n) ? n : 0;
      }

      function copyText(text) {
        if (!text) return;
        navigator.clipboard?.writeText(text).catch(() => {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        });
      }

      function nowISO() {
        const d = new Date();
        const pad = (x) => String(x).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
          d.getDate()
        )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }

      function setChip(el, label, type) {
        el.textContent = label || "—";
        el.classList.remove("chipOk", "chipWarn", "chipBad");
        if (type === "ok") el.classList.add("chipOk");
        if (type === "warn") el.classList.add("chipWarn");
        if (type === "bad") el.classList.add("chipBad");
      }

      function classifyTipoSeccion(margenPts) {
        if (margenPts >= CCT_CFG.baseMarginPts) return "BASE";
        if (margenPts <= CCT_CFG.recMarginPts) return "RECUPERACION";
        return "COMPETIDA";
      }

      function tipoChip(tipo) {
        if (tipo === "BASE") return ["BASE", "ok"];
        if (tipo === "RECUPERACION") return ["RECUPERACIÓN", "bad"];
        return ["COMPETIDA", "warn"];
      }

      /**************************************************************
       * Auth (PIN SHA-256) + Idle timeout
       **************************************************************/
      let idleTimer = null;

      function isAuthed() {
        return sessionStorage.getItem(CCT_CFG.sessionKey) === "1";
      }
      function setAuthed() {
        sessionStorage.setItem(CCT_CFG.sessionKey, "1");
      }
      function clearAuth() {
        sessionStorage.removeItem(CCT_CFG.sessionKey);
      }
      function showAuth(show) {
        $("authBackdrop").style.display = show ? "flex" : "none";
        $("lockPill").textContent = show ? "🔒 LOCKED" : "🟢 UNLOCKED";
      }

      async function sha256Hex(str) {
        const enc = new TextEncoder().encode(str);
        const buf = await crypto.subtle.digest("SHA-256", enc);
        const arr = Array.from(new Uint8Array(buf));
        return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
      }

      function resetIdle() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          clearAuth();
          showAuth(true);
          $("authMsg").style.display = "none";
          $("pinInput").value = "";
        }, CCT_CFG.idleMinutes * 60 * 1000);
      }

      function bindIdle() {
        ["mousemove", "keydown", "mousedown", "touchstart", "scroll"].forEach(
          (ev) => {
            window.addEventListener(
              ev,
              () => {
                if (isAuthed()) resetIdle();
              },
              { passive: true }
            );
          }
        );
      }

      function goPortal() {
        window.location.href = "../portal/portal.html";
      }

      $("btnGoPortal").addEventListener("click", goPortal);
      $("btnExit").addEventListener("click", goPortal);

      $("btnLogout").addEventListener("click", () => {
        clearAuth();
        showAuth(true);
      });

      $("btnEnter").addEventListener("click", async () => {
        const pin = ($("pinInput").value || "").trim();
        const h = await sha256Hex(pin);
        const ok = h === CCT_CFG.pinHashHex;
        $("authMsg").style.display = ok ? "none" : "block";
        if (ok) {
          setAuthed();
          showAuth(false);
          resetIdle();
        }
      });

      bindIdle();
      showAuth(!isAuthed());
      if (isAuthed()) resetIdle();

      /**************************************************************
       * Data cache
       **************************************************************/
      const CCT_DATA = {
        geo: null,
        electoralA: null,
        socio: null,
      };

      async function loadAll() {
        const [geo, electAraw, socio] = await Promise.all([
          fetch(CCT_CFG.paths.geo).then((r) => r.json()),
          fetch(CCT_CFG.paths.electoralA).then((r) => r.json()),
          fetch(CCT_CFG.paths.socio).then((r) => r.json()),
        ]);

        CCT_DATA.geo = geo;
        CCT_DATA.socio = socio;

        // ✅ ADAPTADOR: A.json (meta + secciones + years) -> formato CCT por sección
        const out = {};
        const secciones = electAraw?.secciones || {};

        for (const [sec, obj] of Object.entries(secciones)) {
          const y2024 = obj?.["2024"] || {};
          // Partidos desde meta (si existe) o desde llaves 2024
          const parties = (
            electAraw?.meta?.parties || Object.keys(y2024)
          ).filter((k) => !["VOTOS", "LN"].includes(k));

          // Construimos el record compatible con el CCT (prefijo 24A_)
          const rec = {};
          for (const p of parties) rec[`24A_${p}`] = y2024[p] ?? 0;

          rec["24A_TOTAL"] = y2024["VOTOS"] ?? 0;
          rec["24A_LN"] = y2024["LN"] ?? 0;

          // Ganador (si no existe, el CCT lo calcula igual, pero lo dejamos listo)
          let ganador = "—";
          let max = -1;
          for (const p of parties) {
            const v = Number(y2024[p] ?? 0);
            if (v > max) {
              max = v;
              ganador = p;
            }
          }
          rec["GANADOR_24A"] = ganador;

          out[String(sec)] = rec;
        }

        CCT_DATA.electoralA = out;
      }

      /**************************************************************
       * Robust electoral detection (A 2024)
       **************************************************************/
      function detectA2024Prefix(rec) {
        const candidates = [
          "24A_",
          "2024A_",
          "A24_",
          "A_24_",
          "A2024_",
          "2024_A_",
          "A_2024_",
        ];
        const keys = Object.keys(rec || {});
        for (const pref of candidates) {
          if (keys.some((k) => k.startsWith(pref))) return pref;
        }
        const maybe = keys.find((k) => /24.*A|A.*24/i.test(k));
        if (maybe) {
          const idx = maybe.lastIndexOf("_");
          if (idx > 0) return maybe.slice(0, idx + 1);
        }
        return null;
      }

      function detectTotalKey(rec, pref) {
        if (!rec || !pref) return null;
        const keys = Object.keys(rec);
        const exact = `${pref}TOTAL`;
        if (keys.includes(exact)) return exact;
        return (
          keys.find((k) => k.startsWith(pref) && /TOTAL|TOT/i.test(k)) || null
        );
      }

      function detectLNKey(rec, pref) {
        if (!rec || !pref) return null;
        const keys = Object.keys(rec);
        const exact = `${pref}LN`;
        if (keys.includes(exact)) return exact;
        return (
          keys.find((k) => k.startsWith(pref) && /LN|LISTA/i.test(k)) || null
        );
      }

      function getPartiesFromARecord(rec) {
        const pref = detectA2024Prefix(rec);
        if (!pref) return [];
        const keys = Object.keys(rec || {});
        const partyKeys = keys.filter(
          (k) =>
            k.startsWith(pref) &&
            !/(TOTAL|TOT|LN|LISTA)/i.test(k.slice(pref.length))
        );
        return partyKeys.map((k) => k.slice(pref.length));
      }

      function computeMarginFromA2024(rec) {
        if (!rec)
          return { margen: 0, total: 0, first: null, second: null, pref: null };
        const pref = detectA2024Prefix(rec);
        if (!pref)
          return { margen: 0, total: 0, first: null, second: null, pref: null };
        const totalKey = detectTotalKey(rec, pref);
        const total = totalKey ? toNum(rec[totalKey]) : 0;

        const parties = getPartiesFromARecord(rec);
        const arr = parties
          .map((p) => ({ p, v: toNum(rec[`${pref}${p}`]) }))
          .sort((a, b) => b.v - a.v);

        const v1 = arr[0]?.v ?? 0;
        const v2 = arr[1]?.v ?? 0;
        const first = arr[0]?.p ?? null;
        const second = arr[1]?.p ?? null;

        const margen = total > 0 ? (v1 - v2) / total : 0;
        return { margen, total, first, second, pref };
      }

      function computeParticipacion(rec) {
        const keys = Object.keys(rec || {});
        const kPart = keys.find((k) => /PARTICIPACION/i.test(k));
        if (kPart) {
          const n = toNum(rec[kPart]);
          if (n > 0 && n <= 1) return n;
          if (n > 1 && n <= 100) return n / 100;
        }
        const pref = detectA2024Prefix(rec);
        if (!pref) return 0;
        const totalKey = detectTotalKey(rec, pref);
        const lnKey = detectLNKey(rec, pref);
        const total = totalKey ? toNum(rec[totalKey]) : 0;
        const ln = lnKey ? toNum(rec[lnKey]) : 0;
        if (total > 0 && ln > 0) {
          const p = total / ln;
          return Math.max(0, Math.min(1, p));
        }
        return 0;
      }

      function computeFragmentacion(rec) {
        const m = computeMarginFromA2024(rec);
        if (!rec || !m.pref) return "—";
        const pref = m.pref;
        const totalKey = detectTotalKey(rec, pref);
        const total = totalKey ? toNum(rec[totalKey]) : 0;
        if (total <= 0) return "—";

        const parties = getPartiesFromARecord(rec);
        const arr = parties
          .map((p) => toNum(rec[`${pref}${p}`]))
          .sort((a, b) => b - a);
        const v1 = arr[0] ?? 0;
        const v2 = arr[1] ?? 0;
        const v3 = arr[2] ?? 0;
        const s1 = v1 / total;
        const d12 = (v1 - v2) / total;
        const d23 = (v2 - v3) / total;

        if (s1 < 0.35 && d12 < 0.06) return "ALTA";
        if (s1 < 0.45 && (d12 < 0.1 || d23 < 0.08)) return "MEDIA";
        return "BAJA";
      }

      /**************************************************************
       * Socio labels
       **************************************************************/
      function socioLabels(seccionKey) {
        const s = CCT_DATA.socio?.[seccionKey];
        if (!s) {
          return {
            perfil_demografico: "—",
            nivel_educativo: "—",
            presion_economica: "—",
            deficit_servicios: "—",
            conectividad: "—",
          };
        }

        const pobTotal = toNum(s.POB_TOTAL);
        const pob1517 = toNum(s.POB_15_17);
        const esc = toNum(s.ESCOLARIDAD_PROM);
        const pea = toNum(s.PEA_12MAS);
        const des = toNum(s.DESOCUPADOS_12MAS);

        const vivRef = Math.max(1, toNum(s.VIV_CON_ELECTRICIDAD));
        const cobAgua = toNum(s.VIV_CON_AGUA) / vivRef;
        const cobDren = toNum(s.VIV_CON_DRENAJE) / vivRef;
        const internet = toNum(s.VIV_CON_INTERNET) / vivRef;

        const ratioJoven = pobTotal > 0 ? pob1517 / pobTotal : 0;
        const tasaDes = pea > 0 ? des / pea : 0;

        const perfil_demografico =
          ratioJoven > 0.07 ? "JOVEN" : ratioJoven >= 0.04 ? "MIXTO" : "ADULTO";

        const nivel_educativo =
          esc < 8.5 ? "BAJO" : esc <= 10 ? "MEDIO" : "ALTO";

        const presion_economica =
          tasaDes > 0.03 ? "ALTA" : tasaDes >= 0.015 ? "MEDIA" : "BAJA";

        const deficit_servicios =
          cobAgua < 0.95 || cobDren < 0.95
            ? "ALTO"
            : cobAgua < 0.98 || cobDren < 0.98
            ? "MEDIO"
            : "BAJO";

        const conectividad =
          internet < 0.35 ? "BAJA" : internet <= 0.55 ? "MEDIA" : "ALTA";

        return {
          perfil_demografico,
          nivel_educativo,
          presion_economica,
          deficit_servicios,
          conectividad,
        };
      }

      /**************************************************************
       * Prompt + Brief Ejecutivo
       **************************************************************/
      function buildPrompt(payload) {
        return `
Eres un asistente estratégico de comunicación política territorial.
Trabajas para un candidato INDEPENDIENTE en una campaña local.

Tu tarea NO es persuadir ideológicamente, sino:
- interpretar datos territoriales reales
- traducirlos en mensajes ciudadanos
- proponer acciones de campaña y contenido para redes

CONTEXTO GENERAL:
- Municipio: ${payload.MUNICIPIO}
- Sección electoral: ${payload.SECCION}
- Tipo de sección: ${payload.TIPO_SECCION} (BASE / COMPETIDA / RECUPERACION)
- Etapa: ${payload.ETAPA} (PRECAMPAÑA / CAMPAÑA)

PERFIL SOCIOECONÓMICO (resumido):
- Perfil demográfico: ${payload.SOCIO_RESUMEN.perfil_demografico}
- Nivel educativo: ${payload.SOCIO_RESUMEN.nivel_educativo}
- Presión económica: ${payload.SOCIO_RESUMEN.presion_economica}
- Déficit de servicios básicos: ${payload.SOCIO_RESUMEN.deficit_servicios}
- Conectividad digital: ${payload.SOCIO_RESUMEN.conectividad}

REGLAS ESTRICTAS:
1. NO inventes datos ni cifras.
2. NO prometas obras, programas o soluciones específicas.
3. NO ataques partidos ni personas.
4. Usa lenguaje ciudadano, cercano y territorial.
5. Enfoque de escucha, cercanía y solución colectiva.
6. Coherente con un candidato independiente.

TAREA:
Genera un BRIEF DE CONTENIDO TERRITORIAL con la siguiente estructura EXACTA:

1) DIAGNÓSTICO TERRITORIAL (máx. 3 líneas)
2) OBJETIVO DE COMUNICACIÓN
3) MENSAJE CLAVE
4) QUÉ DECIR (3 bullets)
5) QUÉ EVITAR
6) TIPO DE EVENTO RECOMENDADO
7) CONTENIDO PARA REDES
   a) Copy corto (máx. 3 líneas)
   b) Guion breve para video (20–30 segundos)
   c) Llamado a la acción (CTA)
8) PLATAFORMA Y FORMATO SUGERIDO

FORMATO:
- Claro, concreto y accionable.
- No agregues secciones extras.
`.trim();
      }

      function buildBriefEjecutivo(payload) {
        // Un brief “candidato-friendly” basado en etiquetas (sin inventar datos)
        const tipo = payload.TIPO_SECCION;
        const soc = payload.SOCIO_RESUMEN;

        // Mensaje base (sin prometer obras)
        let foco = "escuchar y resolver con la gente";
        if (soc.deficit_servicios === "ALTO")
          foco = "servicios básicos y calidad de vida";
        else if (soc.presion_economica === "ALTA")
          foco = "empleo, ingresos y oportunidades";
        else if (soc.conectividad === "BAJA")
          foco = "presencia en calle y comunicación directa";
        else if (soc.nivel_educativo === "ALTO")
          foco = "propuestas claras y acuerdos comunitarios";

        let objetivo = "reconectar";
        if (tipo === "RECUPERACION")
          objetivo = "persuadir y recuperar confianza";
        if (tipo === "COMPETIDA") objetivo = "persuadir y movilizar";
        if (tipo === "BASE") objetivo = "movilizar y consolidar";

        const formato = payload.REGLAS_TONO.formato;
        const evento =
          formato === "evento"
            ? "Recorrido + mini asamblea (30–45 min)"
            : formato === "video_corto"
            ? "Grabación en calle + micro-entrevista (20–30s)"
            : "Mensaje con foto real + texto corto";

        const plataforma =
          soc.conectividad === "ALTA"
            ? "Facebook + Reels"
            : soc.conectividad === "MEDIA"
            ? "Facebook + WhatsApp"
            : "WhatsApp + presencia territorial";

        return `
BRIEF EJECUTIVO — SECCIÓN ${payload.SECCION} (${payload.TIPO_SECCION})

Diagnóstico rápido:
- Perfil: ${soc.perfil_demografico} · Educación: ${
          soc.nivel_educativo
        } · Economía: ${soc.presion_economica}
- Servicios: ${soc.deficit_servicios} · Conectividad: ${soc.conectividad}

Objetivo:
- ${objetivo.toUpperCase()} (enfoque: ${payload.REGLAS_TONO.enfoque})

Mensaje clave:
- “Aquí venimos a ${foco}, con cercanía y soluciones construidas con ustedes.”

Qué decir (3 ideas):
- “Quiero escuchar qué urge en esta zona y priorizarlo con ustedes.”
- “Mi compromiso es estar presente, dar seguimiento y rendir cuentas.”
- “La solución se construye con la comunidad: organización, gestión y resultados.”

Qué evitar:
- Promesas de obras específicas y ataques a partidos/personas.

Evento recomendado:
- ${evento}

Redes (enfoque ${payload.REGLAS_TONO.tono}):
- Plataforma sugerida: ${plataforma}
- CTA: “Súmate: comparte tu necesidad y participa en la agenda local.”
`.trim();
      }

      /**************************************************************
       * Build payload
       **************************************************************/
      function buildPayload(seccionKey) {
        const recA = CCT_DATA.electoralA?.[seccionKey] || {};
        const m = computeMarginFromA2024(recA);
        const margenPts = m.margen * 100;
        const tipo = classifyTipoSeccion(margenPts);

        const socio = socioLabels(seccionKey);
        const participacion = computeParticipacion(recA);
        const frag = computeFragmentacion(recA);
        const ganadorCalc = m.first ? String(m.first) : "—";

        return {
          MUNICIPIO: CCT_CFG.municipio,
          SECCION: String(seccionKey),
          ETAPA: $("selEtapa").value,
          PUESTO_BASE: "A",
          ANIO_BASE: 2024,
          TIPO_SECCION: tipo,
          ELECTORAL_RESUMEN: {
            participacion: participacion,
            ganador:
              recA["GANADOR_24A"] ?? recA["GANADOR_2024_A"] ?? ganadorCalc,
            margen_pct: Number.isFinite(margenPts)
              ? Number(margenPts.toFixed(1))
              : 0,
            competitividad: tipo,
            fragmentacion: frag,
          },
          SOCIO_RESUMEN: {
            perfil_demografico: socio.perfil_demografico,
            nivel_educativo: socio.nivel_educativo,
            presion_economica: socio.presion_economica,
            deficit_servicios: socio.deficit_servicios,
            conectividad: socio.conectividad,
          },
          REGLAS_TONO: {
            tono: $("selTono").value,
            enfoque: $("selEnfoque").value,
            formato: $("selFormato").value,
            prohibido: [
              "inventar cifras",
              "prometer obras específicas",
              "atacar partidos o personas",
            ],
          },
        };
      }

      /**************************************************************
       * Map init + layers
       **************************************************************/
      let map, seccionesLayer, highlightLayer;

      function mapStyleDefault() {
        return {
          weight: 1,
          opacity: 0.9,
          color: "rgba(31,75,90,.55)",
          fillOpacity: 0.06,
        };
      }
      function mapStyleHover() {
        return {
          weight: 2,
          opacity: 1,
          color: "rgba(31,75,90,.95)",
          fillOpacity: 0.1,
        };
      }
      function mapStyleHighlight() {
        return {
          weight: 4,
          opacity: 1,
          color: "rgba(31,75,90,1)",
          fillOpacity: 0.12,
        };
      }

      function initMap() {
        map = L.map("cctMap", { zoomControl: true }).setView(
          [20.45, -101.53],
          12
        );

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
        }).addTo(map);

        highlightLayer = L.geoJSON(null, { style: mapStyleHighlight }).addTo(
          map
        );

        seccionesLayer = L.geoJSON(CCT_DATA.geo, {
          style: mapStyleDefault,
          onEachFeature: (feature, layer) => {
            const sec = String(feature.properties?.SECCION ?? "").trim();

            layer.bindTooltip(`Sección ${sec}`, {
              sticky: true,
              opacity: 0.92,
            });

            layer.on("mouseover", () => layer.setStyle(mapStyleHover()));
            layer.on("mouseout", () => layer.setStyle(mapStyleDefault()));

            layer.on("click", () => selectSection(sec, feature, layer));
          },
        }).addTo(map);

        map.fitBounds(seccionesLayer.getBounds(), { padding: [26, 26] });

        $("btnFitAll").addEventListener("click", () =>
          map.fitBounds(seccionesLayer.getBounds(), { padding: [26, 26] })
        );
        $("btnClearSel").addEventListener("click", clearSelection);
        $("btnClearSel").addEventListener("dblclick", clearSelection);
        $("btnClearSel").addEventListener("contextmenu", (e) => {
          e.preventDefault();
          clearSelection();
        });

        $("btnFitAll").addEventListener("dblclick", () =>
          map.fitBounds(seccionesLayer.getBounds(), { padding: [34, 34] })
        );
        $("btnFitAll").addEventListener("contextmenu", (e) => {
          e.preventDefault();
          map.fitBounds(seccionesLayer.getBounds(), { padding: [34, 34] });
        });

        $("btnClearSel").title = "Limpiar selección (doble clic para asegurar)";
      }

      function clearSelection() {
        highlightLayer.clearLayers();
        $("hudSec").textContent = "—";
        setChip($("hudTipo"), "—");
        $("hudMargen").textContent = "—";
        setChip($("hudConn"), "—");

        $("valTipo").textContent = "—";
        $("valMargen").textContent = "—";
        setChip($("chipStatus"), "Selecciona sección");

        // limpia salidas
        $("outPayload").textContent = "";
        $("outPrompt").textContent = "";
        $("outBrief").textContent = "";

        // tabs diag/plan
        $("dGanador").textContent = "—";
        $("dPart").textContent = "—";
        $("dFrag").textContent = "—";
        $("dComp").textContent = "—";

        $("sDemo").textContent = "—";
        $("sEdu").textContent = "—";
        $("sEco").textContent = "—";
        $("sConn").textContent = "—";
        $("sServ").textContent = "—";

        $("diagNarrativa").textContent = "";
        $("planTexto").textContent = "";
      }

      /**************************************************************
       * Section selection -> zoom + highlight + UI update
       **************************************************************/
      function selectSection(sec, feature, layer) {
        const key = String(sec).trim();
        $("selSeccion").value = key;

        highlightLayer.clearLayers();
        highlightLayer.addData(feature);
        map.fitBounds(layer.getBounds(), { padding: [34, 34] });

        // Update quick computed metrics (electoral + socio)
        const recA = CCT_DATA.electoralA?.[key] || {};
        const m = computeMarginFromA2024(recA);
        const margenPts = m.margen * 100;
        const tipo = classifyTipoSeccion(margenPts);
        const [tipoTxt, tipoLvl] = tipoChip(tipo);

        const socio = socioLabels(key);
        const conn = socio.conectividad;

        // HUD
        $("hudSec").textContent = key;
        setChip($("hudTipo"), tipoTxt, tipoLvl);
        $("hudMargen").textContent = Number.isFinite(margenPts)
          ? `${margenPts.toFixed(1)}%`
          : "—";
        setChip(
          $("hudConn"),
          conn,
          conn === "ALTA" ? "ok" : conn === "MEDIA" ? "warn" : "bad"
        );

        // Panel values
        $("valTipo").textContent = tipoTxt;
        $("valMargen").textContent = Number.isFinite(margenPts)
          ? `${margenPts.toFixed(1)}%`
          : "—";
        setChip($("chipStatus"), `Sección activa: ${key}`, "ok");

        // Diag quick
        const participacion = computeParticipacion(recA);
        const frag = computeFragmentacion(recA);
        const ganador =
          recA["GANADOR_24A"] ??
          recA["GANADOR_2024_A"] ??
          (m.first ? String(m.first) : "—");

        $("dGanador").textContent = ganador;
        $("dPart").textContent = participacion
          ? `${(participacion * 100).toFixed(1)}%`
          : "—";
        $("dFrag").textContent = frag;
        $("dComp").textContent = tipoTxt;

        $("sDemo").textContent = socio.perfil_demografico;
        $("sEdu").textContent = socio.nivel_educativo;
        $("sEco").textContent = socio.presion_economica;
        $("sConn").textContent = socio.conectividad;
        $("sServ").textContent = socio.deficit_servicios;

        $("diagNarrativa").textContent = buildDiagNarrativa(key, tipo, socio);
        $("planTexto").textContent = buildPlanAccion(key, tipo, socio);

        // opcional: autogenerar salidas al seleccionar
        // generateOutputs();
      }

      function buildDiagNarrativa(sec, tipo, socio) {
        const piezas = [];
        piezas.push(`SECCIÓN ${sec} — ${tipo}`);
        piezas.push(
          `Perfil: ${socio.perfil_demografico} · Educación: ${socio.nivel_educativo} · Economía: ${socio.presion_economica}`
        );
        piezas.push(
          `Servicios: ${socio.deficit_servicios} · Conectividad: ${socio.conectividad}`
        );
        piezas.push("");
        piezas.push("Lectura territorial:");
        piezas.push(
          `- Mensaje debe ser ${
            socio.nivel_educativo === "BAJO"
              ? "simple, directo y con ejemplos"
              : "claro, ordenado y con propuestas concretas sin prometer obras"
          }.`
        );
        piezas.push(
          `- Operación recomendada: ${
            socio.conectividad === "BAJA"
              ? "territorio presencial + WhatsApp"
              : socio.conectividad === "MEDIA"
              ? "mixto (FB + WhatsApp + calle)"
              : "digital fuerte (FB/Reels) + calle"
          }.`
        );
        piezas.push(
          `- Intensidad: ${
            tipo === "RECUPERACION"
              ? "alta (convencer + presencia)"
              : tipo === "COMPETIDA"
              ? "alta (persuadir + movilizar)"
              : "media (consolidar + movilizar)"
          }.`
        );
        return piezas.join("\n");
      }

      function buildPlanAccion(sec, tipo, socio) {
        const l = [];
        l.push(`PLAN DE ACCIÓN — SECCIÓN ${sec}`);
        l.push("");

        // Operación
        l.push("OPERACIÓN (campo):");
        if (tipo === "RECUPERACION") {
          l.push(
            "- Prioridad ALTA: presencia constante, escucha activa y seguimiento."
          );
          l.push(
            "- Recorrido + micro-asamblea (30–45 min) con compromisos de gestión (sin prometer obras)."
          );
        } else if (tipo === "COMPETIDA") {
          l.push(
            "- Prioridad ALTA: persuadir + movilizar con mensajes claros y cercanos."
          );
          l.push(
            "- Evento pequeño + visitas focalizadas en puntos de afluencia."
          );
        } else {
          l.push("- Prioridad MEDIA: consolidar y asegurar participación.");
          l.push("- Brigada ligera + llamada a la participación.");
        }

        l.push("");
        l.push("MENSAJE (línea):");
        if (socio.deficit_servicios === "ALTO")
          l.push(
            "- Enfoque: servicios y calidad de vida (gestión + seguimiento + cercanía)."
          );
        else if (socio.presion_economica === "ALTA")
          l.push(
            "- Enfoque: empleo/ingresos y oportunidades (apoyo local + puertas abiertas)."
          );
        else
          l.push(
            "- Enfoque: organización comunitaria y soluciones con la gente."
          );

        l.push("");
        l.push("REDES (formato):");
        if (socio.conectividad === "ALTA") {
          l.push(
            "- Reels 20–30s + post FB con foto real. 3 publicaciones/semana en esta zona."
          );
        } else if (socio.conectividad === "MEDIA") {
          l.push(
            "- FB + WhatsApp: post corto + video 20–30s; difusión por grupos."
          );
        } else {
          l.push(
            "- WhatsApp + calle: texto breve y foto real; reforzar presencial."
          );
        }

        l.push("");
        l.push("CHECKLIST (hoy):");
        l.push("- Definir 1 punto de reunión y 2 rutas cortas.");
        l.push("- Capturar 5 necesidades reales (frases de la gente).");
        l.push(
          "- Grabar 1 video corto con cierre (CTA) y 1 foto de interacción real."
        );
        return l.join("\n");
      }

      /**************************************************************
       * Tabs
       **************************************************************/
      document.querySelectorAll(".tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          document
            .querySelectorAll(".tab")
            .forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          const tab = btn.dataset.tab;
          ["brief", "diag", "plan", "hist"].forEach((t) => {
            $(`tab_${t}`).style.display = t === tab ? "flex" : "none";
          });
          if (tab === "hist") renderHistory();
        });
      });

      /**************************************************************
       * Generate outputs
       **************************************************************/
      function generateOutputs() {
        const sec = $("selSeccion").value;
        if (!sec) {
          alert("Selecciona una sección (clic en mapa).");
          return;
        }
        const payload = buildPayload(sec);
        const prompt = buildPrompt(payload);
        const brief = buildBriefEjecutivo(payload);

        $("outPayload").textContent = JSON.stringify(payload, null, 2);
        $("outPrompt").textContent = prompt;
        $("outBrief").textContent = brief;

        // refresca hud/tipo panel si cambiaste controles
        const [tTxt, tLvl] = tipoChip(payload.TIPO_SECCION);
        $("valTipo").textContent = tTxt;
        setChip($("hudTipo"), tTxt, tLvl);
        setChip($("chipStatus"), `Listo: Payload + Prompt`, "ok");

        // diag/plan
        $("diagNarrativa").textContent = buildDiagNarrativa(
          sec,
          payload.TIPO_SECCION,
          payload.SOCIO_RESUMEN
        );
        $("planTexto").textContent = buildPlanAccion(
          sec,
          payload.TIPO_SECCION,
          payload.SOCIO_RESUMEN
        );
      }

      $("btnGenerar").addEventListener("click", () => {
        if (isAuthed()) generateOutputs();
      });
      $("btnCopyPayload").addEventListener("click", () =>
        copyText($("outPayload").textContent)
      );
      $("btnCopyPrompt").addEventListener("click", () =>
        copyText($("outPrompt").textContent)
      );
      $("btnCopyBrief").addEventListener("click", () =>
        copyText($("outBrief").textContent)
      );
      $("btnCopyPlan").addEventListener("click", () =>
        copyText($("planTexto").textContent)
      );

      /**************************************************************
       * History (localStorage)
       **************************************************************/
      const HIST_KEY = "CCT_ABASOLO_HISTORY_V1";

      function getHistory() {
        try {
          const raw = localStorage.getItem(HIST_KEY);
          return raw ? JSON.parse(raw) : [];
        } catch (e) {
          return [];
        }
      }
      function setHistory(arr) {
        localStorage.setItem(HIST_KEY, JSON.stringify(arr));
      }

      function saveToHistory() {
        const sec = $("selSeccion").value;
        if (!sec || !$("outPayload").textContent) {
          alert("Genera primero el payload/prompt.");
          return;
        }
        const entry = {
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          at: nowISO(),
          seccion: sec,
          payload: $("outPayload").textContent,
          prompt: $("outPrompt").textContent,
          brief: $("outBrief").textContent,
        };
        const arr = getHistory();
        arr.unshift(entry);
        setHistory(arr);
        setChip($("chipStatus"), "Guardado en historial", "ok");
        $("histCount").textContent = String(arr.length);
      }

      function renderHistory() {
        const arr = getHistory();
        $("histCount").textContent = String(arr.length);
        const wrap = $("histList");
        wrap.innerHTML = "";

        if (!arr.length) {
          wrap.innerHTML = `<div class="histItem"><div class="histHead">
          <div class="hTitle">Sin registros</div><div class="hMeta">—</div></div>
          <div class="hint">Genera un brief y presiona “Guardar en historial”.</div></div>`;
          return;
        }

        for (const it of arr.slice(0, 60)) {
          const div = document.createElement("div");
          div.className = "histItem";
          div.innerHTML = `
          <div class="histHead">
            <div class="hTitle">Sección ${it.seccion}</div>
            <div class="hMeta">${it.at}</div>
          </div>
          <div class="histBtns">
            <button class="smallBtn" data-act="load" data-id="${it.id}">Cargar</button>
            <button class="smallBtn" data-act="copyBrief" data-id="${it.id}">Copiar brief</button>
            <button class="smallBtn" data-act="copyPrompt" data-id="${it.id}">Copiar prompt</button>
            <button class="smallBtn" data-act="del" data-id="${it.id}">Eliminar</button>
          </div>
        `;
          wrap.appendChild(div);
        }

        wrap.querySelectorAll("button[data-act]").forEach((b) => {
          b.addEventListener("click", () => {
            const act = b.dataset.act;
            const id = b.dataset.id;
            const arr2 = getHistory();
            const found = arr2.find((x) => x.id === id);
            if (!found) return;

            if (act === "load") {
              $("selSeccion").value = found.seccion;
              $("outPayload").textContent = found.payload;
              $("outPrompt").textContent = found.prompt;
              $("outBrief").textContent = found.brief;
              setChip(
                $("chipStatus"),
                `Cargado: sección ${found.seccion}`,
                "ok"
              );
            }
            if (act === "copyBrief") copyText(found.brief);
            if (act === "copyPrompt") copyText(found.prompt);
            if (act === "del") {
              const next = arr2.filter((x) => x.id !== id);
              setHistory(next);
              renderHistory();
            }
          });
        });
      }

      $("btnGuardar").addEventListener("click", () => {
        if (isAuthed()) saveToHistory();
      });
      $("btnHistRefresh").addEventListener("click", renderHistory);
      $("btnHistClear").addEventListener("click", () => {
        if (!confirm("¿Borrar TODO el historial local del CCT?")) return;
        setHistory([]);
        renderHistory();
      });

      /**************************************************************
       * PDF export (jsPDF simple)
       **************************************************************/
      function exportPdf({ mode }) {
        const sec = $("selSeccion").value;
        if (!sec || !$("outBrief").textContent) {
          alert("Genera primero el brief.");
          return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "pt", format: "letter" });
        const margin = 40;
        let y = 50;

        const line = (txt, size = 11, bold = false) => {
          doc.setFont("helvetica", bold ? "bold" : "normal");
          doc.setFontSize(size);
          const lines = doc.splitTextToSize(txt, 540);
          for (const ln of lines) {
            if (y > 760) {
              doc.addPage();
              y = 50;
            }
            doc.text(ln, margin, y);
            y += size + 6;
          }
        };

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(
          `CCT Abasolo — ${mode === "exec" ? "PDF Ejecutivo" : "PDF Completo"}`,
          margin,
          y
        );
        y += 18;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(`Sección: ${sec} · Fecha: ${nowISO()}`, margin, y);
        y += 18;

        line("BRIEF EJECUTIVO:", 12, true);
        line($("outBrief").textContent, 10, false);
        y += 8;

        if (mode === "full") {
          line("PAYLOAD (JSON):", 12, true);
          line($("outPayload").textContent || "", 8, false);
          y += 8;

          line("PROMPT MAESTRO:", 12, true);
          line($("outPrompt").textContent || "", 8, false);
        }

        doc.save(
          `CCT_ABASOLO_${sec}_${mode === "exec" ? "EJECUTIVO" : "COMPLETO"}.pdf`
        );
      }

      $("btnPdfEjecutivo").addEventListener("click", () =>
        exportPdf({ mode: "exec" })
      );
      $("btnPdfCompleto").addEventListener("click", () =>
        exportPdf({ mode: "full" })
      );

      /**************************************************************
       * Wiring select + initial boot
       **************************************************************/
      function fillSecciones() {
        const feats = (CCT_DATA.geo?.features || [])
          .map((f) => String(f.properties?.SECCION ?? "").trim())
          .filter(Boolean);

        const uniq = Array.from(new Set(feats)).sort(
          (a, b) => Number(a) - Number(b)
        );

        const sel = $("selSeccion");
        sel.innerHTML =
          `<option value="">— Selecciona —</option>` +
          uniq.map((s) => `<option value="${s}">${s}</option>`).join("");
        sel.addEventListener("change", () => {
          const v = sel.value;
          if (!v) return;
          // buscar layer y disparar selección
          let target = null;
          seccionesLayer.eachLayer((l) => {
            const s = String(l.feature?.properties?.SECCION ?? "").trim();
            if (s === v) target = l;
          });
          if (target) selectSection(v, target.feature, target);
        });
      }

      /**************************************************************
       * Boot
       **************************************************************/
      (async function boot() {
        try {
          await loadAll();
          initMap();
          fillSecciones();
          renderHistory();
        } catch (err) {
          console.error("CCT boot error:", err);
          alert(
            "CCT: Error cargando datos. Revisa consola (F12) y rutas en CCT_CFG.paths."
          );
        }
      })();
    
