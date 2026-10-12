import { parseDXF } from './model.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ parsed: parseDXF(data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
