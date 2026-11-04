export function isStable(a: string, b: string): boolean { return a === b && a.length > 0; }
export async function listTabs(cdpBase = "http://127.0.0.1:9222"): Promise<any[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(`${cdpBase}/json/list`, { signal: ctrl.signal });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
  finally { clearTimeout(t); }
}
export function findTab(tabs: any[], host: string): any | undefined {
  return tabs.find((t) => typeof t.url === "string" && t.url.includes(host));
}

/**
 * Evaluate an expression in a CDP-attached tab.
 *
 * `awaitPromise` is required: expressions such as STABILITY_JS return a
 * Promise, and without it `Runtime.evaluate` hands back a Promise handle
 * whose `value` is undefined — the caller would silently receive an empty
 * string while believing the evaluation succeeded.
 */
export async function evalInTab(wsUrl: string, js: string, timeoutMs = 15000): Promise<string> {
  const ws = new WebSocket(wsUrl);
  let opened = false;
  const cleanup = () => { try { ws.close(); } catch { /* ignore */ } };
  try {
    await new Promise((res, rej) => {
      const tl = setTimeout(() => rej(new Error("ws-timeout")), timeoutMs);
      ws.onopen = () => { opened = true; clearTimeout(tl); res(0); };
      ws.onerror = () => { clearTimeout(tl); rej(new Error("ws-error")); };
    });
    const id = 1;
    const result: string = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("cdp-timeout")), timeoutMs);
      ws.onmessage = (m) => {
        let d: any;
        try { d = JSON.parse(String(m.data)); } catch (e) { clearTimeout(timer); reject(e); return; }
        if (d.id !== id) return;
        clearTimeout(timer);
        if (d.error) { reject(new Error(String(d.error.message || d.error).slice(0, 200))); return; }
        const exception = d.result?.exceptionDetails;
        if (exception) {
          reject(new Error(String(exception.exception?.description || exception.text || "page-exception").slice(0, 200)));
          return;
        }
        resolve(d.result?.result?.value ?? "");
      };
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: js, returnByValue: true, awaitPromise: true } }));
    });
    return result;
  } finally {
    if (opened || ws.readyState === WebSocket.OPEN) cleanup();
  }
}
export const STABILITY_JS = `new Promise((done)=>{let last=document.body.innerText.slice(-4000),n=0;const t=setInterval(()=>{const cur=document.body.innerText.slice(-4000);if(cur===last&&++n>=3){clearInterval(t);done(cur.slice(-2000))}else{if(cur!==last)n=0;last=cur}},800);setTimeout(()=>{clearInterval(t);done(document.body.innerText.slice(-2000))},120000)})`;
