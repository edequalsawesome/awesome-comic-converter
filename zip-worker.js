// Zip worker: offloads CBZ and outer ZIP creation to a Web Worker
// Loads JSZip from CDN (allowed by CSP: script-src includes cdnjs)

/* eslint-disable no-restricted-globals */

try {
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
} catch (e) {
  // If importScripts fails, the main thread should fallback
}

let requestIdCounter = 0;

/**
 * Utility to respond
 */
function respond(id, ok, result, error) {
  self.postMessage({ id, ok, result, error });
}

/**
 * Build a CBZ blob from images and metadata
 */
async function createCBZ({ images, metadata, store = true }) {
  if (typeof self.JSZip === 'undefined') {
    throw new Error('JSZip not available in worker');
  }
  const zip = new self.JSZip();
  for (const img of images) {
    // img: { filename, data: ArrayBuffer | Uint8Array }
    zip.file(img.filename, img.data);
  }
  if (metadata) {
    zip.file('metadata.json', JSON.stringify(metadata, null, 2));
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: store ? 'STORE' : 'DEFLATE',
    compressionOptions: { level: store ? 0 : 6 }
  });
  return blob;
}

/**
 * Build an enhanced CBZ with ComicInfo.xml and optional cover
 */
async function createEnhancedCBZ({ images, comicInfoXml, cover, metadata, store = true }) {
  if (typeof self.JSZip === 'undefined') {
    throw new Error('JSZip not available in worker');
  }
  const zip = new self.JSZip();
  if (cover) {
    zip.file(cover.filename, cover.data);
  }
  for (const img of images) {
    zip.file(img.filename, img.data);
  }
  if (comicInfoXml) {
    zip.file('ComicInfo.xml', comicInfoXml);
  }
  if (metadata) {
    zip.file('metadata.json', JSON.stringify(metadata, null, 2));
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: store ? 'STORE' : 'DEFLATE',
    compressionOptions: { level: store ? 0 : 6 }
  });
  return blob;
}

/**
 * Build an outer ZIP of already-built CBZ files
 */
async function createOuterZip({ entries, store = true }) {
  if (typeof self.JSZip === 'undefined') {
    throw new Error('JSZip not available in worker');
  }
  const zip = new self.JSZip();
  for (const entry of entries) {
    // entry: { name, data: Blob }
    zip.file(entry.name, entry.data);
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: store ? 'STORE' : 'DEFLATE',
    compressionOptions: { level: store ? 0 : 6 }
  });
  return blob;
}

self.onmessage = async (event) => {
  const { id, action, payload } = event.data || {};
  try {
    switch (action) {
      case 'createCBZ': {
        const blob = await createCBZ(payload);
        respond(id, true, { blob }, null);
        break;
      }
      case 'createEnhancedCBZ': {
        const blob = await createEnhancedCBZ(payload);
        respond(id, true, { blob }, null);
        break;
      }
      case 'createOuterZip': {
        const blob = await createOuterZip(payload);
        respond(id, true, { blob }, null);
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    respond(id, false, null, error && (error.message || String(error)));
  }
};


