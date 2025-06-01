/**
 * OPF (Open Packaging Format) Parser
 * Handles parsing of metadata.opf files for enhanced comic book metadata
 */

class OPFParser {
    constructor() {
        this.parser = new DOMParser();
    }

    /**
     * Parse an OPF file and extract metadata
     * @param {string} opfContent - The OPF file content as string
     * @returns {Object} - Parsed metadata
     */
    parseOPF(opfContent) {
        try {
            const doc = this.parser.parseFromString(opfContent, 'text/xml');
            
            // Check for parsing errors
            const parserError = doc.querySelector('parsererror');
            if (parserError) {
                throw new Error('Invalid OPF XML format');
            }

            const metadata = this.extractMetadata(doc);
            const manifest = this.extractManifest(doc);
            const spine = this.extractSpine(doc);

            return {
                metadata,
                manifest,
                spine,
                isValid: true
            };
        } catch (error) {
            console.warn('Failed to parse OPF file:', error);
            return {
                metadata: this.getDefaultMetadata(),
                manifest: {},
                spine: [],
                isValid: false,
                error: error.message
            };
        }
    }

    /**
     * Extract metadata from OPF document
     */
    extractMetadata(doc) {
        const metadata = this.getDefaultMetadata();

        try {
            // Find metadata element
            const metadataElement = doc.querySelector('metadata');
            if (!metadataElement) {
                return metadata;
            }

            // Extract Dublin Core metadata
            metadata.title = this.getTextContent(metadataElement, 'dc\\:title, title') || metadata.title;
            metadata.creator = this.getTextContent(metadataElement, 'dc\\:creator, creator') || metadata.creator;
            metadata.publisher = this.getTextContent(metadataElement, 'dc\\:publisher, publisher') || metadata.publisher;
            metadata.description = this.getTextContent(metadataElement, 'dc\\:description, description') || metadata.description;
            metadata.language = this.getTextContent(metadataElement, 'dc\\:language, language') || metadata.language;
            metadata.identifier = this.getTextContent(metadataElement, 'dc\\:identifier, identifier') || metadata.identifier;
            metadata.date = this.getTextContent(metadataElement, 'dc\\:date, date') || metadata.date;
            metadata.rights = this.getTextContent(metadataElement, 'dc\\:rights, rights') || metadata.rights;

            // Extract additional metadata
            metadata.series = this.getTextContent(metadataElement, 'meta[name="calibre:series"], meta[property="belongs-to-collection"]') || metadata.series;
            metadata.seriesIndex = this.getTextContent(metadataElement, 'meta[name="calibre:series_index"]') || metadata.seriesIndex;
            metadata.genre = this.getTextContent(metadataElement, 'dc\\:subject, subject') || metadata.genre;
            
            // Try to get cover reference
            const coverMeta = metadataElement.querySelector('meta[name="cover"]');
            if (coverMeta) {
                metadata.coverRef = coverMeta.getAttribute('content');
            }

            // Extract custom metadata
            const customMeta = metadataElement.querySelectorAll('meta[name^="calibre:"], meta[property]');
            customMeta.forEach(meta => {
                const name = meta.getAttribute('name') || meta.getAttribute('property');
                const content = meta.getAttribute('content') || meta.textContent;
                if (name && content) {
                    metadata.custom = metadata.custom || {};
                    metadata.custom[name] = content;
                }
            });

        } catch (error) {
            console.warn('Error extracting metadata:', error);
        }

        return metadata;
    }

    /**
     * Extract manifest from OPF document
     */
    extractManifest(doc) {
        const manifest = {};

        try {
            const manifestElement = doc.querySelector('manifest');
            if (!manifestElement) {
                return manifest;
            }

            const items = manifestElement.querySelectorAll('item');
            items.forEach(item => {
                const id = item.getAttribute('id');
                const href = item.getAttribute('href');
                const mediaType = item.getAttribute('media-type');
                const properties = item.getAttribute('properties');

                if (id && href) {
                    manifest[id] = {
                        href,
                        mediaType,
                        properties: properties ? properties.split(' ') : []
                    };
                }
            });
        } catch (error) {
            console.warn('Error extracting manifest:', error);
        }

        return manifest;
    }

