// Optional browser integration check: node dec_web/tests/browser-smoke.cjs
// Set BROWSER_PATH if Chrome is installed elsewhere. No npm dependencies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browserPath = process.env.BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yaya-browser-'));
  const child = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  child.on('error', error => { launchError = error; });
  let socket;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(portFile); i++) {
      if (launchError) throw launchError;
      if (i > 100) throw new Error('Browser startup timed out');
      await wait(100);
    }
    const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const pending = new Map();
    const exceptions = [];
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails);
      if (pending.has(data.id)) {
        const { resolve, reject, timer } = pending.get(data.id); clearTimeout(timer); pending.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error))); else resolve(data.result);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 30000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
    const pagePath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../index.html');
    await send('Page.navigate', { url: pathToFileURL(pagePath).href });
    for (let i = 0; !await evaluate('typeof DuckDecoder !== "undefined" && typeof handleFiles === "function"'); i++) {
      if (i > 50) throw new Error('Page did not load');
      await wait(100);
    }
    const result = await evaluate(`(async () => {
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const utf8 = new TextEncoder();
      const png = async (width, height, rgba) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
        return new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))).arrayBuffer());
      };
      const encode = async (raw, ext, k, name) => {
        const suffix = utf8.encode(ext), header = new Uint8Array(6 + suffix.length + raw.length);
        header[1] = suffix.length; header.set(suffix, 2);
        new DataView(header.buffer).setUint32(2 + suffix.length, raw.length); header.set(raw, 6 + suffix.length);
        const bytes = new Uint8Array(header.length + 4); new DataView(bytes.buffer).setUint32(0, header.length); bytes.set(header, 4);
        const bits = [...bytes].flatMap(b => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1));
        const w = 97, h = 83, rgba = new Uint8ClampedArray(w * h * 4).fill(255); let p = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (y < Math.floor(h * .08) && x < Math.floor(w * .4)) continue;
          for (let c = 0; c < 3 && p < bits.length; c++) {
            let value = 0; for (let j = 0; j < k; j++) value = (value << 1) | (bits[p++] || 0);
            rgba[(y * w + x) * 4 + c] = (168 & ~((1 << k) - 1)) | value;
          }
        }
        return new File([await png(w, h, rgba)], name, { type: 'image/png' });
      };
      const untilIdle = async () => { for (let i = 0; running; i++) { if (i > 500) throw new Error('Queue stuck'); await new Promise(r => setTimeout(r, 10)); } };
      const text = utf8.encode('鸭鸭图浏览器测试 🦆 <img src=x onerror=alert(1)>');
      const files = await Promise.all([2,6,8].map(k => encode(text, 'txt', k, 'test-' + k + '.png')));
      const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
      document.getElementById('fileInput').files = transfer.files;
      document.getElementById('fileInput').dispatchEvent(new Event('change'));
      await untilIdle();
      assert(document.querySelectorAll('.card').length === 3, 'Batch decode');
      assert([...document.querySelectorAll('.text-preview')].every(node => node.textContent === new TextDecoder().decode(text)), 'Text preview bytes');
      assert(!document.querySelector('.text-preview img'), 'Text is not HTML');
      assert(document.getElementById('fileInput').value === '', 'Same-file retry enabled');
      const rgba = new Uint8ClampedArray([255,0,0,255,0,200,0,255,0,0,255,255,255,255,0,255]);
      const imageBytes = await png(2, 2, rgba);
      const imageFile = await encode(imageBytes, 'png', 6, '<unsafe>.png');
      const paste = new DataTransfer(); paste.items.add(imageFile);
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: paste })); await untilIdle();
      const thumb = document.querySelector('.thumb'); assert(thumb, 'Paste image');
      await thumb.decode(); thumb.click(); assert(document.getElementById('imgModal').open, 'Preview opens');
      document.getElementById('closeModal').click(); assert(!document.getElementById('imgModal').open, 'Preview closes');
      const restoredImage = await DuckDecoder.decodeFile(imageFile);
      assert(restoredImage.data.every((b,i) => b === imageBytes[i]), 'PNG byte exact');
      const video = new Uint8Array([1,2,3,4,5,6,7,8,9,10,11]);
      const videoPixels = new Uint8ClampedArray(16).fill(255);
      for(let i=0;i<12;i++) videoPixels[Math.floor(i/3)*4+i%3] = video[i] || 0;
      const videoFile = await encode(await png(2,2,videoPixels), 'mov.binpng', 8, 'video.png');
      const restored = await DuckDecoder.decodeFile(videoFile);
      assert(restored.ext === 'mov' && restored.binpng, 'BINPNG preserves media type');
      assert(restored.data.length === video.length && restored.data.every((b,i) => b === video[i]), 'BINPNG bytes');
      const drop = new DataTransfer(); drop.items.add(files[0]);
      document.getElementById('dropZone').dispatchEvent(new DragEvent('drop', { dataTransfer: drop, bubbles: true })); await untilIdle();
      assert(document.querySelectorAll('.card').length === 5, 'Drop decodes once');
      document.querySelector('.actions .secondary').click(); assert(document.querySelectorAll('.card').length === 4, 'Remove result');
      handleFiles([new File(['broken'], 'bad.png', { type:'image/png' }), files[0]]); await untilIdle();
      assert(document.querySelectorAll('.card').length === 5 && failed === 1, 'Continue after damaged input');
      handleFiles(files); document.getElementById('clearBtn').click(); await untilIdle();
      assert(document.querySelectorAll('.card').length === 0 && urls.size === 0 && document.getElementById('log').hidden, 'Clear cancels in-flight batch');
      handleFiles([imageFile, files[0]]); await untilIdle();
      return { checks: 17, cards: document.querySelectorAll('.card').length };
    })()`);
    assert.equal(result.cards, 2);
    assert.deepEqual(exceptions, []);
    const desktop = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const desktopPath = path.join(os.tmpdir(), 'yaya-desktop.png');
    fs.writeFileSync(desktopPath, Buffer.from(desktop.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Mobile horizontal overflow');
    const mobile = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const mobilePath = path.join(os.tmpdir(), 'yaya-mobile.png');
    fs.writeFileSync(mobilePath, Buffer.from(mobile.data, 'base64'));
    console.log(JSON.stringify({ ...result, desktopPath, mobilePath, errors: exceptions.length }, null, 2));
  } finally {
    socket?.close();
    child.kill();
    await wait(500);
    // Only remove this test's fresh temporary profile.
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('yaya-browser-'));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
