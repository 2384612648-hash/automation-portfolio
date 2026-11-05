import fs from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const directory = new URL('../test-results/fixtures/', import.meta.url);
await fs.mkdir(directory, { recursive: true });
for (const [name, labels] of [['first.pdf',['PAGE A','PAGE B']],['second.pdf',['PAGE C']]]) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    const page = document.addPage([420,594]);
    page.drawText(label,{x:60,y:450,size:44,font,color:rgb(.1,.3,.2)});
  }
  await fs.writeFile(new URL(name,directory),await document.save());
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type,data) {
  const header = Buffer.alloc(4), checksum = Buffer.alloc(4), content = Buffer.concat([Buffer.from(type),data]);
  header.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([header,content,checksum]);
}
const width = 2400, height = 1600, ihdr = Buffer.alloc(13), pixels = Buffer.alloc((width * 3 + 1) * height);
ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8] = 8; ihdr[9] = 2;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const index = y * (width * 3 + 1) + x * 3 + 1;
    pixels[index] = Math.floor(x / width * 255);
    pixels[index + 1] = Math.floor(y / height * 255);
    pixels[index + 2] = ((x >> 5) ^ (y >> 5)) % 2 ? 140 : 190;
  }
}
await fs.writeFile(new URL('sample.png',directory),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
console.log('Created independent PDF and PNG fixtures in test-results/fixtures.');
