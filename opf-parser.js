/* Read the small, optional OPF metadata sidecar without replacing usable MOBI fields. */
class OPFParser {
    constructor() { this.parser = new DOMParser(); this.securityUtils = new SecurityUtils(); }

    parseOPF(content) {
        try {
            if (typeof content !== 'string' || content.length > 1024 * 1024) throw new Error('OPF file is invalid or exceeds 1 MiB');
            this.securityUtils.validateXmlContent(content);
            const document = this.parser.parseFromString(content, 'text/xml');
            if (document.querySelector('parsererror')) throw new Error('Invalid OPF XML format');
            return { metadata: this.extractMetadata(document), isValid: true };
        } catch (error) {
            return { metadata: {}, isValid: false, error: error.message };
        }
    }

    extractMetadata(document) {
        const metadata = {};
        const values = {};
        for (const element of document.getElementsByTagName('*')) {
            const name = element.localName;
            const value = (element.textContent || '').trim();
            if (value && !values[name]) values[name] = value;
            if (name === 'meta') {
                const key = element.getAttribute('name') || element.getAttribute('property');
                const metaValue = (element.getAttribute('content') || value).trim();
                if (key === 'calibre:series' && metaValue) metadata.series = metaValue;
                if (key === 'calibre:series_index' && metaValue) metadata.seriesIndex = metaValue;
            }
        }
        const mapping = { title: 'title', creator: 'creator', publisher: 'publisher', description: 'description', language: 'language', date: 'date', identifier: 'identifier', subject: 'genre' };
        for (const [source, target] of Object.entries(mapping)) if (values[source]) metadata[target] = values[source];
        return metadata;
    }

    mergeMetadata(embedded, supplied) {
        const merged = { ...embedded };
        for (const [key, value] of Object.entries(supplied || {})) if (typeof value === 'string' && value.trim()) merged[key] = value.trim();
        if (supplied?.creator?.trim()) merged.author = supplied.creator.trim();
        if (supplied?.author?.trim()) merged.creator = supplied.author.trim();
        return merged;
    }

    generateComicInfo(metadata = {}, pageCount = 0) {
        const escape = value => String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
        const text = (name, value) => value ? `<${name}>${escape(value)}</${name}>` : '';
        const date = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]+)?)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])?)?$/.exec(metadata.date || '');
        const validDate = date && (() => { const check = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]))); return check.getUTCFullYear() === Number(date[1]) && check.getUTCMonth() === Number(date[2]) - 1 && check.getUTCDate() === Number(date[3]); })();
        const dateFields = validDate ? `<Year>${date[1]}</Year><Month>${Number(date[2])}</Month><Day>${Number(date[3])}</Day>` : '';
        return `<?xml version="1.0" encoding="UTF-8"?>\n<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><Title>${escape(metadata.title)}</Title>${text('Series', metadata.series)}${text('Number', metadata.seriesIndex)}${text('Summary', metadata.description)}${dateFields}${text('Writer', metadata.creator || metadata.author)}${text('Publisher', metadata.publisher)}${text('Genre', metadata.genre)}${text('Web', metadata.identifier)}<PageCount>${pageCount}</PageCount>${text('LanguageISO', metadata.language)}<Format>Digital</Format><Pages><Page Image="0" Type="FrontCover"/></Pages></ComicInfo>`;
    }
}

window.OPFParser = OPFParser;
