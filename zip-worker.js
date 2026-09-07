/* Local JSZip keeps conversion offline after the page has loaded. */
try { importScripts('vendor/jszip.min.js'); } catch (_) { /* The page falls back to its local main-thread copy. */ }

async function createZip(entries, store = true) {
    if (typeof self.JSZip === 'undefined') throw new Error('JSZip is unavailable in the archive worker');
    const zip = new self.JSZip();
    for (const entry of entries) zip.file(entry.name, entry.data);
    return zip.generateAsync({ type: 'blob', compression: store ? 'STORE' : 'DEFLATE', compressionOptions: { level: store ? 0 : 6 } });
}

async function createArchive({ images, comicInfoXml, metadataJson, store = true }) {
    return createZip([
        ...images.map(image => ({ name: image.filename, data: image.data })),
        { name: 'ComicInfo.xml', data: comicInfoXml },
        { name: 'metadata.json', data: metadataJson }
    ], store);
}

self.onmessage = async event => {
    const { id, action, payload } = event.data || {};
    try {
        let blob;
        if (action === 'createArchive') blob = await createArchive(payload);
        else if (action === 'createOuterZip') blob = await createZip(payload.entries.map(entry => ({ name: entry.name, data: entry.data })), payload.store);
        else throw new Error(`Unknown archive action: ${action}`);
        self.postMessage({ id, ok: true, result: { blob } });
    } catch (error) { self.postMessage({ id, ok: false, error: error.message || String(error) }); }
};
