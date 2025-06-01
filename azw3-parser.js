/**
 * AZW3 Parser for Comic Book Files
 * Handles parsing of Amazon's AZW3 format to extract embedded images
 */

class AZW3Parser {
    constructor() {
        this.textDecoder = new TextDecoder('utf-8');
    }

    /**
     * Parse an AZW3 file and extract images
     * @param {ArrayBuffer} buffer - The AZW3 file buffer
     * @returns {Promise<Object>} - Parsed data with images and metadata
     */
    async parseFile(buffer) {
        try {
            const dataView = new DataView(buffer);
            const uint8Array = new Uint8Array(buffer);
            
            // Check if this is a valid Mobipocket/AZW3 file
            const palmHeader = this.parsePalmHeader(dataView);
            if (!palmHeader.isValid) {
                throw new Error('Invalid AZW3 file format');
            }

            // Find and parse MOBI header
            const mobiHeader = this.parseMobiHeader(dataView, palmHeader);
            
            // Extract images from the file
            const images = await this.extractImages(uint8Array, palmHeader, mobiHeader);
            
            // Extract metadata
            const metadata = this.extractMetadata(dataView, mobiHeader);
            
            return {
                images,
                metadata,
                pageCount: images.length
            };
        } catch (error) {
            throw new Error(`Failed to parse AZW3 file: ${error.message}`);
        }
    }

    /**
     * Parse the Palm Database Header
     */
    parsePalmHeader(dataView) {
        try {
            // Palm database header is 78 bytes
            const name = this.readString(dataView, 0, 32);
            const type = this.readString(dataView, 60, 4);
            const creator = this.readString(dataView, 64, 4);
            const recordCount = dataView.getUint16(76, false); // big-endian
            
            // Check for MOBI/BOOK type
            const isValid = (type === 'BOOK' || type === 'MOBI') && recordCount > 0;
            
            // Parse record info list
            const records = [];
            let offset = 78;
            
            for (let i = 0; i < recordCount; i++) {
                const recordOffset = dataView.getUint32(offset, false);
                const attributes = dataView.getUint8(offset + 4);
                const uniqueId = dataView.getUint32(offset + 5, false) & 0xFFFFFF;
                
                records.push({
                    offset: recordOffset,
                    attributes,
                    uniqueId
                });
                
                offset += 8;
            }
            
            return {
                isValid,
                name: name.replace(/\0/g, ''),
                type,
                creator,
                recordCount,
                records
            };
        } catch (error) {
            return { isValid: false };
        }
    }

    /**
     * Parse the MOBI header
     */
    parseMobiHeader(dataView, palmHeader) {
        try {
            const firstRecordOffset = palmHeader.records[0].offset;
            
            // Skip PalmDOC header (16 bytes) to get to MOBI header
            const mobiOffset = firstRecordOffset + 16;
            
            // Check MOBI identifier
            const mobiId = this.readString(dataView, mobiOffset, 4);
            if (mobiId !== 'MOBI') {
                throw new Error('MOBI header not found');
            }
            
            const headerLength = dataView.getUint32(mobiOffset + 4, false);
            const mobiType = dataView.getUint32(mobiOffset + 8, false);
            const textEncoding = dataView.getUint32(mobiOffset + 12, false);
            
            // Get EXTH header info
            const exthFlag = dataView.getUint32(mobiOffset + 128, false);
            const hasExth = (exthFlag & 0x40) !== 0;
            
            // Find first image record
            let firstImageIndex = 0;
            if (headerLength >= 108) {
                firstImageIndex = dataView.getUint32(mobiOffset + 108, false);
            }
            
            return {
                offset: mobiOffset,
                headerLength,
                mobiType,
                textEncoding,
                hasExth,
                firstImageIndex
            };
        } catch (error) {
            throw new Error(`Failed to parse MOBI header: ${error.message}`);
        }
    }

