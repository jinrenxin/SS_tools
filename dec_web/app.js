"use strict";
const $ = id => document.getElementById(id);
const urls = new Set();
let controller = new AbortController();
let queue = [];
let running = false;
let completed = 0;
let failed = 0;
let imageViewer = null;
const mimeTypes = {
  png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", bmp:"image/bmp", avif:"image/avif",
  mp4:"video/mp4", webm:"video/webm", ogv:"video/ogg", mov:"video/quicktime", m4v:"video/x-m4v",
  mp3:"audio/mpeg", wav:"audio/wav", ogg:"audio/ogg", m4a:"audio/mp4", flac:"audio/flac",
  txt:"text/plain;charset=utf-8", json:"application/json", pdf:"application/pdf"
};
function sizeLabel(n) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
}
function log(message) {
  $("log").hidden = false;
  const lines = $("log").textContent.split("\n").filter(Boolean);
  lines.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  $("log").textContent = lines.slice(-200).join("\n");
  $("log").scrollTop = $("log").scrollHeight;
}
function updateCount() {
  const count = $("resultGrid").querySelectorAll(".card").length;
  $("resultCount").textContent = `${count} 个文件`;
  if (!count) $("resultGrid").innerHTML = '<div class="empty">暂无解码结果<br>图片、视频和文本会显示在这里</div>';
}
function closeModal() {
  if ($("imgModal").open) $("imgModal").close();
  $("modalImg").removeAttribute("src");
}
function showLegacyPreview(img) {
  $("modalImg").src = img.src;
  $("modalImg").alt = img.alt;
  $("imgModal").showModal();
}
function refreshImageViewer() {
  if (typeof window.Viewer !== "function") return;
  if (!$('resultGrid').querySelector(".thumb")) {
    if (imageViewer) imageViewer.destroy();
    imageViewer = null;
    return;
  }
  if (!imageViewer) {
    imageViewer = new window.Viewer($("resultGrid"), {
      filter: image => image.classList.contains("thumb"),
      navbar: true,
      title: image => image.alt || "图片预览",
      toolbar: {
        zoomIn: 1,
        zoomOut: 1,
        oneToOne: 1,
        reset: 1,
        prev: 1,
        play: 0,
        next: 1,
        rotateLeft: 1,
        rotateRight: 1,
        flipHorizontal: 1,
        flipVertical: 1
      }
    });
  } else {
    imageViewer.update();
  }
}
function clearAll() {
  controller.abort();
  controller = new AbortController();
  queue = [];
  completed = failed = 0;
  closeModal();
  $("resultGrid").replaceChildren();
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  updateCount();
  $("log").textContent = ""; $("log").hidden = true;
  $("status").textContent = "已清空，等待添加图片";
  $("fileInput").value = "";
  refreshImageViewer();
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function addResult(sourceName, result) {
  $("resultGrid").querySelector(".empty")?.remove();
  const { ext, data } = result;
  const stem = sourceName.replace(/\.[^.]+$/, "");
  const name = `${stem}_decoded.${ext || "bin"}`.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
  const mime = mimeTypes[ext] || "application/octet-stream";
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  urls.add(url);
  const card = element("article", "card");
  if (mime.startsWith("image/")) {
    const img = element("img", "thumb");
    img.src = url; img.alt = name; img.tabIndex = 0; img.setAttribute("role", "button");
    img.setAttribute("aria-label", `放大预览 ${name}`);
    img.addEventListener("click", () => { if (!imageViewer) showLegacyPreview(img); });
    img.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (imageViewer) {
        const images = [...$("resultGrid").querySelectorAll(".thumb")];
        imageViewer.show();
        imageViewer.view(images.indexOf(img));
      } else {
        showLegacyPreview(img);
      }
    });
    img.addEventListener("error", () => img.replaceWith(element("div", "file-preview", "无法预览此图片，请下载查看")), { once: true });
    card.append(img);
  } else if (mime.startsWith("video/") || mime.startsWith("audio/")) {
    const video = mime.startsWith("video/");
    const media = element(video ? "video" : "audio", video ? "thumb-video" : "audio-preview");
    media.src = url; media.controls = true; media.preload = "metadata";
    if (video) media.playsInline = true;
    card.append(media);
    media.addEventListener("error", () => media.replaceWith(element("div", "file-preview", "浏览器不支持预览，请下载播放")), { once: true });
  } else if (["txt", "json", "md", "csv", "log"].includes(ext)) {
    const sample = data.subarray(0, 65536);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: data.length > sample.length }); }
    catch { text = new TextDecoder("gbk").decode(sample); }
    card.append(element("pre", "text-preview", text + (data.length > sample.length ? "\n…预览已截断，下载可查看完整内容" : "")));
  } else {
    card.append(element("div", "file-preview", `${ext.toUpperCase()} 文件 · 下载后查看`));
  }
  const meta = element("div", "meta");
  meta.append(element("div", "name", name), element("div", "", `来源：${sourceName}`), element("div", "", `大小：${sizeLabel(data.length)} · ${result.bits} 位${result.encrypted ? " · 密码已验证" : ""}`));
  if (result.binpng) meta.append(element("div", "", "已还原二进制图片中的视频"));
  const actions = element("div", "actions");
  const download = element("button", "btn", "下载"); download.type = "button";
  download.addEventListener("click", () => {
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
  });
  const remove = element("button", "btn secondary", "移除"); remove.type = "button";
  remove.addEventListener("click", () => {
    if (imageViewer?.isShown) imageViewer.hide();
    if ($("modalImg").getAttribute("src") === url) closeModal();
    card.querySelectorAll("video,audio").forEach(media => { media.pause(); media.removeAttribute("src"); media.load(); });
    card.remove(); URL.revokeObjectURL(url); urls.delete(url); updateCount(); refreshImageViewer();
  });
  actions.append(download, remove); card.append(meta, actions); $("resultGrid").prepend(card); updateCount(); refreshImageViewer();
}
async function drainQueue() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const { file, password, signal } = queue.shift();
      if (signal.aborted) continue;
      $("status").textContent = `正在解码：${file.name} · 等待 ${queue.length} 张`;
      log(`开始：${file.name}`);
      try {
        const result = await DuckDecoder.decodeFile(file, password, signal);
        if (signal.aborted) continue;
        addResult(file.name, result); completed++;
        log(`成功：${file.name} → .${result.ext}（${sizeLabel(result.data.length)}）`);
      } catch (error) {
        if (signal.aborted) continue;
        failed++;
        log(`失败：${file.name} · ${error.message || error}`);
      }
      if (!signal.aborted) $("status").textContent = `处理完成 · 成功 ${completed} 张，失败 ${failed} 张`;
    }
  } finally { running = false; }
}
function handleFiles(fileList) {
  const files = Array.from(fileList).filter(file => file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(file.name));
  if (!files.length) { log("未检测到图片文件，请选择原始鸭鸭图"); return; }
  const password = $("password").value;
  const signal = controller.signal;
  queue.push(...files.map(file => ({ file, password, signal })));
  void drainQueue();
}
$("pickBtn").addEventListener("click", () => $("fileInput").click());
$("dropZone").addEventListener("click", () => $("fileInput").click());
$("dropZone").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileInput").click(); } });
$("fileInput").addEventListener("change", e => { handleFiles(e.target.files); e.target.value = ""; });
$("clearBtn").addEventListener("click", clearAll);
$("togglePassword").addEventListener("click", () => {
  const show = $("password").type === "password";
  $("password").type = show ? "text" : "password";
  $("togglePassword").textContent = show ? "隐藏" : "显示";
  $("togglePassword").setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
  $("togglePassword").setAttribute("aria-pressed", String(show));
});
for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
  $("dropZone").addEventListener(type, e => { e.preventDefault(); $("dropZone").classList.toggle("dragover", type === "dragenter" || type === "dragover"); });
}
document.addEventListener("dragover", e => { e.preventDefault(); });
document.addEventListener("drop", e => { e.preventDefault(); if (e.dataTransfer?.files.length) handleFiles(e.dataTransfer.files); });
document.addEventListener("paste", e => {
  const files = Array.from(e.clipboardData?.items || []).filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); handleFiles(files); }
});
$("closeModal").addEventListener("click", closeModal);
$("imgModal").addEventListener("click", e => { if (e.target === $("imgModal")) closeModal(); });
$("imgModal").addEventListener("close", () => $("modalImg").removeAttribute("src"));
refreshImageViewer();
