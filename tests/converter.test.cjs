const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadParser() {
  const context = {
    window: {},
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    console,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('security-utils.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('azw3-parser.js', 'utf8'), context);
  return new context.AZW3Parser();
}

function loadApp() {
  const context = { window: {}, document: { addEventListener() {} }, console, URL, Blob, TextEncoder, setTimeout, clearTimeout };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync('app.js', 'utf8')}\nthis.ComicConverter = ComicConverter;`, context);
  context.ComicConverter._context = context;
  return context.ComicConverter;
}

function loadOpfPrototype() {
  const context = { window: {}, console };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync('opf-parser.js', 'utf8')}\nthis.OPFParser = OPFParser;`, context);
  return context.OPFParser.prototype;
}

function putText(bytes, offset, text) {
  for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index);
}

function png(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

function exthRecord(type, value) {
  const valueBytes = value instanceof Uint8Array ? value : [121, 201, 202].includes(type)
    ? (() => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, false); return bytes; })()
    : new TextEncoder().encode(String(value));
  const bytes = new Uint8Array(8 + valueBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, type, false);
  view.setUint32(4, bytes.length, false);
  bytes.set(valueBytes, 8);
  return bytes;
}

function fixture({ malformedExth = false, overlap = false, malformedPointer = false, hybrid = false, stalePointer = false, staleBoundary = false } = {}) {
  const bytes = new Uint8Array(960);
  const view = new DataView(bytes.buffer);
  putText(bytes, 60, 'BOOK');
  putText(bytes, 64, 'MOBI');
  view.setUint16(76, 4, false);
  const offsets = [200, 700, overlap ? 700 : 740, hybrid ? 920 : 780];
  offsets.forEach((offset, index) => {
    view.setUint32(78 + index * 8, offset, false);
    bytes[82 + index * 8] = 0;
    bytes.set([0, 0, index + 1], 83 + index * 8);
  });
  const mobi = 216;
  putText(bytes, mobi, 'MOBI');
  view.setUint32(mobi + 4, 232, false);
  view.setUint32(mobi + 12, 65001, false);
  view.setUint32(mobi + 68, 400, false);
  view.setUint32(mobi + 72, 11, false);
  view.setUint32(mobi + 92, 1, false);
  view.setUint32(mobi + 112, 0x40, false);
  // Sentinels prove offsets are relative to the MOBI header, not nearby fields.
  view.setUint32(mobi + 108, 0xffffffff, false);
  view.setUint32(mobi + 128, 0, false);
  const records = [
    exthRecord(100, 'Ada'), exthRecord(100, 'Bea'), exthRecord(101, 'Press'),
    exthRecord(103, 'Summary'), exthRecord(106, '2024-03-04'), exthRecord(524, 'en'),
    exthRecord(201, malformedPointer ? new TextEncoder().encode('1') : 1), exthRecord(202, 0), ...(hybrid || stalePointer ? [exthRecord(121, 2)] : [])
  ];
  const exthLength = 12 + records.reduce((total, record) => total + record.length, 0);
  putText(bytes, mobi + 232, 'EXTH');
  view.setUint32(mobi + 236, malformedExth ? 8 : exthLength, false);
  view.setUint32(mobi + 240, records.length, false);
  let at = mobi + 244;
  for (const record of records) { bytes.set(record, at); at += record.length; }
  putText(bytes, 600, 'Amazing #12');
  bytes.set(png(48, 48), 700);
  bytes.set(png(1000, 1600), 740);
  bytes.set(png(1000, 1600), hybrid ? 920 : 780);
  if (hybrid) {
    putText(bytes, 756, 'MOBI');
    view.setUint32(760, 116, false);
    view.setUint32(776, 8, false);
  }
  if (staleBoundary) putText(bytes, 740, 'BOUNDARY');
  return bytes.buffer;
}

test('reads MOBI metadata and EXTH pointers from their real header offsets', async () => {
  const result = await loadParser().parseFile(fixture());
  assert.equal(result.metadata.title, 'Amazing #12');
  assert.equal(result.metadata.author, 'Ada, Bea');
  assert.equal(result.metadata.publisher, 'Press');
  assert.equal(result.metadata.coverRecordIndex, 2);
  assert.equal(result.metadata.thumbnailRecordIndex, 1);
});