    /**
     * Extract images from the AZW3 file
     */
    async extractImages(uint8Array, palmHeader, mobiHeader) {
        const images = [];
        
        try {
            // Start looking for images from the first image record
            const startIndex = Math.max(1, mobiHeader.firstImageIndex);
            
            for (let i = startIndex; i < palmHeader.records.length; i++) {
                const record = palmHeader.records[i];
                const nextRecord = palmHeader.records[i + 1];
                
                // Calculate record size
                const recordSize = nextRecord ? 
                    nextRecord.offset - record.offset : 
                    uint8Array.length - record.offset;
                
                if (recordSize < 10) continue; // Too small to be an image
                
                // Extract record data
                const recordData = uint8Array.slice(record.offset, record.offset + recordSize);
                
                // Check if this looks like an image
                const imageInfo = this.identifyImage(recordData);
                if (imageInfo) {
                    images.push({
                        data: recordData,
                        format: imageInfo.format,
                        width: imageInfo.width,
                        height: imageInfo.height,
                        index: i - startIndex,
                        filename: `page_${String(i - startIndex + 1).padStart(3, '0')}.${imageInfo.extension}`
                    });
                }
            }
            
            // Sort images by index to maintain reading order
            images.sort((a, b) => a.index - b.index);
            
            return images;
        } catch (error) {
            throw new Error(`Failed to extract images: ${error.message}`);
        }
    }

    /**
     * Identify image format and extract basic info
     */
    identifyImage(data) {
        if (data.length < 10) return null;
        
        // Check for JPEG
        if (data[0] === 0xFF && data[1] === 0xD8) {
            return {
                format: 'JPEG',
                extension: 'jpg',
                width: this.getJpegDimensions(data)?.width || 0,
                height: this.getJpegDimensions(data)?.height || 0
            };
        }
        
        // Check for PNG
        if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
            return {
                format: 'PNG',
                extension: 'png',
                width: this.getPngDimensions(data)?.width || 0,
                height: this.getPngDimensions(data)?.height || 0
            };
        }
        
        // Check for GIF
        if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
            return {
                format: 'GIF',
                extension: 'gif',
                width: this.getGifDimensions(data)?.width || 0,
                height: this.getGifDimensions(data)?.height || 0
            };
        }
        
        return null;
    }

    /**
     * Get JPEG dimensions
     */
    getJpegDimensions(data) {
        try {
            const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
            let offset = 2;
            
            while (offset < data.length - 4) {
                const marker = dataView.getUint16(offset, false);
                
                if (marker === 0xFFC0 || marker === 0xFFC2) { // SOF0 or SOF2
                    const height = dataView.getUint16(offset + 5, false);
                    const width = dataView.getUint16(offset + 7, false);
                    return { width, height };
                }
                
                const segmentLength = dataView.getUint16(offset + 2, false);
                offset += 2 + segmentLength;
            }
        } catch (error) {
            // Ignore errors, return null
        }
        return null;
    }

    /**
     * Get PNG dimensions
     */
    getPngDimensions(data) {
        try {
            if (data.length < 24) return null;
            const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const width = dataView.getUint32(16, false);
            const height = dataView.getUint32(20, false);
            return { width, height };
        } catch (error) {
            return null;
        }
    }

    /**
     * Get GIF dimensions
     */
    getGifDimensions(data) {
        try {
            if (data.length < 10) return null;
            const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const width = dataView.getUint16(6, true); // little-endian
            const height = dataView.getUint16(8, true);
            return { width, height };
        } catch (error) {
            return null;
        }
    }

    /**
     * Extract metadata from the file
     */
    extractMetadata(dataView, mobiHeader) {
        const metadata = {
            title: 'Unknown Comic',
            author: 'Unknown Author',
            publisher: 'Unknown Publisher'
        };
        
        try {
            // Try to extract title from MOBI header
            // This is a simplified extraction - full EXTH parsing would be more complex
            if (mobiHeader.hasExth) {
                // EXTH header parsing would go here
                // For now, we'll use basic defaults
            }
        } catch (error) {
            // Use defaults if extraction fails
        }
        
        return metadata;
    }

    /**
     * Helper function to read string from DataView
     */
    readString(dataView, offset, length) {
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            bytes[i] = dataView.getUint8(offset + i);
        }
        return this.textDecoder.decode(bytes);
    }
}

// Export for use in other modules
window.AZW3Parser = AZW3Parser;