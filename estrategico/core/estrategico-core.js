function calcularResumenSeccion(seccionSeleccionada, geojsonCasillas) {

    const resumen = {
        SECCION: seccionSeleccionada,
        BASICA: 0,
        CONTIGUA: 0,
        EXTRAORDINARIA: 0,
        ESPECIAL: 0,
        TOTAL: 0
    };

    geojsonCasillas.features.forEach(f => {
        const p = f.properties;

        if (p.SECCION == seccionSeleccionada) {

            resumen.TOTAL++;

            switch (p.TIPO_CASILLA) {
                case "BASICA":
                    resumen.BASICA++;
                    break;
                case "CONTIGUA":
                    resumen.CONTIGUA++;
                    break;
                case "EXTRAORDINARIA":
                    resumen.EXTRAORDINARIA++;
                    break;
                case "ESPECIAL":
                    resumen.ESPECIAL++;
                    break;
            }
        }
    });

    return resumen;
}


function calcularNecesidades(resumen) {

    const territoriales = resumen.BASICA + resumen.CONTIGUA + resumen.EXTRAORDINARIA;

    return {
        REP_CASILLA: territoriales * 2,
        REP_GENERAL: Math.ceil(territoriales / 5),
        OBSERVADORES: Math.ceil(resumen.TOTAL / 4)
    };
}