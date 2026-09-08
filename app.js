class ComicConverter {
    constructor() {
        this.securityUtils = new SecurityUtils();
        this.parser = new AZW3Parser();
        this.opfParser = new OPFParser();
        this.completedFiles = new Map();
        this.errors = [];
        this.pendingFileNames = [];
        this.retainedBytes = 0;
        this.maxRetainedBytes = 512 * 1024 * 1024;
        this.activeOperation = false;
        this.zipWorker = null;
        this.workerCallbacks = new Map();
        this.workerRequestId = 0;
        this.securityUtils.setupGlobalErrorHandler();
        this.initializeZipWorker();
        this.initializeEventListeners();
        this.initializeTheme();
    }

    initializeZipWorker() {
        try {
            this.zipWorker = new Worker('zip-worker.js');
            this.zipWorker.onmessage = event => this.finishWorkerRequest(event.data || {});
            this.zipWorker.onerror = event => { event.preventDefault?.(); this.failWorker(event.message || 'Archive worker failed'); };
            this.zipWorker.onmessageerror = () => this.failWorker('Archive worker response could not be read');
        } catch (_) { this.zipWorker = null; }
    }

    finishWorkerRequest({ id, ok, result, error }) {
        const callback = this.workerCallbacks.get(id);
        if (!callback) return;
        this.workerCallbacks.delete(id);
        ok ? callback.resolve(result) : callback.reject(new Error(error || 'Archive worker failed'));
    }

    failWorker(message) {
        for (const callback of this.workerCallbacks.values()) callback.reject(new Error(message));
        this.workerCallbacks.clear();
        if (this.zipWorker) this.zipWorker.terminate();
        this.zipWorker = null;
    }

    postToWorker(action, payload) {
        if (!this.zipWorker) return Promise.reject(new Error('Archive worker unavailable'));
        const id = ++this.workerRequestId;
        return new Promise((resolve, reject) => {
            this.workerCallbacks.set(id, { resolve, reject });
            try { this.zipWorker.postMessage({ id, action, payload }); }
            catch (error) { this.workerCallbacks.delete(id); reject(error); }
        });
    }

    initializeEventListeners() {
        const fileInput = document.getElementById('fileInput');
        const folderInput = document.getElementById('folderInput');
        const dropZone = document.getElementById('dropZone');
        fileInput.addEventListener('change', event => this.snapshotInput(event.target, 'files'));
        folderInput.addEventListener('change', event => this.snapshotInput(event.target, 'folders'));
        document.getElementById('browseBtn').addEventListener('click', () => fileInput.click());
        document.getElementById('browseFolderBtn').addEventListener('click', () => folderInput.click());
        document.getElementById('clearBtn').addEventListener('click', () => this.clearResults());
        document.getElementById('downloadAllBtn').addEventListener('click', () => this.downloadAllFiles());
        document.getElementById('saveAllBtn').addEventListener('click', () => this.saveAllToFolder());
        document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());
        dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', event => this.handleDrop(event));
        document.addEventListener('dragover', event => event.preventDefault());
        document.addEventListener('drop', event => event.preventDefault());
    }

    snapshotInput(input, source) {
        const files = Array.from(input.files || []);
        input.value = '';
        this.processSnapshot(files, source);
    }

    async handleDrop(event) {
        event.preventDefault();
        const zone = document.getElementById('dropZone');
        zone.classList.remove('drag-over');
        if (this.activeOperation) return this.setBatchStatus('A conversion is already running. Wait for it to finish before adding another batch.');
        await this.runOperation('drop intake', async () => this.convertSnapshot(await this.processDroppedItems(event.dataTransfer)));
    }

    async processDroppedItems(dataTransfer) {
        const files = [];
        const unreadable = [];
        const items = Array.from(dataTransfer.items || []).map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile?.() }));
        const fallbackFiles = Array.from(dataTransfer.files || []);
        for (const item of items) {
            const entry = item.entry;
            if (!entry) { if (item.file) files.push(item.file); continue; }
            try {
                if (entry.isDirectory) files.push(...await this.readDirectory(entry));
                else { const file = await this.getFileFromEntry(entry); if (file) files.push(file); }
            } catch (_) { unreadable.push(entry.name); }
        }
        if (!files.length) files.push(...fallbackFiles);
        if (unreadable.length) this.showError('Unreadable folders', `Skipped ${unreadable.join(', ')}; readable files were kept.`);
        return files;
    }

    readDirectory(entry, path = entry.fullPath?.replace(/^\//, '') || entry.name) {
        const readAll = reader => new Promise((resolve, reject) => {
            const entries = [];
            const next = () => reader.readEntries(batch => batch.length ? (entries.push(...batch), next()) : resolve(entries), reject);
            next();
        });
        return readAll(entry.createReader()).then(async entries => {
            const files = [];
            for (const child of entries) {
                const childPath = `${path}/${child.name}`;
                if (child.isDirectory) {
                    try { files.push(...await this.readDirectory(child, childPath)); }
                    catch (_) { this.showError('Unreadable folder', `Skipped ${childPath}; readable files were kept.`); }
                } else {
                    try {
                        const file = await this.getFileFromEntry(child);
                        file._syntheticPath = childPath;
                        files.push(file);
                    } catch (_) { this.showError('Unreadable file', `Skipped ${childPath}; readable files were kept.`); }
                }
            }
            return files;
        });
    }

    getFileFromEntry(entry) { return new Promise((resolve, reject) => entry.file(resolve, () => reject(new Error(`Could not read ${entry.name}`)))); }

    async processSnapshot(files, source) {
        if (this.activeOperation) return this.setBatchStatus('A conversion is already running. Existing results were kept.');
        await this.runOperation(source, async () => this.convertSnapshot(files));
    }

    async convertSnapshot(files) {
        const jobs = this.buildJobs(files);
        if (!jobs.length) return this.showError('No AZW3 files found', 'Choose AZW3 files or folders containing AZW3 files.');
        if (jobs.length > this.securityUtils.MAX_FILES_PER_BATCH) throw new Error(`Too many AZW3 files. Maximum ${this.securityUtils.MAX_FILES_PER_BATCH} per batch.`);
        const total = jobs.reduce((sum, job) => sum + (job.file.size || 0), 0);
        if (total > this.securityUtils.MAX_TOTAL_SIZE) throw new Error('This AZW3 batch is too large. Split it into smaller batches.');
        this.pendingFileNames = [];
        document.getElementById('fileList').replaceChildren();
        document.getElementById('processingSection').style.display = 'block';
        let completed = 0;
        let stopped = false;
        for (let index = 0; index < jobs.length; index++) {
            if (this.retainedBytes >= this.maxRetainedBytes) {
                this.setCapStatus(jobs, index, completed, index);
                stopped = true;
                break;
            }
            try { if (await this.processJob(jobs[index])) completed++; }
            catch (error) {
                if (/Retained output limit/.test(error.message)) {
                    this.setCapStatus(jobs, index, completed, index + 1);
                    stopped = true;
                    break;
                }
                throw error;
            }
        }
        this.showResults();
        if (!stopped) this.setBatchStatus(`Converted ${completed} of ${jobs.length} AZW3 file${jobs.length === 1 ? '' : 's'}; results were appended.`);
    }

    buildJobs(files) {
        const grouped = new Map();
        for (const file of files) {
            const path = file.webkitRelativePath || file._syntheticPath || file.name;
            const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
            if (!grouped.has(directory)) grouped.set(directory, []);
            grouped.get(directory).push(file);
        }
        const jobs = [];
        for (const [directory, group] of grouped) {
            const books = group.filter(file => /\.azw3$/i.test(file.name));
            const opfs = group.filter(file => /\.opf$/i.test(file.name));
            const covers = group.filter(file => /\.(jpe?g|png|gif)$/i.test(file.name));
            for (const file of books) {
                const stem = file.name.replace(/\.azw3$/i, '').toLowerCase();
                const sameStemOpfs = opfs.filter(sidecar => sidecar.name.replace(/\.opf$/i, '').toLowerCase() === stem);
                const sameStemCovers = covers.filter(sidecar => sidecar.name.replace(/\.(jpe?g|png|gif)$/i, '').toLowerCase() === stem);
                const warnings = [];
                const choose = (matches, kind) => {
                    if (matches.length > 1) warnings.push(`Multiple matching ${kind} sidecars; using ${matches.sort((a, b) => a.name.localeCompare(b.name))[0].name}.`);
                    return matches[0] || null;
                };
                let opf = choose(sameStemOpfs, 'OPF');
                let cover = choose(sameStemCovers, 'cover');
                if (books.length === 1) {
                    opf ||= choose(opfs.filter(sidecar => /^metadata\.opf$/i.test(sidecar.name)), 'OPF');
                    cover ||= choose(covers.filter(sidecar => /^cover\.(jpe?g|png|gif)$/i.test(sidecar.name)), 'cover');
                } else if (!opf && opfs.length || !cover && covers.some(sidecar => /^cover\./i.test(sidecar.name))) {
                    warnings.push('Shared folder sidecars are ambiguous and were not attached.');
                }
                jobs.push({ file, opf, cover, directory, warnings });
            }
        }
        return jobs;
    }

    async processJob(job) {
        const id = `file_${this.securityUtils.generateSecureId()}`;
        this.addProcessingRow(id, job.file.name);
        try {
            this.securityUtils.validateFileSize(job.file);
            this.securityUtils.validateFileExtension(job.file.name, ['azw3']);
            this.updateFileStatus(id, 'Reading AZW3…', 15);
            const prepared = await this.prepareResult(job, {});
            this.ensureBudget(prepared.estimate);
            this.updateFileStatus(id, 'Creating CBZ…', 70);
            const result = await this.archivePrepared(prepared, this.uniqueOutputName(job.file.name));
            result.id = id;
            this.completedFiles.set(id, result);
            this.retainedBytes += result.cbzBlob.size;
            this.updateFileStatus(id, 'Conversion complete', 100, 'complete');
            return true;
        } catch (error) {
            if (/Retained output limit/.test(error.message)) { this.updateFileStatus(id, 'Not converted: retained output limit reached.', 0, 'error'); throw error; }
            this.updateFileStatus(id, `Error: ${this.securityUtils.sanitizeErrorMessage(error)}`, 0, 'error');
            this.errors.push({ fileName: job.file.name, error: this.securityUtils.sanitizeErrorMessage(error) });
            return false;
        }
    }

    async prepareResult(job, settings, metadataSnapshot = null) {
        const parsed = await this.parser.parseFile(await this.readFileAsArrayBuffer(job.file));
        if (!parsed.images.length) throw new Error('No supported image resources were found');
        let metadata = metadataSnapshot || parsed.metadata;
        if (!metadataSnapshot && job.opf) {
            if (job.opf.size > 1024 * 1024) job.warnings.push('Ignored OPF sidecar larger than 1 MiB.');
            else try {
                const opf = this.opfParser.parseOPF(await this.readFileAsText(job.opf));
                if (opf.isValid) metadata = this.opfParser.mergeMetadata(parsed.metadata, opf.metadata);
                else job.warnings.push(`Ignored invalid OPF: ${opf.error}`);
            } catch (_) { job.warnings.push('Ignored unreadable OPF sidecar.'); }
        }
        metadata = { ...metadata, title: metadata.title || this.fileTitle(job.file.name), author: metadata.author || metadata.creator || '', creator: metadata.creator || metadata.author || '', publisher: metadata.publisher || '' };
        for (const warning of parsed.imageWarnings || []) if (!job.warnings.includes(warning)) job.warnings.push(warning);
        let selected = this.parser.buildSelection(parsed.images, metadata, settings);
        const sidecarInfo = await this.optionalSidecarInfo(job.cover, job.warnings);
        let sidecar = null;
        if (settings.coverRecordIndex === 'sidecar') {
            sidecar = sidecarInfo;
            if (!sidecar) throw new Error('The selected cover sidecar is not a supported image');
            selected = this.parser.nameSelectedImages([sidecar, ...selected]);
        }
        if (!selected.length) throw new Error('Filtering left no images to archive');
        const candidates = parsed.images.map((image, index) => ({ recordIndex: image.recordIndex, ordinal: index + 1, width: image.width, height: image.height, format: image.format, extension: image.extension, isThumbnail: image.recordIndex === metadata.thumbnailRecordIndex, isTiny: this.parser.isTiny(image) }));
        if (sidecarInfo) candidates.push({ recordIndex: 'sidecar', width: sidecarInfo.width, height: sidecarInfo.height, format: 'Sidecar', extension: job.cover.name.split('.').pop().toLowerCase(), label: job.cover.name });
        const archive = this.createArchivePayload(job, metadata, selected, parsed.warning);
        return { job, metadata, selected, candidates, sidecar, settings: { includeSmall: !!settings.includeSmall, coverRecordIndex: settings.coverRecordIndex ?? selected[0].recordIndex }, estimate: archive.estimate, archive, warning: parsed.warning };
    }

    async readSidecar(file) {
        if (!file) return null;
        const data = new Uint8Array(await this.readFileAsArrayBuffer(file));
        const info = this.parser.identifyImage(data);
        return info ? { ...info, data, recordIndex: 'sidecar', filename: '' } : null;
    }

    async optionalSidecarInfo(file, warnings) {
        if (!file) return null;
        try {
            this.securityUtils.validateFileSize(file);
            const sidecar = await this.readSidecar(file);
            if (!sidecar) warnings.push('Ignored unsupported cover sidecar.');
            return sidecar;
        } catch (_) { warnings.push('Ignored cover sidecar that could not be read.'); return null; }
    }

    async archivePrepared(prepared, outputName, credit = 0) {
        const payload = prepared.archive.payload;
        let blob;
        try { ({ blob } = await this.postToWorker('createArchive', payload)); }
        catch (_) { blob = await this.createArchiveFallback(payload); }
        if (this.retainedBytes - credit + blob.size > this.maxRetainedBytes) throw new Error('Retained output limit reached. Save or clear completed results before converting more.');
        const preview = await this.createPreview(prepared.selected[0]);
        const warnings = [...new Set([...prepared.job.warnings.filter(warning => warning !== 'Cover preview unavailable; the archive is unchanged.'), ...(preview.warning ? [preview.warning] : [])])];
        return {
            sourceFile: prepared.job.file, opfFile: prepared.job.opf, coverFile: prepared.job.cover, outputName, cbzBlob: blob,
            imageCount: prepared.selected.length, metadata: prepared.metadata, candidates: prepared.candidates, selectedCover: prepared.settings.coverRecordIndex,
            includeSmall: prepared.settings.includeSmall, warnings, previewUrl: preview.url, estimate: prepared.estimate
        };
    }

    async createPreview(image) {
        let bitmap;
        try {
            const type = `image/${image.extension === 'jpg' ? 'jpeg' : image.extension}`;
            bitmap = await createImageBitmap(new Blob([image.data], { type }));
            const scale = Math.min(1, 192 / bitmap.width, 256 / bitmap.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas encoding failed')), 'image/png'));
            return { url: URL.createObjectURL(blob) };
        } catch (_) { return { url: '', warning: 'Cover preview unavailable; the archive is unchanged.' }; }
        finally { bitmap?.close(); }
    }

    async createArchiveFallback({ images, comicInfoXml, metadataJson }) {
        const zip = new JSZip();
        for (const image of images) zip.file(image.filename, image.data);
        zip.file('ComicInfo.xml', comicInfoXml);
        zip.file('metadata.json', metadataJson);
        return zip.generateAsync({ type: 'blob', compression: 'STORE', compressionOptions: { level: 0 } });
    }

    createArchivePayload(job, metadata, selected, warning) {
        const comicInfoXml = this.opfParser.generateComicInfo(metadata, selected.length);
        const archiveMetadata = { ...metadata, pageCount: selected.length, convertedFrom: job.file.name, warning };
        const metadataJson = JSON.stringify(archiveMetadata, null, 2);
        const textBytes = new TextEncoder().encode(comicInfoXml).byteLength + new TextEncoder().encode(metadataJson).byteLength;
        const imageBytes = selected.reduce((total, image) => total + image.data.byteLength, 0);
        const estimate = imageBytes + textBytes + 8192 + (selected.length + 2) * 256;
        return { estimate, payload: { images: selected.map(image => ({ filename: image.filename, data: image.data })), comicInfoXml, metadataJson, store: true } };
    }

    ensureBudget(estimate, credit = 0) {
        if (this.retainedBytes - credit + estimate > this.maxRetainedBytes) throw new Error('Retained output limit reached. Save or clear completed results before converting more.');
    }

    async rebuildResult(id, settings, focusTarget = 'cover') {
        const current = this.completedFiles.get(id);
        if (!current || this.activeOperation) return;
        await this.runOperation('rebuild', async () => {
            try {
                const job = { file: current.sourceFile, opf: current.opfFile, cover: current.coverFile, warnings: [...current.warnings] };
                const prepared = await this.prepareResult(job, settings, current.metadata);
                this.ensureBudget(prepared.estimate, current.cbzBlob.size);
                const next = await this.archivePrepared(prepared, current.outputName, current.cbzBlob.size);
                next.id = id;
                this.completedFiles.set(id, next);
                this.retainedBytes += next.cbzBlob.size - current.cbzBlob.size;
                URL.revokeObjectURL(current.previewUrl);
                this.showCompletedFiles(id, focusTarget);
                this.setBatchStatus(`Rebuilt ${current.outputName}.`);
            } catch (error) { this.showError('Cover rebuild failed', this.securityUtils.sanitizeErrorMessage(error)); this.showCompletedFiles(id, focusTarget); }
        });
    }

    uniqueOutputName(originalName) {
        const base = this.safeName(originalName.replace(/\.azw3$/i, '')) || 'Comic';
        const used = new Set([...this.completedFiles.values()].map(result => this.fileKey(result.outputName)));
        let suffix = 0; let name = `${base}.cbz`;
        while (used.has(this.fileKey(name))) name = `${base} (${++suffix}).cbz`;
        return name;
    }

    safeName(value) { return String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').trim().slice(0, 180); }
    fileKey(value) { return String(value).normalize('NFC').toLowerCase(); }
    fileTitle(name) { return name.replace(/\.azw3$/i, '').replace(/[._-]+/g, ' ').trim() || 'Unknown Comic'; }

    readFileAsText(file) { return file.text ? file.text() : this.readWithFileReader(file, 'readAsText'); }
    readFileAsArrayBuffer(file) { return file.arrayBuffer ? file.arrayBuffer() : this.readWithFileReader(file, 'readAsArrayBuffer'); }
    readWithFileReader(file, method) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Failed to read file')); reader[method](file); }); }

    addProcessingRow(id, name) {
        const item = this.securityUtils.createSafeElement('div', '', 'file-item'); item.id = `file-${id}`;
        item.append(this.securityUtils.createSafeElement('h4', name), this.securityUtils.createSafeElement('div', '', 'progress-bar'));
        item.children[1].append(this.securityUtils.createSafeElement('div', '', 'progress-fill'));
        item.children[1].firstChild.id = `progress-${id}`;
        const status = this.securityUtils.createSafeElement('div', 'Preparing…', 'status processing'); status.id = `status-${id}`; status.setAttribute('role', 'status'); item.append(status);
        document.getElementById('fileList').append(item);
    }
    updateFileStatus(id, message, progress, state = 'processing') { const bar = document.getElementById(`progress-${id}`); const status = document.getElementById(`status-${id}`); if (bar) bar.style.width = `${progress}%`; if (status) { status.textContent = message; status.className = `status ${state}`; } }

    showResults() { document.getElementById('processingSection').style.display = 'none'; this.showCompletedFiles(); if (this.errors.length) this.showErrors(); }
    showCompletedFiles(focusId = '', focusTarget = 'cover') {
        const section = document.getElementById('resultsSection'); const list = document.getElementById('downloadList');
        list.replaceChildren();
        for (const [id, result] of this.completedFiles) {
            const item = document.createElement('div'); item.className = 'download-item'; item.dataset.resultId = id;
            const preview = document.createElement('img'); preview.className = 'cover-preview'; preview.src = result.previewUrl || ''; preview.alt = result.previewUrl ? `Current cover for ${result.outputName}` : 'Cover preview unavailable';
            const info = this.securityUtils.createSafeElement('div', '', 'download-info');
            info.append(this.securityUtils.createSafeElement('h4', result.metadata.title || result.outputName), this.securityUtils.createSafeElement('p', `${result.imageCount} pages • ${this.formatFileSize(result.cbzBlob.size)}`));
            const label = this.securityUtils.createSafeElement('label', 'Cover page', 'cover-label'); const select = document.createElement('select'); select.dataset.resultId = id; select.setAttribute('aria-label', `Cover page for ${result.outputName}`);
            for (const candidate of result.candidates) {
                const option = document.createElement('option'); option.value = candidate.recordIndex; option.selected = String(candidate.recordIndex) === String(result.selectedCover);
                const detail = `${candidate.width}×${candidate.height}${candidate.isThumbnail ? ', thumbnail' : candidate.isTiny ? ', small image' : ''}`;
                option.textContent = candidate.recordIndex === 'sidecar' ? `Sidecar: ${candidate.label || 'cover image'} (adds one page)` : `Image ${candidate.ordinal} (${detail})`;
                select.append(option);
            }
            select.addEventListener('change', () => this.rebuildResult(id, { includeSmall: result.includeSmall, coverRecordIndex: select.value === 'sidecar' ? 'sidecar' : Number(select.value) }, 'cover')); label.append(select);
            const restore = document.createElement('label'); restore.className = 'restore-small'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = result.includeSmall; checkbox.addEventListener('change', () => this.rebuildResult(id, { includeSmall: checkbox.checked, coverRecordIndex: result.selectedCover }, 'restore')); restore.append(checkbox, document.createTextNode(' Include thumbnails and small images'));
            info.append(label, restore, this.securityUtils.createSafeElement('small', result.warnings.filter(Boolean).join(' ')));
            const download = this.securityUtils.createSafeElement('button', 'Download CBZ', 'download-btn'); download.addEventListener('click', () => this.downloadFile(id));
            item.append(preview, info, download); list.append(item);
        }
        const hasResults = this.completedFiles.size > 0;
        section.style.display = hasResults ? 'block' : 'none';
        document.getElementById('downloadAllBtn').style.display = this.completedFiles.size > 1 ? 'flex' : 'none';
        document.getElementById('saveAllBtn').style.display = hasResults && window.showDirectoryPicker ? 'flex' : 'none';
        document.getElementById('clearBtn').style.display = hasResults || this.errors.length ? 'inline-block' : 'none';
        if (focusId) list.querySelector(`[data-result-id="${focusId}"] ${focusTarget === 'restore' ? '.restore-small input' : 'select'}`)?.focus();
    }

    downloadFile(id) {
        const result = this.completedFiles.get(id); if (!result) return;
        const url = URL.createObjectURL(result.cbzBlob); const link = document.createElement('a'); link.href = url; link.download = result.outputName; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.setBatchStatus(`Download started: ${result.outputName}.`);
    }

    async downloadAllFiles() {
        if (!this.completedFiles.size) return;
        await this.runOperation('export', async () => {
            const entries = [...this.completedFiles.values()].map(result => ({ name: result.outputName, data: result.cbzBlob })); let blob;
            try { ({ blob } = await this.postToWorker('createOuterZip', { entries, store: true })); }
            catch (_) { const zip = new JSZip(); entries.forEach(entry => zip.file(entry.name, entry.data)); blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }); }
            const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `comic_collection_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}.zip`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.setBatchStatus('Download started: comic collection ZIP.');
        });
    }

    async saveAllToFolder() {
        if (!window.showDirectoryPicker || !this.completedFiles.size) return;
        await this.runOperation('save', async () => {
            let directory;
            try { directory = await window.showDirectoryPicker({ mode: 'readwrite' }); }
            catch (error) { if (error.name === 'AbortError') return this.setBatchStatus('Folder save cancelled.'); throw error; }
            const names = new Set(); const savedNames = []; let saved = 0;
            try {
            for await (const name of directory.keys()) names.add(this.fileKey(name));
                for (const result of this.completedFiles.values()) {
                    let name = result.outputName; let suffix = 0; const base = name.replace(/\.cbz$/i, '');
                    while (names.has(this.fileKey(name))) name = `${base} (${++suffix}).cbz`;
                    let writable;
                    try { writable = await (await directory.getFileHandle(name, { create: true })).createWritable(); await writable.write(result.cbzBlob); await writable.close(); names.add(this.fileKey(name)); savedNames.push(name); saved++; }
                    catch (error) { try { await writable?.abort(); } catch (_) {} throw new Error(`${name}: ${error.message || error}`); }
                }
                this.setBatchStatus(`Saved ${saved} CBZ file${saved === 1 ? '' : 's'} to the selected folder.`);
            } catch (error) { this.setBatchStatus(`Saved ${saved} CBZ file${saved === 1 ? '' : 's'} (${savedNames.join(', ') || 'none'}) before save stopped: ${this.securityUtils.sanitizeErrorMessage(error)}`); }
        });
    }

    clearResults() {
        if (this.activeOperation || !this.completedFiles.size && !this.errors.length) return;
        if (!window.confirm('Clear results? This discards retained downloads from this browser session.')) return;
        for (const result of this.completedFiles.values()) URL.revokeObjectURL(result.previewUrl);
        this.completedFiles.clear(); this.errors = []; this.retainedBytes = 0;
        document.getElementById('fileList').replaceChildren(); document.getElementById('downloadList').replaceChildren(); document.getElementById('errorList').replaceChildren();
        document.getElementById('resultsSection').style.display = 'none'; document.getElementById('errorSection').style.display = 'none'; document.getElementById('clearBtn').style.display = 'none'; this.setBatchStatus('Results cleared.');
    }

    async runOperation(name, action) {
        if (this.activeOperation) return this.setBatchStatus(`Cannot start ${name} while another operation is running.`);
        const focused = document.activeElement;
        this.activeOperation = true; this.setBusy(true);
        try { await action(); } catch (error) { this.showError('Conversion error', this.securityUtils.sanitizeErrorMessage(error)); }
        finally { this.activeOperation = false; this.setBusy(false); if (focused?.isConnected && !focused.disabled) focused.focus(); }
    }
    setBusy(busy) { document.querySelectorAll('#fileInput,#folderInput,#browseBtn,#browseFolderBtn,#clearBtn,#downloadAllBtn,#saveAllBtn,select,.restore-small input').forEach(control => { control.disabled = busy; }); }
    setBatchStatus(message) { const status = document.getElementById('batchStatus'); if (status) status.textContent = `${message}${this.pendingFileNames.length ? ` Remaining unconverted files: ${this.pendingFileNames.join(', ')}.` : ''}`; }
    setCapStatus(jobs, index, completed, attempted) { this.pendingFileNames = jobs.slice(index).map(job => job.file.name); this.setBatchStatus(`Attempted ${attempted} of ${jobs.length}; converted ${completed}. Save completed files, then clear results to free space.`); }
    showError(title, message) { this.errors.push({ fileName: title, error: message }); this.showErrors(); }
    showErrors() { const section = document.getElementById('errorSection'); const list = document.getElementById('errorList'); list.replaceChildren(...this.errors.map(error => { const item = this.securityUtils.createSafeElement('div', '', 'error-item'); item.append(this.securityUtils.createSafeElement('h4', error.fileName), this.securityUtils.createSafeElement('p', error.error)); return item; })); section.style.display = 'block'; document.getElementById('clearBtn').style.display = 'inline-block'; }
    formatFileSize(bytes) { return this.securityUtils.formatFileSize(bytes); }
    initializeTheme() { const theme = this.securityUtils.safeLocalStorageGet('comic-converter-theme') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); this.setTheme(theme, false); }
    toggleTheme() { this.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }
    setTheme(theme, save = true) { document.documentElement.dataset.theme = theme; if (save) this.securityUtils.safeLocalStorageSet('comic-converter-theme', theme); const icon = document.querySelector('.theme-icon'); if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙'; }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new ComicConverter(); });