test('rejects malformed record and EXTH bounds instead of scanning arbitrary bytes', async () => {
  await assert.rejects(() => loadParser().parseFile(fixture({ overlap: true })), /offset|record/i);
  await assert.rejects(() => loadParser().parseFile(fixture({ malformedExth: true })), /EXTH/i);
  await assert.rejects(() => loadParser().parseFile(fixture({ malformedPointer: true })), /EXTH/i);
});

test('keeps physical order and renumbers selected image names past 999', () => {
  const parser = loadParser();
  const images = Array.from({ length: 1001 }, (_, index) => ({ recordIndex: index + 1, extension: 'jpg' }));
  const named = parser.nameSelectedImages(images);
  assert.equal(named[0].filename, 'page_0001.jpg');
  assert.equal(named[1000].filename, 'page_1001.jpg');
});

test('filters automatic thumbnails but permits explicit cover and small-image restoration', () => {
  const parser = loadParser();
  const images = [
    { recordIndex: 1, width: 48, height: 48, extension: 'png' },
    { recordIndex: 2, width: 1000, height: 1600, extension: 'png' },
    { recordIndex: 3, width: 1000, height: 1600, extension: 'png' },
  ];
  assert.deepEqual(Array.from(parser.buildSelection(images, { thumbnailRecordIndex: 1, coverRecordIndex: 3 }), image => image.recordIndex), [3, 2]);
  assert.deepEqual(Array.from(parser.buildSelection(images, { thumbnailRecordIndex: 1, coverRecordIndex: 3 }, { coverRecordIndex: 1 }), image => image.recordIndex), [1, 2, 3]);
  assert.deepEqual(Array.from(parser.buildSelection([images[0]], { thumbnailRecordIndex: 1, coverRecordIndex: 1 }), image => image.recordIndex), [1]);
  assert.deepEqual(Array.from(parser.buildSelection(images, { thumbnailRecordIndex: 1, coverRecordIndex: 3 }, { includeSmall: true }), image => image.recordIndex), [3, 1, 2]);
});

test('keeps tiny images when dimensions of a sibling image are unknown', () => {
  const parser = loadParser();
  const images = [{ recordIndex: 1, width: 0, height: 0, extension: 'jpg' }, { recordIndex: 2, width: 48, height: 48, extension: 'png' }];
  assert.deepEqual(Array.from(parser.buildSelection(images, { coverRecordIndex: 1, thumbnailRecordIndex: null }), image => image.recordIndex), [1, 2]);
});

test('does not read past trailing JPEG fill bytes', () => {
  const parser = loadParser();
  assert.doesNotThrow(() => parser.identifyImage(new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])));
});

test('keeps malformed JPEG SOF resources as dimension warnings', () => {
  const parser = loadParser();
  for (const bytes of [
    new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x02, 0x00, 0x00, 0x00]),
    new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x20, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0x02])
  ]) {
    assert.doesNotThrow(() => parser.identifyImage(bytes));
    const image = parser.identifyImage(bytes);
    assert.equal(image.width, 0);
    assert.equal(image.height, 0);
    assert.equal(image.warning, true);
  }
});

test('rejects hybrid MOBI6/KF8 containers before image extraction', async () => {
  await assert.rejects(() => loadParser().parseFile(fixture({ hybrid: true })), /Hybrid MOBI6\/KF8/i);
});

test('does not reject a standalone MOBI8 file when EXTH121 points at an image', async () => {
  const result = await loadParser().parseFile(fixture({ stalePointer: true }));
  assert.equal(result.metadata.title, 'Amazing #12');
});

test('groups every AZW3 in a directory and only uses unambiguous matching sidecars', () => {
  const ComicConverter = loadApp();
  const files = [
    { name: 'one.azw3', webkitRelativePath: 'books/one.azw3' },
    { name: 'two.azw3', webkitRelativePath: 'books/two.azw3' },
    { name: 'one.opf', webkitRelativePath: 'books/one.opf' },
    { name: 'cover.jpg', webkitRelativePath: 'books/cover.jpg' },
    { name: 'notes.txt', webkitRelativePath: 'books/notes.txt' },
  ];
  const jobs = ComicConverter.prototype.buildJobs.call({}, files);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].opf.name, 'one.opf');
  assert.equal(jobs[1].opf, null);
  assert.equal(jobs[0].cover, null);
  assert.match(jobs[0].warnings.join(' '), /ambiguous/i);
});

