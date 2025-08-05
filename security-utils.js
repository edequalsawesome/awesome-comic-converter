/**
 * Security Utilities Module
 * Centralized security functions for the Comic Converter application
 */

class SecurityUtils {
    constructor() {
        // File size limits (in bytes)
        this.MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
        this.MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024; // 2GB total
        this.MAX_FILES_PER_BATCH = 50;
        
        // Memory usage tracking
        this.currentMemoryUsage = 0;
        this.MAX_MEMORY_USAGE = 1024 * 1024 * 1024; // 1GB
        
        // Rate limiting
        this.processingQueue = [];
        this.maxConcurrentProcessing = 3;
        this.currentProcessing = 0;
        
        // Valid file signatures
        this.validFileSignatures = {
            azw3: [
                [0x54, 0x50, 0x5A, 0x33], // TPZ3
                [0x42, 0x4F, 0x4F, 0x4B], // BOOK
                [0x4D, 0x4F, 0x42, 0x49], // MOBI
                // Additional AZW3/Palm database signatures
                [0x54, 0x45, 0x58, 0x54], // TEXT (Palm text)
                [0x41, 0x5A, 0x57, 0x33], // AZW3 (literal)
                [0x41, 0x5A, 0x57, 0x31], // AZW1
                [0x41, 0x5A, 0x57, 0x52], // AZWR
                [0x54, 0x50, 0x5A, 0x30]  // TPZ0
            ],
            jpg: [[0xFF, 0xD8, 0xFF]],
            png: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
            gif: [[0x47, 0x49, 0x46, 0x38]]
        };
    }

    /**
     * Sanitize HTML content to prevent XSS
     */
    sanitizeHtml(input) {
        if (typeof input !== 'string') {
            return '';
        }
        
        // Create a temporary element to leverage browser's built-in escaping
        const temp = document.createElement('div');
        temp.textContent = input;
        return temp.innerHTML;
    }

    /**
     * Sanitize error messages for user display
     */
    sanitizeErrorMessage(error) {
        if (!error) return 'An unknown error occurred';
        
        const message = typeof error === 'string' ? error : error.message || 'An error occurred';
        
        // Remove potentially sensitive information
        const sanitized = message
            .replace(/file:\/\/[^\s]*/gi, '[file path]')
            .replace(/https?:\/\/[^\s]*/gi, '[url]')
            .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip address]')
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
            .substring(0, 200); // Limit length
        
