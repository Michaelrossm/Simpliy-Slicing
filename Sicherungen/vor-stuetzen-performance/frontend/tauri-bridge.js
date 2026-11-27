/* Only maps the existing v0.4 profile API to native Rust commands.
 * No web server, no loopback port, no external network requests.
 */
(() => {
  const native = () => window.__TAURI__?.core?.invoke;
  const originalFetch = window.fetch.bind(window);
  function response(payload, status = 200, blob = null) {
    return { ok: status >= 200 && status < 300, status,
      async json() { return payload; },
      async blob() { return blob ?? new Blob([JSON.stringify(payload)], {type:'application/json'}); }
    };
  }
  const encode = array => {
    let out = '';
    const bytes = new Uint8Array(array);
    for (let i=0; i<bytes.length; i+=8192) out += String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(out);
  };
  const decode = b64 => {
    const text = atob(b64), arr = new Uint8Array(text.length);
    for(let i=0;i<arr.length;i++) arr[i]=text.charCodeAt(i);
    return arr;
  };
  window.fetch = async (url, options={}) => {
    const path = typeof url === 'string' ? url : url.toString();
    if(path === '/catalog.json') return originalFetch('./catalog.json', options);
    if(!path.startsWith('/api/')) return originalFetch(url, options);
    const invoke = native();
    if(!invoke) return response({error:'Native Rust/Tauri-Verbindung fehlt. Anwendung über Tauri starten.'},503);
    try {
      if(path==='/api/state' && (options.method??'GET')==='GET')
        return response(await invoke('get_workspace'));
      if(path==='/api/state' && options.method==='PUT')
        return response(await invoke('save_workspace',{workspace:JSON.parse(options.body)}));
      if(path==='/api/engine') return response(await invoke('detect_engine'));
      if(path==='/api/import'){
        const filename = decodeURIComponent(options.headers?.['X-Filename'] || 'import.simpliyprofile');
        const payload = encode(options.body);
        return response(await invoke('import_profile',{filename,dataBase64:payload}));
      }
      if(path.startsWith('/api/export/')){
        const id = decodeURIComponent(path.slice('/api/export/'.length));
        const b64 = await invoke('export_profile',{profileId:id});
        return response({ok:true},200,new Blob([decode(b64)],{type:'application/zip'}));
      }
      return response({error:'Unbekannter nativer API-Aufruf'},404);
    } catch(err) {return response({error:String(err)},400);}
  };
})();
