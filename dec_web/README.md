# yaya / 鸭鸭图解码页面

单文件版：`yaya-single.html`，已内嵌全部样式和解码脚本，只需这一个文件即可离线打开、复制或部署，功能与 `index.html` 相同。

直接用现代浏览器打开 `index.html`，或将整个 `dec_web` 文件夹放到静态网站目录。无需安装依赖或网络请求；Viewer.js 已随 `vendor/` 一起提供，图片预览支持缩放、旋转、翻转、原图比例和多图切换。本地文件、HTTP 和 HTTPS 均可解码密码图片。

先输入密码（无密码留空），再选择、拖入或粘贴原始鸭鸭图。支持批量处理、Viewer.js 图片预览、视频/音频播放、文本预览、下载和清空取消。失败后修改密码并重新选择同一张图即可重试。

解码格式对应仓库的 `duck_payload_exporter.py` / `duck_decode_node.py`：跳过左上角宽 40%、高 8% 的矩形区域，依次尝试 RGB 通道低 2/6/8 位，校验文件头和载荷长度，验证密码并还原数据。不是 TT 图片格式。

`*.binpng` 视频会进一步从 PNG 的 RGB 通道恢复原始字节，保留编码时的媒体扩展名。旧格式没有记录视频原始长度，因此与 Python 解码器一样去掉尾部零字节；原视频若恰好以零字节结尾，无法区分它们与填充零。浏览器不支持的媒体编码仍可下载到本地播放。

请使用未经截图、缩放、有损压缩的原始 PNG。大文件受浏览器内存和 Canvas 尺寸限制。

开发验证：在仓库根目录运行 `node --test dec_web/tests/decoder.test.cjs`（需要 Node.js 和 Python，直接复用 Python 编码器的文件头函数，无需安装 numpy）。

浏览器验证：运行 `node dec_web/tests/browser-smoke.cjs`，默认使用 Windows Chrome；可通过 `BROWSER_PATH` 指定浏览器路径。测试使用独立临时浏览器配置，验证实际 PNG 解码、BINPNG 还原、批量操作、粘贴、拖拽、取消与移动布局，并把截图写入系统临时目录。