    /**
     * Extract spine from OPF document
     */
    extractSpine(doc) {
        const spine = [];

        try {
            const spineElement = doc.querySelector('spine');
            if (!spineElement) {
                return spine;
            }

            const itemrefs = spineElement.querySelectorAll('itemref');
            itemrefs.forEach((itemref, index) => {
                const idref = itemref.getAttribute('idref');
                const linear = itemref.getAttribute('linear') !== 'no';
                
                if (idref) {
                    spine.push({
                        idref,
                        linear,
                        order: index
                    });
                }
            });
        } catch (error) {
            console.warn('Error extracting spine:', error);
        }

        return spine;
    }

    /**
     * Get text content from element using CSS selector
     */
    getTextContent(parent, selector) {
        try {
            const element = parent.querySelector(selector);
            return element ? element.textContent.trim() : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get default metadata structure
     */
    getDefaultMetadata() {
        return {
            title: 'Unknown Comic',
            creator: 'Unknown Author',
            publisher: 'Unknown Publisher',
            description: '',
            language: 'en',
            identifier: '',
            date: '',
            rights: '',
            series: '',
            seriesIndex: '',
            genre: '',
            coverRef: null,
            custom: {}
        };
    }

    /**
     * Generate ComicInfo.xml content for CBZ
     * This is the standard metadata format for comic book archives
     */
    generateComicInfo(metadata, pageCount = 0) {
        const escapeXml = (str) => {
            if (!str) return '';
            return str.replace(/[<>&'"]/g, (char) => {
                switch (char) {
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '&': return '&amp;';
                    case "'": return '&apos;';
                    case '"': return '&quot;';
                    default: return char;
                }
            });
        };

        const comicInfo = `<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
           xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <Title>${escapeXml(metadata.title)}</Title>
    <Writer>${escapeXml(metadata.creator)}</Writer>
    <Publisher>${escapeXml(metadata.publisher)}</Publisher>
    <Summary>${escapeXml(metadata.description)}</Summary>
    <LanguageISO>${escapeXml(metadata.language)}</LanguageISO>
    <Genre>${escapeXml(metadata.genre)}</Genre>
    <Series>${escapeXml(metadata.series)}</Series>
    <Number>${escapeXml(metadata.seriesIndex)}</Number>
    <PageCount>${pageCount}</PageCount>
    <Year>${metadata.date ? new Date(metadata.date).getFullYear() : ''}</Year>
    <Month>${metadata.date ? new Date(metadata.date).getMonth() + 1 : ''}</Month>
    <Day>${metadata.date ? new Date(metadata.date).getDate() : ''}</Day>
    <Web>${escapeXml(metadata.identifier)}</Web>
    <Format>Digital</Format>
    <AgeRating>Unknown</AgeRating>
    <BlackAndWhite>Unknown</BlackAndWhite>
    <Manga>Unknown</Manga>
    <Characters></Characters>
    <Teams></Teams>
    <Locations></Locations>
    <ScanInformation>Converted from AZW3</ScanInformation>
    <StoryArc></StoryArc>
    <SeriesGroup></SeriesGroup>
    <AlternateSeries></AlternateSeries>
    <AlternateNumber></AlternateNumber>
    <AlternateCount></AlternateCount>
    <Notes>Converted using Comic Converter</Notes>
</ComicInfo>`;

        return comicInfo;
    }

    /**
     * Parse a simple metadata.json file as fallback
     */
    parseJSON(jsonContent) {
        try {
            const data = JSON.parse(jsonContent);
            const metadata = this.getDefaultMetadata();
            
            // Map common JSON fields to our metadata structure
            if (data.title) metadata.title = data.title;
            if (data.author || data.creator) metadata.creator = data.author || data.creator;
            if (data.publisher) metadata.publisher = data.publisher;
            if (data.description || data.summary) metadata.description = data.description || data.summary;
            if (data.language) metadata.language = data.language;
            if (data.series) metadata.series = data.series;
            if (data.seriesIndex || data.volume) metadata.seriesIndex = data.seriesIndex || data.volume;
            if (data.genre || data.tags) metadata.genre = Array.isArray(data.genre) ? data.genre.join(', ') : (data.genre || data.tags);
            if (data.date || data.publishDate) metadata.date = data.date || data.publishDate;

            return {
                metadata,
                isValid: true
            };
        } catch (error) {
            return {
                metadata: this.getDefaultMetadata(),
                isValid: false,
                error: error.message
            };
        }
    }
}

// Export for use in other modules
window.OPFParser = OPFParser;