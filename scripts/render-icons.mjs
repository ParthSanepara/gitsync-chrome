// Renders public/icon/*.png from assets/icon.svg at every manifest icon size.
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url));

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(`../public/icon/${size}.png`, import.meta.url), png);
}
