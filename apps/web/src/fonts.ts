import plexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import plexMono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url';
import plexSans from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url';
import unbounded from '@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2?url';

/** Self-hosted Latin fonts, so the installed app looks the same offline. */
const FACES: [family: string, url: string, descriptors: FontFaceDescriptors][] = [
  ['Unbounded', unbounded, { weight: '200 900' }],
  ['IBM Plex Sans', plexSans, { weight: '100 700' }],
  ['IBM Plex Mono', plexMono400, { weight: '400' }],
  ['IBM Plex Mono', plexMono500, { weight: '500' }],
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
