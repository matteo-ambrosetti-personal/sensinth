import pixelify400 from '@fontsource/pixelify-sans/files/pixelify-sans-latin-400-normal.woff2?url';
import pixelify600 from '@fontsource/pixelify-sans/files/pixelify-sans-latin-600-normal.woff2?url';
import pressStart from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2?url';
import vt323 from '@fontsource/vt323/files/vt323-latin-400-normal.woff2?url';

/** Self-hosted Latin pixel fonts, so the installed app looks the same offline. */
const FACES: [family: string, url: string, descriptors: FontFaceDescriptors][] = [
  ['Press Start 2P', pressStart, { weight: '400' }],
  ['Pixelify Sans', pixelify400, { weight: '400' }],
  ['Pixelify Sans', pixelify600, { weight: '600' }],
  ['VT323', vt323, { weight: '400' }],
];

export function loadFonts(): void {
  for (const [family, url, descriptors] of FACES) {
    const face = new FontFace(family, `url(${url}) format('woff2')`, {
      display: 'swap',
      ...descriptors,
    });
    document.fonts.add(face);
    face.load().catch(() => {
      // The fallback stack in style.css takes over.
    });
  }
}
