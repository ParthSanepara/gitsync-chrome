// isomorphic-git expects a global Buffer in the browser. Imported first so it is
// installed before isomorphic-git's module body runs.
import { Buffer } from 'buffer';

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