test('keeps embedded fields when a valid OPF supplies only one field and avoids output-name collisions', () => {
  const opf = loadOpfPrototype();
  assert.deepEqual({ ...opf.mergeMetadata({ title: 'Embedded', publisher: 'Press', author: 'Ada', creator: 'Ada' }, { title: 'Sidecar', creator: 'Bea' }) }, { title: 'Sidecar', publisher: 'Press', author: 'Bea', creator: 'Bea' });
  const ComicConverter = loadApp();
  const converter = { completedFiles: new Map([['first', { outputName: 'Issue.cbz' }]]), safeName: ComicConverter.prototype.safeName, fileKey: ComicConverter.prototype.fileKey };
  assert.equal(ComicConverter.prototype.uniqueOutputName.call(converter, 'Issue.azw3'), 'Issue (1).cbz');
  converter.completedFiles.set('cafe', { outputName: 'Café.cbz' });
  assert.equal(ComicConverter.prototype.uniqueOutputName.call(converter, 'Cafe\u0301.azw3').normalize('NFC'), 'Café (1).cbz');
});

test('preflights serialized metadata as well as selected image bytes', () => {
  const ComicConverter = loadApp();
  const controller = { opfParser: { generateComicInfo: metadata => `<Summary>${metadata.description.replace(/&/g, '&amp;')}</Summary>` } };
  const payload = ComicConverter.prototype.createArchivePayload.call(
    controller,
    { file: { name: 'Issue.azw3' } },
    { title: 'Issue', description: '&'.repeat(1024 * 1024) },
    [{ filename: 'page_0001.jpg', data: new Uint8Array([1]) }],
    ''
  );
  assert.ok(payload.estimate > 5 * 1024 * 1024);
});

test('credits a replaced result for rebuild budget checks but not ordinary intake', async () => {
  const ComicConverter = loadApp();
  const rebuild = async nextSize => {
    const old = { sourceFile: {}, opfFile: null, coverFile: null, outputName: 'Issue.cbz', cbzBlob: new Blob([new Uint8Array(40)]), previewUrl: '', warnings: [] };
    const controller = {
      completedFiles: new Map([['issue', old]]), retainedBytes: 98, maxRetainedBytes: 100, activeOperation: false,
      ensureBudget: ComicConverter.prototype.ensureBudget,
      archivePrepared: ComicConverter.prototype.archivePrepared,
      prepareResult: async job => ({ job, archive: { payload: {} }, selected: [{}], metadata: {}, candidates: [], settings: { includeSmall: false, coverRecordIndex: 1 }, estimate: 40 }),
      postToWorker: async () => ({ blob: new Blob([new Uint8Array(nextSize)]) }),
      createPreview: async () => ({ url: '' }),
      runOperation: async (_, action) => action(), showCompletedFiles() {}, setBatchStatus() {},
      errors: [], showError(...args) { this.errors.push(args); }, securityUtils: { sanitizeErrorMessage: error => error.message }
    };
    await ComicConverter.prototype.rebuildResult.call(controller, 'issue', {}, 'cover');
    return { controller, old };
  };

  const replaced = await rebuild(40);
  assert.notEqual(replaced.controller.completedFiles.get('issue'), replaced.old);
  assert.equal(replaced.controller.retainedBytes, 98);
  assert.throws(() => ComicConverter.prototype.ensureBudget.call({ retainedBytes: 98, maxRetainedBytes: 100 }, 3), /Retained output limit/);

  const oversized = await rebuild(50);
  assert.equal(oversized.controller.completedFiles.get('issue'), oversized.old);
  assert.equal(oversized.controller.retainedBytes, 98);
  assert.equal(oversized.controller.errors.length, 1);
});

test('ignores a broken optional sidecar until the user explicitly selects it', async () => {
  const ComicConverter = loadApp();
  const warnings = [];
  const controller = { securityUtils: { validateFileSize() { throw new Error('File is empty'); } } };
  assert.equal(await ComicConverter.prototype.optionalSidecarInfo.call(controller, { name: 'cover.jpg' }, warnings), null);
  assert.match(warnings.join(' '), /Ignored cover sidecar/i);
});

