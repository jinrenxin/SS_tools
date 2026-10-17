/* Duck payload format: see duck_payload_exporter.py and duck_decode_node.py. */
(function (root) {
  "use strict";
  const utf8 = new TextEncoder();
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  function checkAbort(signal) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
  }

  // Local SHA-256 also works on file:// and ordinary HTTP, without a CDN.
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const rotate = (x, n) => (x >>> n) | (x << (32 - n));
  function sha256(bytes) {
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
    const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
        const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,v] = h;
      for (let i = 0; i < 64; i++) {
        const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const t1 = (v + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        v=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      [a,b,c,d,e,f,g,v].forEach((value, i) => { h[i] = (h[i] + value) >>> 0; });
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    h.forEach((value, i) => outView.setUint32(i * 4, value));
    return out;
  }

  async function extractPayload(rgba, width, height, k, signal) {
    const skipW = Math.floor(width * 0.4), skipH = Math.floor(height * 0.08);
    const capacity = (width * height - skipW * skipH) * 3 * k;
    if (capacity < 32) throw new Error("图像数据不足");
    let x = 0, y = 0, channel = 0, buffer = 0, available = 0;
    function byte() {
      while (available < 8) {
        if (y < skipH && x < skipW) x = skipW;
        buffer = (buffer << k) | (rgba[(y * width + x) * 4 + channel] & ((1 << k) - 1));
        available += k;
        if (++channel === 3) {
          channel = 0;
          if (++x === width) { x = 0; y++; }
        }
      }
      available -= 8;
      const value = (buffer >>> available) & 255;
      buffer &= (1 << available) - 1;
      return value;
    }
    const length = byte() * 0x1000000 + byte() * 0x10000 + byte() * 256 + byte();
    if (length < 6 || 32 + length * 8 > capacity) throw new Error("载荷长度异常");
    const payload = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      if (i % 262144 === 0) { await pause(); checkAbort(signal); }
      payload[i] = byte();
    }
    return payload;
  }

  async function parseHeader(header, password, signal) {
    if (header.length < 6 || header[0] > 1) throw new Error("文件头损坏");
    const encrypted = header[0] === 1;
    let offset = encrypted ? 49 : 1;
    if (header.length < offset + 1) throw new Error("文件头损坏");
    const extLen = header[offset++];
    if (!extLen || header.length < offset + extLen + 4) throw new Error("文件头损坏");
    const ext = new TextDecoder("utf-8", { fatal: true }).decode(header.subarray(offset, offset + extLen));
    if (!/^\.?[a-z0-9][a-z0-9._-]*$/i.test(ext)) throw new Error("文件扩展名无效");
    offset += extLen;
    const length = new DataView(header.buffer, header.byteOffset + offset, 4).getUint32(0);
    offset += 4;
    if (length !== header.length - offset) throw new Error("数据长度不匹配");
    let data = header.subarray(offset);
    if (encrypted) {
      const passwordError = message => Object.assign(new Error(message), { code: "PASSWORD" });
      if (!password) throw passwordError("此图片需要密码，请在上方输入密码后重新选择图片");
      const saltHex = Array.from(header.subarray(33, 49), b => b.toString(16).padStart(2, "0")).join("");
      const material = utf8.encode(password + saltHex);
      const hash = sha256(material);
      if (!hash.every((b, i) => b === header[i + 1])) throw passwordError("密码错误，请修改密码后重新选择图片");
      const plain = new Uint8Array(data.length);
      for (let start = 0, counter = 0; start < data.length; start += 32, counter++) {
        if (start % 65536 === 0) { await pause(); checkAbort(signal); }
        const suffix = utf8.encode(String(counter));
        const input = new Uint8Array(material.length + suffix.length);
        input.set(material); input.set(suffix, material.length);
        const key = sha256(input);
        for (let i = 0; i < Math.min(32, data.length - start); i++) plain[start + i] = data[start + i] ^ key[i];
      }
      data = plain;
    }
    return { ext: ext.replace(/^\./, "").toLowerCase(), data, encrypted };
  }

  async function decodePixels(rgba, width, height, password = "", signal) {
    checkAbort(signal);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
      throw new Error("图像尺寸无效");
    }
    let passwordError;
    for (const k of [2, 6, 8]) {
      try {
        const header = await extractPayload(rgba, width, height, k, signal);
        return { ...await parseHeader(header, password, signal), bits: k };
      } catch (error) {
        if (error.name === "AbortError") throw error;
        if (error.code === "PASSWORD") passwordError = error;
      }
    }
    throw passwordError || new Error("未识别到完整的鸭鸭图数据，请使用未经压缩、缩放或截图的原始图片");
  }

  async function readPixels(blob) {
    let bitmap;
    const canvas = document.createElement("canvas");
    try {
      bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "none" });
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("浏览器无法创建图像画布");
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      bitmap?.close();
      canvas.width = canvas.height = 0;
    }
  }

  async function decodeFile(file, password = "", signal) {
    const pixels = await readPixels(file);
    const result = await decodePixels(pixels.data, pixels.width, pixels.height, password, signal);
    if (result.ext.endsWith(".binpng")) {
      const binary = await readPixels(new Blob([result.data], { type: "image/png" }));
      checkAbort(signal);
      const raw = new Uint8Array(binary.width * binary.height * 3);
      for (let src = 0, dest = 0; src < binary.data.length; src += 4) {
        if (src % 1048576 === 0) { await pause(); checkAbort(signal); }
        raw[dest++] = binary.data[src]; raw[dest++] = binary.data[src + 1]; raw[dest++] = binary.data[src + 2];
      }
      // Match binpng_bytes_to_mp4_bytes: this legacy format has no original length.
      let end = raw.length;
      while (end && raw[end - 1] === 0) end--;
      result.data = raw.subarray(0, end);
      result.ext = result.ext.slice(0, -7) || "mp4";
      result.binpng = true;
    }
    checkAbort(signal);
    return result;
  }
  const api = { decodeFile, decodePixels, sha256 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DuckDecoder = api;
})(globalThis);
