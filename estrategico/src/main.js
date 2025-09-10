import { createMap, loadGeoJSON } from './core/map.js';
import { createToolbar } from './components/toolbar.js';
import { loadConfig } from './core/runtime.js';
import { log } from './core/logger.js';

(async () => {
  const cfg = await loadConfig();
  log('Config loaded', cfg);
  document.getElementById('env-info').textContent = `${cfg.client.name} · ${cfg.year} · ${cfg.cargo}`;
  const map = createMap('map', cfg);
  await loadGeoJSON(map, cfg);   // ⬅️ importante
  createToolbar(document.getElementById('toolbar'), [
    { id:'mod-comparativa', icon:'📊', label:'Comparativa', onClick: async () => {
        const { run } = await import('./modules/example/index.js');
        run({ map, cfg });
      } 
    }
  ]);
})();
