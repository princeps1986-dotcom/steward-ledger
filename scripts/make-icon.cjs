// 로고 원본(build/icon.svg)으로 설치 파일 아이콘(build/icon.ico)과 build/icon.png(256px)를 만듭니다.
// 실행: npx electron scripts/make-icon.cjs  (이미지 변환 의존성 없이, 이미 있는 Electron으로 SVG를 그립니다)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BUILD = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** PNG들을 그대로 담는 ICO 파일(Windows Vista 이후 지원): 헤더 6바이트 + 항목 16바이트×개수 + PNG 데이터 */
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = 아이콘
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 = 256px
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // 색 평면
    e.writeUInt16LE(32, 6); // 색 깊이
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
  // 숨은 창 안에서 SVG를 크기마다 캔버스에 그려 PNG로 받습니다(화면 캡처는 화면 배율·GPU에 따라 실패할 수 있어 쓰지 않음).
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const urls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
    await img.decode();
    return ${JSON.stringify(SIZES)}.map((s) => {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, s, s);
      return c.toDataURL('image/png');
    });
  })()`);
  win.destroy();
  const pngs = SIZES.map((size, i) => ({ size, data: Buffer.from(urls[i].split(',')[1], 'base64') }));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), packIco(pngs));
  fs.writeFileSync(path.join(BUILD, 'icon.png'), pngs.at(-1).data);
  console.log(`build/icon.ico (${SIZES.join('·')}px), build/icon.png 저장`);
  app.quit();
});
