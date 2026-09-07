/* Extract the image resources of an AZW3/MOBI container. */
class AZW3Parser {
    constructor() { this.securityUtils = new SecurityUtils(); }

    async parseFile(buffer) {
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 78) throw new Error('File too small to be a valid AZW3 file');
        this.securityUtils.trackMemoryUsage(buffer.byteLength, 'add');
        try {
            this.securityUtils.validateFileSignature(buffer, 'azw3');
            const view = new DataView(buffer);
            const palm = this.parsePalmHeader(view);
            const mobi = this.parseMobiHeader(view, palm);
            const exth = this.parseExth(view, mobi);
            if (this.isHybrid(new Uint8Array(buffer), palm, exth)) throw new Error('Hybrid MOBI6/KF8 containers are not supported');
            const metadata = this.extractMetadata(view, palm, mobi, exth);
            const images = this.extractImages(new Uint8Array(buffer), palm, mobi);
            return { images, metadata, imageWarnings: images.map(image => image.warning).filter(Boolean), pageCount: images.length, warning: 'Images use resource order; logical reading order is not verified.' };
        } catch (error) {
            throw new Error(`Failed to parse AZW3 file: ${error.message}`);
        } finally {
            this.securityUtils.trackMemoryUsage(buffer.byteLength, 'remove');
        }
    }

    parsePalmHeader(view) {
        const recordCount = view.getUint16(76, false);
        const directoryEnd = 78 + recordCount * 8;
        if (!recordCount || directoryEnd > view.byteLength) throw new Error('Invalid Palm record directory');
        const type = this.readAscii(view, 60, 4);
        const creator = this.readAscii(view, 64, 4);
        if (!['BOOK', 'MOBI', 'TEXT', 'AZW3'].includes(type) && !['MOBI', 'BOOK', 'AZW3'].includes(creator)) throw new Error('Invalid AZW3 file format');
        const records = [];
        let previous = directoryEnd - 1;
        for (let index = 0; index < recordCount; index++) {
            const offset = view.getUint32(78 + index * 8, false);
            if (offset < directoryEnd || offset <= previous || offset >= view.byteLength) throw new Error('Invalid or overlapping Palm record offsets');
            records.push({
                offset,
                attributes: view.getUint8(82 + index * 8),
                uniqueId: (view.getUint8(83 + index * 8) << 16) | (view.getUint8(84 + index * 8) << 8) | view.getUint8(85 + index * 8)
            });
            previous = offset;
        }
        for (let index = 0; index < records.length; index++) records[index].end = records[index + 1]?.offset || view.byteLength;
        return { type, creator, records, recordCount };
    }

    parseMobiHeader(view, palm) {
        const first = palm.records[0];
        const offset = first.offset + 16;
        if (offset + 116 > first.end || this.readAscii(view, offset, 4) !== 'MOBI') throw new Error('MOBI header not found or truncated');
        const headerLength = view.getUint32(offset + 4, false);
        if (headerLength < 116 || offset + headerLength > first.end) throw new Error('Invalid MOBI header length');
        const firstImageIndex = view.getUint32(offset + 92, false);
        if (firstImageIndex !== 0xffffffff && (firstImageIndex < 1 || firstImageIndex >= palm.records.length)) throw new Error('Invalid first image record index');
        return {
            offset, recordOffset: first.offset, recordEnd: first.end, headerLength,
            textEncoding: view.getUint32(offset + 12, false),
            hasExth: (view.getUint32(offset + 112, false) & 0x40) !== 0,
            firstImageIndex, titleOffset: view.getUint32(offset + 68, false), titleLength: view.getUint32(offset + 72, false)
        };
    }

    parseExth(view, mobi) {
        if (!mobi.hasExth) return new Map();
        const start = mobi.offset + mobi.headerLength;
        if (start + 12 > mobi.recordEnd || this.readAscii(view, start, 4) !== 'EXTH') throw new Error('Malformed EXTH header');
        const length = view.getUint32(start + 4, false);
        const count = view.getUint32(start + 8, false);
        const end = start + length;
        if (length < 12 || end > mobi.recordEnd || count > Math.floor((length - 12) / 8)) throw new Error('Malformed EXTH bounds');
        const fields = new Map();
        let offset = start + 12;
        for (let index = 0; index < count; index++) {
            if (offset + 8 > end) throw new Error('Malformed EXTH record');
            const type = view.getUint32(offset, false);
            const recordLength = view.getUint32(offset + 4, false);
            if (recordLength < 8 || offset + recordLength > end) throw new Error('Malformed EXTH record length');
            if ([121, 201, 202].includes(type) && recordLength !== 12) throw new Error('Malformed EXTH numeric record');
            const values = fields.get(type) || [];
            values.push(new Uint8Array(view.buffer, view.byteOffset + offset + 8, recordLength - 8));
            fields.set(type, values);
            offset += recordLength;
        }
        return fields;
    }

    isHybrid(bytes, palm, exth) {
        if (palm.records.slice(1).some(record => record.end - record.offset >= 8 && this.readBytes(bytes, record.offset, 8) === 'BOUNDARY')) return true;
        return exth.get(121)?.some(value => this.isKf8Record(bytes, palm.records[this.numberValue(value)])) || false;
    }

    isKf8Record(bytes, record) {
        if (!record || record.end - record.offset < 140) return false;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const offset = record.offset + 16;
        if (this.readBytes(bytes, offset, 4) !== 'MOBI') return false;
        const headerLength = view.getUint32(offset + 4, false);
        const version = view.getUint32(offset + 20, false);
        return headerLength >= 116 && offset + headerLength <= record.end && version >= 8;
    }

    extractImages(bytes, palm, mobi) {
        if (mobi.firstImageIndex === 0xffffffff) return [];
        const images = [];
        for (let recordIndex = mobi.firstImageIndex; recordIndex < palm.records.length; recordIndex++) {
            const record = palm.records[recordIndex];
            const data = bytes.subarray(record.offset, record.end);
            const info = this.identifyImage(data);
            if (info) images.push({ ...info, warning: info.warning ? `Image resource ${recordIndex} has an unreadable dimensions header.` : '', data, recordIndex, filename: '' });
        }
        return images;
    }

    extractMetadata(view, palm, mobi, exth) {
        const text = type => (exth.get(type) || []).map(value => this.decode(value, mobi.textEncoding).trim()).filter(Boolean);
        const number = type => exth.get(type)?.[0] ? this.numberValue(exth.get(type)[0]) : null;
        let title = text(503)[0] || '';
        if (!title && mobi.titleLength && mobi.titleOffset + mobi.titleLength <= mobi.recordEnd - mobi.recordOffset) {
            title = this.decode(new Uint8Array(view.buffer, view.byteOffset + mobi.recordOffset + mobi.titleOffset, mobi.titleLength), mobi.textEncoding).trim();
        }
        const author = text(100).join(', ');
        const metadata = {
            title, author, creator: author, publisher: text(101)[0] || '', description: text(103)[0] || '',
            date: text(106)[0] || '', language: text(524)[0] || '',
            coverRecordIndex: this.resourceRecord(mobi.firstImageIndex, number(201), palm.records.length),
            thumbnailRecordIndex: this.resourceRecord(mobi.firstImageIndex, number(202), palm.records.length), series: '', seriesIndex: ''
        };
        const series = title.match(/^(.*?)\s+#\s*(\d+(?:\.\d+)?)(?:\s*\([^)]*\))?$/);
        if (series) { metadata.series = series[1].trim(); metadata.seriesIndex = series[2]; }
        return metadata;
    }

    resourceRecord(firstImageIndex, relativeIndex, length) {
        if (firstImageIndex === 0xffffffff || relativeIndex === null || relativeIndex === 0xffffffff) return null;
        const recordIndex = firstImageIndex + relativeIndex;
        return recordIndex >= firstImageIndex && recordIndex < length ? recordIndex : null;
    }

    buildSelection(images, metadata, options = {}) {
        // ponytail: resource order is the available ceiling; add a spine decoder only when image order proves insufficient.
        const hasLargeImage = images.some(image => image.width > 0 && image.height > 0 && (image.width > 64 || image.height > 64));
        // ponytail: omit <=64px ancillary resources only beside larger pages; add per-format classification if this heuristic proves wrong.
        const eligible = image => options.includeSmall || (image.recordIndex !== metadata.thumbnailRecordIndex && (!hasLargeImage || !this.isTiny(image)));
        const pool = images.filter(eligible);
        const usable = pool.length ? pool : images;
        const requested = images.find(image => image.recordIndex === options.coverRecordIndex);
        const automatic = usable.find(image => image.recordIndex === metadata.coverRecordIndex);
        const cover = requested || automatic || usable[0] || null;
        const output = cover && !usable.includes(cover) ? [cover, ...usable] : cover ? [cover, ...usable.filter(image => image !== cover)] : [];
        return this.nameSelectedImages(output);
    }

    nameSelectedImages(images) {
        const width = Math.max(4, String(images.length).length);
        return images.map((image, index) => ({ ...image, filename: `page_${String(index + 1).padStart(width, '0')}.${image.extension}` }));
    }

    isTiny(image) { return image.width > 0 && image.height > 0 && image.width <= 64 && image.height <= 64; }

    identifyImage(data) {
        if (data.length < 10) return null;
        if (data[0] === 0xff && data[1] === 0xd8) {
            const dimensions = this.getJpegDimensions(data);
            return dimensions ? { format: 'JPEG', extension: 'jpg', ...dimensions } : { format: 'JPEG', extension: 'jpg', width: 0, height: 0, warning: true };
        }
        if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength); const width = view.getUint32(16, false); const height = view.getUint32(20, false);
            return width && height ? { format: 'PNG', extension: 'png', width, height } : { format: 'PNG', extension: 'png', width: 0, height: 0, warning: true };
        }
        if (data.length >= 10 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength); const width = view.getUint16(6, true); const height = view.getUint16(8, true);
            return width && height ? { format: 'GIF', extension: 'gif', width, height } : { format: 'GIF', extension: 'gif', width: 0, height: 0, warning: true };
        }
        return null;
    }

    getJpegDimensions(data) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength); let offset = 2;
        while (offset + 9 < data.length) {
            if (view.getUint8(offset) !== 0xff) return null;
            while (offset < data.length && view.getUint8(offset) === 0xff) offset++;
            if (offset >= data.length) return null;
            const marker = view.getUint8(offset++);
            if (marker === 0xd9 || marker === 0xda || offset + 2 > data.length) return null;
            const length = view.getUint16(offset, false);
            if (length < 2 || offset + length > data.length) return null;
            if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
                const height = view.getUint16(offset + 3, false); const width = view.getUint16(offset + 5, false);
                return width && height ? { width, height } : null;
            }
            offset += length;
        }
        return null;
    }

    decode(bytes, encoding) { return new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8').decode(bytes); }
    numberValue(value) {
        if (value.length === 4) return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, false);
        const parsed = Number.parseInt(new TextDecoder('ascii').decode(value), 10);
        return Number.isInteger(parsed) ? parsed : 0;
    }
    readAscii(view, offset, length) {
        if (offset < 0 || offset + length > view.byteLength) throw new Error('Unexpected end of file');
        let value = ''; for (let index = 0; index < length; index++) value += String.fromCharCode(view.getUint8(offset + index));
        return value;
    }
    readBytes(bytes, offset, length) { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
}

window.AZW3Parser = AZW3Parser;
