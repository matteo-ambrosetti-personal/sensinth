import chakra500 from '@fontsource/chakra-petch/files/chakra-petch-latin-500-normal.woff2?url';
import chakra600 from '@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2?url';
import plexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import plexMono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url';
import plexSans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url';
import plexSans500 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?url';
import plexSans600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?url';

/**
 * Self-hosted Latin faces, so the installed app looks the same offline: Chakra
 * Petch for titles and buttons, IBM Plex Sans to read, IBM Plex Mono for numbers.
 */
const FACES: [family: string, url: string, descriptors: FontFaceDescriptors][] = [
  ['Chakra Petch', chakra500, { weight: '500' }],
  ['Chakra Petch', chakra600, { weight: '600' }],
  ['IBM Plex Sans', plexSans400, { weight: '400' }],
  ['IBM Plex Sans', plexSans500, { weight: '500' }],
  ['IBM Plex Sans', plexSans600, { weight: '600' }],
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
