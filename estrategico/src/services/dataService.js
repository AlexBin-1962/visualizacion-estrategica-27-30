// Servicio de datos: lee CSV de secciones y completa TOTAL_VOTOS_CALCULADOS y PARTICIPACION si faltan.
export async function loadSectionsModel(url) {
  const text = await fetch(url).then(r => r.text());
  const rows = parseCSV(text);

  if (!rows.length) return { rows: [], parties: [], cols: [] };

  // normaliza cabeceras a MAYÚSCULAS
  const cols = Object.keys(rows[0]).map(c => c.toUpperCase());
  rows.forEach((r, i) => {
    for (const k of Object.keys(r)) {
      const up = k.toUpperCase();
      if (up !== k) {
        r[up] = r[k];
        delete r[k];
      }
    }
  });

  // nombres base
  const SECCION = "SECCION";
  const LN1 = "LN", LN2 = "LISTA_NOMINAL";
  const VOTOS = "VOTOS";
  const PARTIC = "PARTICIPACION";

  // detecta columnas de partidos = todas las numéricas que no sean SECCION/LN/VOTOS/PARTICIPACION
  const alwaysIgnore = new Set([SECCION, LN1, LN2, VOTOS, PARTIC, "TOTAL_VOTOS", "TOTAL_VOTOS_CALCULADOS"]);
  const guessNumeric = col =>
    rows.reduce((acc, r) => acc + (isFinite(+r[col]) && r[col] !== "" ? 1 : 0), 0) / rows.length > 0.6;

  const parties = Object.keys(rows[0])
    .filter(c => !alwaysIgnore.has(c))
    .filter(c => guessNumeric(c));

  // normaliza y calcula campo por campo
  for (const r of rows) {
    // SECCION → 4 dígitos
    r[SECCION] = String(r[SECCION] ?? "").replace(/\D/g, "").padStart(4, "0");

    // LISTA_NOMINAL
    r["LISTA_NOMINAL"] = r[LN2] ?? r[LN1] ?? "";
    delete r[LN1]; delete r[LN2];
    if (r["LISTA_NOMINAL"] !== "") r["LISTA_NOMINAL"] = +r["LISTA_NOMINAL"];

    // partidos → enteros
    for (const p of parties) r[p] = +r[p] || 0;

    // TOTAL_VOTOS_CALCULADOS = suma de partidos
    r["TOTAL_VOTOS_CALCULADOS"] = parties.reduce((s, p) => s + (+r[p] || 0), 0);

    // si viene VOTOS y no cuadra, ignoramos VOTOS y usamos la suma (no tocamos archivo, solo en memoria)
    if (VOTOS in r && +r[VOTOS] !== r["TOTAL_VOTOS_CALCULADOS"]) {
      // opcional: podrías marcar r._VOTOS_ORIG = +r[VOTOS]
      delete r[VOTOS];
    }

    // PARTICIPACION si falta y hay LN
    if ((r[PARTIC] ?? "") === "" && r["LISTA_NOMINAL"]) {
      r[PARTIC] = +(r["TOTAL_VOTOS_CALCULADOS"] / r["LISTA_NOMINAL"] * 100).toFixed(2);
    } else if ((r[PARTIC] ?? "") !== "") {
      r[PARTIC] = +r[PARTIC];
    }
  }

  const orderedCols = [
    SECCION, "LISTA_NOMINAL", PARTIC, "TOTAL_VOTOS_CALCULADOS",
    ...parties.sort()
  ];

  return { rows, parties, cols: orderedCols };
}

// Parser CSV sencillo (coma, sin comas entrecomilladas). Si luego necesitas comillas, metemos PapaParse.
function parseCSV(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== "");
  const header = lines.shift().split(",").map(s => s.trim());
  return lines.map(line => {
    const cells = line.split(",");
    const obj = {};
    header.forEach((h, i) => obj[h] = (cells[i] ?? "").trim());
    return obj;
  });
}
