    // Preserva querystring y hash (por si algún día los usas)
    (function () {
      var target = '../portal/portal.html' + location.search + location.hash;
      // replace() evita dejar este index en el historial
      location.replace(target);
    })();
  