        return this.sanitizeHtml(sanitized);
    }

    /**
     * Validate file size
     */
    validateFileSize(file) {
        if (!file || typeof file.size !== 'number') {
            throw new Error('Invalid file object');
        }
        
        if (file.size > this.MAX_FILE_SIZE) {
            throw new Error(`File size exceeds maximum allowed size of ${this.formatFileSize(this.MAX_FILE_SIZE)}`);
        }
        
        if (file.size === 0) {
            throw new Error('File is empty');
        }
        
        return true;
    }

    /**
     * Validate total batch size
     */
    validateBatchSize(files) {
        if (!Array.isArray(files)) {
            throw new Error('Invalid files array');
        }
        
        if (files.length > this.MAX_FILES_PER_BATCH) {
            throw new Error(`Too many files. Maximum ${this.MAX_FILES_PER_BATCH} files allowed per batch`);
        }
        
        const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
        if (totalSize > this.MAX_TOTAL_SIZE) {
            throw new Error(`Total file size exceeds maximum allowed size of ${this.formatFileSize(this.MAX_TOTAL_SIZE)}`);
        }
        
        return true;
    }

    /**
     * Validate file content by checking file signature
     */
    validateFileSignature(arrayBuffer, expectedType) {
        if (!arrayBuffer || arrayBuffer.byteLength < 8) {
            throw new Error('File is too small or corrupted');
        }
        
        if (expectedType === 'azw3') {
            return this.validateAZW3Structure(arrayBuffer);
        }
        
        const uint8Array = new Uint8Array(arrayBuffer, 0, Math.min(16, arrayBuffer.byteLength));
        const signatures = this.validFileSignatures[expectedType];
        
        if (!signatures) {
            throw new Error(`Unknown file type: ${expectedType}`);
        }
        
        const isValid = signatures.some(signature => {
            if (signature.length > uint8Array.length) return false;
            return signature.every((byte, index) => uint8Array[index] === byte);
        });
        
        if (!isValid) {
            throw new Error(`Invalid ${expectedType.toUpperCase()} file signature`);
        }
        
        return true;
    }

    /**
     * Validate AZW3 file structure (more comprehensive than signature check)
     */
    validateAZW3Structure(arrayBuffer) {
        if (arrayBuffer.byteLength < 78) {
            throw new Error('File too small to be a valid AZW3 file');
        }
        
        try {
            const dataView = new DataView(arrayBuffer);
            
            // Check if it has basic Palm database structure
            // Palm header is 78 bytes, check key fields
            
            // Check database type at offset 60 (4 bytes)
            const type = String.fromCharCode(
                dataView.getUint8(60),
                dataView.getUint8(61),
                dataView.getUint8(62),
                dataView.getUint8(63)
            );
            
            // Check creator at offset 64 (4 bytes)
            const creator = String.fromCharCode(
                dataView.getUint8(64),
                dataView.getUint8(65),
                dataView.getUint8(66),
                dataView.getUint8(67)
            );
            
            // Get record count at offset 76
            const recordCount = dataView.getUint16(76, false);
            
            // Validate Palm database structure
            const isValidPalmDB = recordCount > 0 && recordCount < 65535;
            const isKnownType = ['BOOK', 'MOBI', 'TEXT', 'AZW3', 'AZW1', 'AZWR'].includes(type) ||
                              ['MOBI', 'AZW3', 'BOOK', 'TPZ3', 'TPZ0', 'TEXT'].includes(creator);
            
            if (!isValidPalmDB) {
                throw new Error('Invalid Palm database structure');
            }
            
            // If we have a valid Palm database structure, check for MOBI header in first record
            if (recordCount > 0 && arrayBuffer.byteLength > 94) { // 78 + 8 + 8 minimum
                const firstRecordOffset = dataView.getUint32(78, false);
                
                if (firstRecordOffset > 0 && firstRecordOffset < arrayBuffer.byteLength - 20) {
                    // Look for MOBI header after PalmDOC header (16 bytes)
                    const mobiOffset = firstRecordOffset + 16;
                    if (mobiOffset + 4 <= arrayBuffer.byteLength) {
                        const mobiSignature = String.fromCharCode(
                            dataView.getUint8(mobiOffset),
                            dataView.getUint8(mobiOffset + 1),
                            dataView.getUint8(mobiOffset + 2),
                            dataView.getUint8(mobiOffset + 3)
                        );
                        
                        if (mobiSignature === 'MOBI') {
                            return true; // Valid MOBI/AZW3 file
                        }
                    }
                }
            }
            
            // If no MOBI header found but has valid Palm structure and known type, allow it
            if (isKnownType) {
                return true;
            }
            
            throw new Error('Not a valid AZW3/MOBI file');
            
        } catch (error) {
            throw new Error(`Invalid AZW3 file signature: ${error.message}`);
        }
    }

    /**
     * Validate file extension
     */
    validateFileExtension(filename, allowedExtensions) {
        if (typeof filename !== 'string') {
            throw new Error('Invalid filename');
        }
        
        const extension = filename.toLowerCase().split('.').pop();
        if (!allowedExtensions.includes(extension)) {
            throw new Error(`Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`);
        }
        
        return true;
    }

    /**
     * Track memory usage
     */
    trackMemoryUsage(size, operation = 'add') {
        if (operation === 'add') {
            this.currentMemoryUsage += size;
            if (this.currentMemoryUsage > this.MAX_MEMORY_USAGE) {
                throw new Error('Memory usage limit exceeded. Please process fewer files at once');
            }
        } else if (operation === 'remove') {
            this.currentMemoryUsage = Math.max(0, this.currentMemoryUsage - size);
        }
    }

    /**
     * Safe localStorage operations
     */
    safeLocalStorageGet(key, defaultValue = null) {
        try {
            if (typeof Storage === 'undefined') {
                return defaultValue;
            }
            const value = localStorage.getItem(key);
            return value !== null ? value : defaultValue;
        } catch (error) {
            console.warn('localStorage access failed:', error);
            return defaultValue;
        }
    }

    safeLocalStorageSet(key, value) {
        try {
            if (typeof Storage === 'undefined') {
                return false;
            }
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            console.warn('localStorage write failed:', error);
            return false;
        }
    }

    /**
     * Rate limiting for processing
     */
    async addToProcessingQueue(processingFunction) {
        return new Promise((resolve, reject) => {
            this.processingQueue.push({ processingFunction, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.currentProcessing >= this.maxConcurrentProcessing || this.processingQueue.length === 0) {
            return;
        }
        
        this.currentProcessing++;
        const { processingFunction, resolve, reject } = this.processingQueue.shift();
        
        try {
            const result = await processingFunction();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.currentProcessing--;
            // Process next item in queue
            setTimeout(() => this.processQueue(), 10);
        }
    }

    /**
     * Validate XML content before parsing
     */
    validateXmlContent(xmlString) {
        if (typeof xmlString !== 'string') {
            throw new Error('XML content must be a string');
        }
        
        // Check for potentially dangerous XML constructs
        const dangerousPatterns = [
            /<!ENTITY/i,           // External entities
            /<!DOCTYPE.*\[/i,      // DOCTYPE with internal subset
            /SYSTEM\s+["'][^"']*["']/i, // System entities
            /PUBLIC\s+["'][^"']*["']/i  // Public entities
        ];
        
        for (const pattern of dangerousPatterns) {
            if (pattern.test(xmlString)) {
                throw new Error('XML content contains potentially dangerous constructs');
            }
        }
        
        // Basic XML structure validation
        if (!xmlString.trim().startsWith('<') || !xmlString.trim().endsWith('>')) {
            throw new Error('Invalid XML structure');
        }
        
        return true;
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Generate secure random ID
     */
    generateSecureId() {
        if (window.crypto && window.crypto.getRandomValues) {
            const array = new Uint32Array(2);
            window.crypto.getRandomValues(array);
            return array[0].toString(36) + array[1].toString(36);
        } else {
            // Fallback for older browsers
            return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        }
    }

    /**
     * Create safe DOM element with text content
     */
    createSafeElement(tagName, textContent = '', className = '') {
        const element = document.createElement(tagName);
        if (textContent) {
            element.textContent = textContent; // Use textContent instead of innerHTML
        }
        if (className) {
            element.className = className;
        }
        return element;
    }

    /**
     * Global error handler
     */
    setupGlobalErrorHandler() {
        window.addEventListener('error', (event) => {
            console.error('Global error:', event.error);
            this.showUserFriendlyError('An unexpected error occurred. Please refresh the page and try again.');
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            this.showUserFriendlyError('An unexpected error occurred during processing.');
            event.preventDefault();
        });
    }

    /**
     * Show user-friendly error message
     */
    showUserFriendlyError(message) {
        // This will be implemented by the main application
        if (window.app && typeof window.app.showError === 'function') {
            window.app.showError('Error', this.sanitizeErrorMessage(message));
        }
    }
}

// Export for use in other modules
window.SecurityUtils = SecurityUtils;