test('writes ComicInfo in schema order and only emits supplied numeric date fields', () => {
  const opf = loadOpfPrototype();
  const xml = opf.generateComicInfo({ title: 'A & B', creator: 'Ada', publisher: 'Press', language: 'en', date: '2024-03-04' }, 2);
  assert.ok(xml.indexOf('<Title>') < xml.indexOf('<Writer>'));
  assert.ok(xml.indexOf('<PageCount>2</PageCount>') < xml.indexOf('<Pages>'));
  assert.match(xml, /<Year>2024<\/Year><Month>3<\/Month><Day>4<\/Day>/);
  assert.doesNotMatch(opf.generateComicInfo({ title: 'No date' }, 1), /<(Year|Month|Day)>/);
  assert.match(opf.generateComicInfo({ title: 'Timestamp', date: '2024-02-29T23:30:00-05:00' }, 1), /<Year>2024<\/Year><Month>2<\/Month><Day>29<\/Day>/);
  assert.doesNotMatch(opf.generateComicInfo({ title: 'Bad date', date: '2024-02-30' }, 1), /<(Year|Month|Day)>/);
  assert.doesNotMatch(opf.generateComicInfo({ title: 'Bad\u0001XML' }, 1), /\u0001/);
});

test('archive worker writes selected pages and metadata through one archive action', async () => {
  const sent = [];
  class FakeZip {
    constructor() { this.entries = []; }
    file(name, data) { this.entries.push({ name, data }); }
    async generateAsync() { return new Blob([this.entries.map(entry => entry.name).join('|')]); }
  }
  const self = { JSZip: FakeZip, importScripts() {}, postMessage(message) { sent.push(message); } };
  const context = { self, Blob };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('zip-worker.js', 'utf8'), context);
  await self.onmessage({
    data: {
      id: 1,
      action: 'createArchive',
      payload: { images: [{ filename: 'page_0001.png', data: new Uint8Array([1]) }], comicInfoXml: '<ComicInfo/>', metadataJson: '{"title":"A"}' }
    }
  });
  assert.equal(sent[0].ok, true);
  assert.match(await sent[0].result.blob.text(), /page_0001\.png\|ComicInfo\.xml\|metadata\.json/);
});

test('controller archive fallback writes the same three archive entries', async () => {
  const ComicConverter = loadApp();
  const entries = [];
  ComicConverter._context.JSZip = class {
    file(name) { entries.push(name); }
    generateAsync() { return Promise.resolve(new Blob(['fallback'])); }
  };
  await ComicConverter.prototype.createArchiveFallback.call({}, { images: [{ filename: 'page_0001.png', data: new Uint8Array([1]) }], comicInfoXml: '<ComicInfo/>', metadataJson: '{}' });
  assert.deepEqual(entries, ['page_0001.png', 'ComicInfo.xml', 'metadata.json']);
});

test('cap status records attempted, converted, and every remaining name', () => {
  const ComicConverter = loadApp();
  let message = '';
  const converter = { pendingFileNames: [], setBatchStatus(value) { message = value; } };
  ComicConverter.prototype.setCapStatus.call(converter, [{ file: { name: 'a.azw3' } }, { file: { name: 'b.azw3' } }], 1, 0, 1);
  assert.match(message, /Attempted 1 of 2; converted 0/);
  assert.deepEqual(converter.pendingFileNames, ['b.azw3']);
});

test('cap remainder names persist through save and clear status, then reset for a new batch', async () => {
  const ComicConverter = loadApp();
  const status = { textContent: '' };
  ComicConverter._context.document = {
    getElementById(id) {
      if (id === 'batchStatus') return status;
      if (id === 'fileList') return { replaceChildren() {} };
      if (id === 'processingSection') return { style: {} };
      throw new Error(`Unexpected element: ${id}`);
    }
  };
  const converter = { pendingFileNames: [], setBatchStatus: ComicConverter.prototype.setBatchStatus };
  ComicConverter.prototype.setCapStatus.call(converter, [{ file: { name: 'done.azw3' } }, { file: { name: 'resume.azw3' } }], 1, 1, 1);
  converter.setBatchStatus('Saved 1 CBZ file to the selected folder.');
  assert.match(status.textContent, /resume\.azw3/);
  converter.setBatchStatus('Results cleared.');
  assert.match(status.textContent, /resume\.azw3/);

  Object.assign(converter, {
    buildJobs() { return [{ file: { name: 'new.azw3', size: 1 } }]; },
    securityUtils: { MAX_FILES_PER_BATCH: 2, MAX_TOTAL_SIZE: 2 },
    retainedBytes: 0,
    maxRetainedBytes: 10,
    processJob: async () => true,
    showResults() {}
  });
  await ComicConverter.prototype.convertSnapshot.call(converter, []);
  assert.equal(converter.pendingFileNames.length, 0);
  assert.doesNotMatch(status.textContent, /resume\.azw3/);
});
