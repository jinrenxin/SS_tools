const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { decodePixels, sha256 } = require('../decoder.js');

// Execute the actual Python header/encryption functions without importing ComfyUI/numpy.
const python = spawnSync('python', ['-c', `
import ast, pathlib, json, os, hashlib, struct
source = ast.parse(pathlib.Path('duck_payload_exporter.py').read_text(encoding='utf-8'))
names = {'_generate_key_stream', '_encrypt_with_password', '_build_file_header'}
selected = ast.Module(body=[n for n in source.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
exec(compile(selected, 'duck_payload_exporter.py', 'exec'))
raw = bytes(range(256)) * 3 + '鸭鸭图 🦆'.encode()
print(json.dumps({p: _build_file_header(raw, p, 'txt').hex() for p in ['', '密码 🔑', 'x' * 100]}))
`], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
assert.equal(python.status, 0, python.stderr);
const headers = JSON.parse(python.stdout);
const original = Buffer.concat([Buffer.from(Array.from({ length: 768 }, (_, i) => i % 256)), Buffer.from('鸭鸭图 🦆')]);

// Independent MSB-first bit packing, including groups straddling the length prefix.
function embed(header, k, width = 97, height = 83) {
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
  const bits = [...Buffer.concat([prefix, header])].flatMap(b => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1));
  const rgba = new Uint8Array(width * height * 4).fill(255);
  let bit = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (y < Math.floor(height * .08) && x < Math.floor(width * .4)) continue;
    for (let c = 0; c < 3 && bit < bits.length; c++) {
      let value = 0;
      for (let i = 0; i < k; i++) value = (value << 1) | (bits[bit++] || 0);
      rgba[(y * width + x) * 4 + c] = (0xa8 & ~((1 << k) - 1)) | value;
    }
  }
  assert.ok(bit >= bits.length, 'fixture fits image');
  return { rgba, width, height };
}
const decode = (image, password = '', signal) => decodePixels(image.rgba, image.width, image.height, password, signal);

test('local SHA-256 matches standard vectors and block boundaries', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1024, 10000]) {
    const input = randomBytes(length);
    assert.equal(Buffer.from(sha256(input)).toString('hex'), createHash('sha256').update(input).digest('hex'));
  }
});
for (const k of [2, 6, 8]) {
  for (const password of Object.keys(headers)) {
    test(`${k} bits / ${password ? 'password length ' + password.length : 'no password'}: Python encoder round trip`, async () => {
      const result = await decode(embed(Buffer.from(headers[password], 'hex'), k), password);
      assert.equal(result.bits, k);
      assert.equal(result.ext, 'txt');
      assert.equal(result.encrypted, !!password);
      assert.deepEqual(Buffer.from(result.data), original);
    });
  }
  test(`${k} bits: preserve missing/wrong password error through fallback`, async () => {
    const image = embed(Buffer.from(headers['密码 🔑'], 'hex'), k);
    await assert.rejects(decode(image), /需要密码/);
    await assert.rejects(decode(image, 'incorrect'), /密码错误/);
  });
  test(`${k} bits: reject corrupt declared data length`, async () => {
    const header = Buffer.from(headers[''], 'hex'); header[8] ^= 1;
    await assert.rejects(decode(embed(header, k)), /未识别/);
  });
}
test('small images with no watermark skip and an empty file', async () => {
  const header = Buffer.from([0, 3, 116, 120, 116, 0, 0, 0, 0]);
  const result = await decode(embed(header, 6, 10, 2));
  assert.equal(result.data.length, 0);
});
test('reject truncated/random image and invalid dimensions', async () => {
  await assert.rejects(decodePixels(new Uint8Array(4), 1, 1), /未识别/);
  await assert.rejects(decodePixels(new Uint8Array(16).fill(255), 2, 2), /未识别/);
  await assert.rejects(decodePixels(new Uint8Array(16), 3, 2), /尺寸无效/);
});
test('cancel during payload extraction', async () => {
  const controller = new AbortController();
  const pending = decode(embed(Buffer.from(headers[''], 'hex'), 2), '', controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
