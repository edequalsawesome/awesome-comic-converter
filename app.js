/**
 * Comic Converter Application
 * Main application logic for converting AZW3 to CBZ
 */

class ComicConverter {
    constructor() {
        this.securityUtils = new SecurityUtils();
        this.parser = new AZW3Parser();
        this.opfParser = new OPFParser();
        this.processingFiles = new Map();
        this.completedFiles = new Map();
        this.errors = [];
        
        // Setup global error handling
        this.securityUtils.setupGlobalErrorHandler();
        
        this.initializeEventListeners();
        this.initializeTheme();
    }

    /**
     * Initialize all event listeners
     */
    initializeEventListeners() {
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        const folderInput = document.getElementById('folderInput');
        const browseBtn = document.getElementById('browseBtn');
        const browseFolderBtn = document.getElementById('browseFolderBtn');
        const clearBtn = document.getElementById('clearBtn');
        const downloadAllBtn = document.getElementById('downloadAllBtn');
        const themeToggle = document.getElementById('themeToggle');

        // File input events
        fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
        folderInput.addEventListener('change', (e) => this.handleFolders(e.target.files));
        browseBtn.addEventListener('click', () => fileInput.click());
        browseFolderBtn.addEventListener('click', () => folderInput.click());
        clearBtn.addEventListener('click', () => this.clearResults());
        downloadAllBtn.addEventListener('click', () => this.downloadAllFiles());
        themeToggle.addEventListener('click', () => this.toggleTheme());

        // Drag and drop events
        dropZone.addEventListener('dragover', this.handleDragOver.bind(this));
        dropZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
        dropZone.addEventListener('drop', this.handleDrop.bind(this));

        // Prevent default drag behaviors on the document
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => e.preventDefault());
    }

    /**
     * Handle drag over event
     */
    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('dropZone').classList.add('drag-over');
    }

    /**
     * Handle drag leave event
     */
    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('dropZone').classList.remove('drag-over');
    }

    /**
     * Handle drop event
     */
    async handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('dropZone').classList.remove('drag-over');
        
        // Handle both files and directory entries
        const items = Array.from(e.dataTransfer.items);
        const files = [];
        
        // Process DataTransferItems to handle folders properly
        for (const item of items) {
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    if (entry.isDirectory) {
                        // Handle directory
                        const dirFiles = await this.readDirectory(entry);
                        files.push(...dirFiles);
                    } else {
                        // Handle individual file
                        const file = item.getAsFile();
                        files.push(file);
                    }
                } else {
                    // Fallback for browsers that don't support webkitGetAsEntry
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
        }
        
        if (files.length === 0) {
            this.showError('No valid files found', 'Please drop AZW3 files or folders containing AZW3 + metadata files');
            return;
        }
        
        // Check if we have folder structure
        const hasDirectoryStructure = files.some(file =>
            file.webkitRelativePath && file.webkitRelativePath.includes('/')
        );
        
        // Also check if we have multiple files that suggest a folder structure
        const hasMultipleRelatedFiles = files.length > 1 && this.looksLikeFolderStructure(files);
        
        if (hasDirectoryStructure || hasMultipleRelatedFiles) {
            // Set webkitRelativePath for dropped folder files if not set
            if (!hasDirectoryStructure && hasMultipleRelatedFiles) {
                files.forEach(file => {
                    if (!file.webkitRelativePath) {
                        // Create a synthetic path based on common folder name
                        const folderName = this.inferFolderName(files);
                        // Use a safer approach to track file paths
                        file._syntheticPath = `${folderName}/${file.name}`;
                    }
                });
            }
            this.handleFolders(files);
        } else {
            // Filter for AZW3 files
            const azw3Files = files.filter(file =>
                file.name.toLowerCase().endsWith('.azw3')
            );
            
            if (azw3Files.length === 0) {
                this.showError('No valid files found', 'Please drop AZW3 files or folders containing AZW3 + metadata files');
                return;
            }
            
            this.handleFiles(azw3Files);
        }
    }

    /**
     * Read directory contents recursively
     */
    async readDirectory(dirEntry, path = '') {
        const files = [];
        const reader = dirEntry.createReader();
        
        return new Promise((resolve) => {
            const readEntries = () => {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) {
                        resolve(files);
                        return;
                    }
                    
                    for (const entry of entries) {
                        const fullPath = path ? `${path}/${entry.name}` : entry.name;
                        
                        if (entry.isFile) {
                            const file = await this.getFileFromEntry(entry);
                            if (file) {
                                // Use a safer approach to track file paths
                                file._syntheticPath = `${dirEntry.name}/${fullPath}`;
                                files.push(file);
                            }
                        } else if (entry.isDirectory) {
                            const subFiles = await this.readDirectory(entry, fullPath);
                            files.push(...subFiles);
                        }
                    }
                    
                    readEntries(); // Continue reading
                });
            };
            
            readEntries();
        });
    }

    /**
     * Get file from directory entry
     */
    getFileFromEntry(fileEntry) {
        return new Promise((resolve) => {
            fileEntry.file(resolve, () => resolve(null));
        });
    }

    /**
     * Check if files look like they came from a folder structure
     */
    looksLikeFolderStructure(files) {
        const hasAzw3 = files.some(f => f.name.toLowerCase().endsWith('.azw3'));
        const hasOpf = files.some(f => f.name.toLowerCase().endsWith('.opf'));
        const hasCover = files.some(f =>
            f.name.toLowerCase().includes('cover') &&
            /\.(jpg|jpeg|png|gif)$/i.test(f.name)
        );
        
        // If we have AZW3 + (OPF or Cover), it's likely a folder structure
        return hasAzw3 && (hasOpf || hasCover);
    }

    /**
     * Infer folder name from file collection
     */
    inferFolderName(files) {
        // Try to find a common base name from the AZW3 file
        const azw3File = files.find(f => f.name.toLowerCase().endsWith('.azw3'));
        if (azw3File) {
            return azw3File.name.replace(/\.azw3$/i, '');
        }
        
        // Fallback to generic name
        return 'Comic_Folder';
    }

    /**
     * Handle selected files
     */
    async handleFiles(files) {
        if (files.length === 0) return;

        try {
            // Validate batch size and file sizes
            this.securityUtils.validateBatchSize(files);
            
            // Validate each file
            for (const file of files) {
                this.securityUtils.validateFileSize(file);
                this.securityUtils.validateFileExtension(file.name, ['azw3']);
            }

            // Clear previous results
            this.clearResults();
            
            // Show processing section
            document.getElementById('processingSection').style.display = 'block';
            
            // Process each file with rate limiting
            for (const file of files) {
                await this.securityUtils.addToProcessingQueue(() => this.processFile(file));
            }
            
            // Show results
            this.showResults();
        } catch (error) {
            this.showError('Validation Error', this.securityUtils.sanitizeErrorMessage(error));
        }
    }

    /**
     * Handle selected folders
     */
    async handleFolders(files) {
        if (files.length === 0) return;

        try {
            // Validate batch size and file sizes
            this.securityUtils.validateBatchSize(files);
            
            // Validate each file
            for (const file of files) {
                this.securityUtils.validateFileSize(file);
                // Allow various file types in folders (azw3, opf, jpg, png, gif)
                const allowedExtensions = ['azw3', 'opf', 'jpg', 'jpeg', 'png', 'gif', 'json'];
                this.securityUtils.validateFileExtension(file.name, allowedExtensions);
            }

            // Clear previous results
            this.clearResults();
            
            // Show processing section
            document.getElementById('processingSection').style.display = 'block';
            
            // Group files by folder
            const folderGroups = this.groupFilesByFolder(files);
            
            // Process each folder with rate limiting
            for (const [folderPath, folderFiles] of folderGroups) {
                await this.securityUtils.addToProcessingQueue(() => this.processFolderGroup(folderPath, folderFiles));
            }
            
            // Show results
            this.showResults();
        } catch (error) {
            this.showError('Validation Error', this.securityUtils.sanitizeErrorMessage(error));
        }
    }

    /**
     * Group files by their folder path
     */
    groupFilesByFolder(files) {
        const groups = new Map();
        
        for (const file of files) {
            const path = file.webkitRelativePath || file._syntheticPath || file.name;
            const folderPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
            
            if (!groups.has(folderPath)) {
                groups.set(folderPath, []);
            }
            groups.get(folderPath).push(file);
        }
        
        return groups;
    }

    /**
     * Process a folder group containing AZW3, OPF, and cover files
     */
    async processFolderGroup(folderPath, files) {
        const folderName = folderPath.split('/').pop() || 'Root';
        const fileId = this.generateFolderId(folderPath, files);
        
        try {
            // Add folder to processing list
            this.addFolderToProcessingList(folderName, fileId, files.length);
            
            // Find required files
            const azw3File = files.find(f => f.name.toLowerCase().endsWith('.azw3'));
            const opfFile = files.find(f => f.name.toLowerCase().endsWith('.opf'));
            const coverFile = files.find(f =>
                f.name.toLowerCase().includes('cover') &&
                /\.(jpg|jpeg|png|gif)$/i.test(f.name)
            );
            
            if (!azw3File) {
                throw new Error('No AZW3 file found in folder');
            }
            
            // Update status
            this.updateFileStatus(fileId, 'Reading files...', 10);
            
            // Parse OPF metadata if available
            let metadata = null;
            if (opfFile) {
                this.updateFileStatus(fileId, 'Parsing metadata...', 20);
                const opfContent = await this.readFileAsText(opfFile);
                const opfData = this.opfParser.parseOPF(opfContent);
                metadata = opfData.metadata;
            }
            
            // Update status
            this.updateFileStatus(fileId, 'Parsing AZW3 format...', 40);
            
            // Parse the AZW3 file
            const buffer = await this.readFileAsArrayBuffer(azw3File);
            const parsedData = await this.parser.parseFile(buffer);
            
            // Merge metadata
            if (metadata) {
                parsedData.metadata = { ...parsedData.metadata, ...metadata };
            }
            
            if (parsedData.images.length === 0) {
                throw new Error('No images found in the AZW3 file');
            }
            
            // Update status
            this.updateFileStatus(fileId, `Found ${parsedData.images.length} images, creating CBZ...`, 70);
            
            // Create CBZ file with enhanced metadata
            const cbzBlob = await this.createEnhancedCBZ(parsedData, azw3File.name, coverFile);
            
            // Update status
            this.updateFileStatus(fileId, 'Conversion complete!', 100, 'complete');
            
            // Store completed file
            this.completedFiles.set(fileId, {
                originalName: azw3File.name,
                folderName: folderName,
                cbzBlob,
                imageCount: parsedData.images.length,
                metadata: parsedData.metadata,
                hasCover: !!coverFile,
                hasMetadata: !!opfFile
            });
            
        } catch (error) {
            console.error('Error processing folder:', error);
            const sanitizedError = this.securityUtils.sanitizeErrorMessage(error);
            this.updateFileStatus(fileId, `Error: ${sanitizedError}`, 0, 'error');
            this.errors.push({
                fileName: `${folderName} (folder)`,
                error: sanitizedError
            });
        }
    }

    /**
     * Process a single AZW3 file
     */
    async processFile(file) {
        const fileId = this.generateFileId(file);
        
        try {
            // Add file to processing list
            this.addFileToProcessingList(file, fileId);
            
            // Update status
            this.updateFileStatus(fileId, 'Reading file...', 10);
            
            // Read file as ArrayBuffer
            const buffer = await this.readFileAsArrayBuffer(file);
            
            // Update status
            this.updateFileStatus(fileId, 'Parsing AZW3 format...', 30);
            
            // Parse the AZW3 file
            const parsedData = await this.parser.parseFile(buffer);
            
            if (parsedData.images.length === 0) {
                throw new Error('No images found in the file');
            }
            
            // Update status
            this.updateFileStatus(fileId, `Found ${parsedData.images.length} images, creating CBZ...`, 60);
            
            // Create CBZ file
            const cbzBlob = await this.createCBZ(parsedData, file.name);
            
            // Update status
            this.updateFileStatus(fileId, 'Conversion complete!', 100, 'complete');
            
            // Store completed file
            this.completedFiles.set(fileId, {
                originalName: file.name,
                cbzBlob,
                imageCount: parsedData.images.length,
                metadata: parsedData.metadata
            });
            
        } catch (error) {
            console.error('Error processing file:', error);
            const sanitizedError = this.securityUtils.sanitizeErrorMessage(error);
            this.updateFileStatus(fileId, `Error: ${sanitizedError}`, 0, 'error');
            this.errors.push({
                fileName: file.name,
                error: sanitizedError
            });
        }
    }

    /**
     * Create CBZ file from parsed data
     */
    async createCBZ(parsedData, originalFileName) {
        const zip = new JSZip();
        
        // Add images to zip
        for (const image of parsedData.images) {
            zip.file(image.filename, image.data);
        }
        
        // Add metadata file
        const metadata = {
            title: parsedData.metadata.title,
            author: parsedData.metadata.author,
            publisher: parsedData.metadata.publisher,
            pageCount: parsedData.images.length,
            convertedFrom: originalFileName,
            convertedAt: new Date().toISOString()
        };
        
        zip.file('metadata.json', JSON.stringify(metadata, null, 2));
        
        // Generate CBZ file
        const cbzBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'STORE', // No compression to preserve image quality
            compressionOptions: {
                level: 0
            }
        });
        
        return cbzBlob;
    }

    /**
     * Create enhanced CBZ file with OPF metadata and cover
     */
    async createEnhancedCBZ(parsedData, originalFileName, coverFile) {
        const zip = new JSZip();
        
        // Add cover image first if available
        if (coverFile) {
            const coverData = await this.readFileAsArrayBuffer(coverFile);
            const coverExtension = coverFile.name.split('.').pop().toLowerCase();
            zip.file(`000_cover.${coverExtension}`, coverData);
        }
        
        // Add images to zip
        for (const image of parsedData.images) {
            zip.file(image.filename, image.data);
        }
        
        // Generate ComicInfo.xml from OPF metadata
        const comicInfoXml = this.opfParser.generateComicInfo(
            parsedData.metadata,
            parsedData.images.length + (coverFile ? 1 : 0)
        );
        zip.file('ComicInfo.xml', comicInfoXml);
        
        // Add enhanced metadata file
        const metadata = {
            title: parsedData.metadata.title,
            creator: parsedData.metadata.creator,
            author: parsedData.metadata.creator,
            publisher: parsedData.metadata.publisher,
            description: parsedData.metadata.description,
            series: parsedData.metadata.series,
            seriesIndex: parsedData.metadata.seriesIndex,
            genre: parsedData.metadata.genre,
            language: parsedData.metadata.language,
            date: parsedData.metadata.date,
            identifier: parsedData.metadata.identifier,
            pageCount: parsedData.images.length + (coverFile ? 1 : 0),
            hasCover: !!coverFile,
            convertedFrom: originalFileName,
            convertedAt: new Date().toISOString(),
            custom: parsedData.metadata.custom
        };
        
        zip.file('metadata.json', JSON.stringify(metadata, null, 2));
        
        // Generate CBZ file
        const cbzBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'STORE', // No compression to preserve image quality
            compressionOptions: {
                level: 0
            }
        });
        
        return cbzBlob;
    }

    /**
     * Read file as text
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file as text'));
            reader.readAsText(file);
        });
    }

    /**
     * Read file as ArrayBuffer
     */
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Generate unique file ID
     */
    generateFileId(file) {
        return `file_${this.securityUtils.generateSecureId()}`;
    }

    /**
     * Generate unique folder ID
     */
    generateFolderId(folderPath, files) {
        return `folder_${this.securityUtils.generateSecureId()}`;
    }

    /**
     * Add folder to processing list UI
     */
    addFolderToProcessingList(folderName, fileId, fileCount) {
        const fileList = document.getElementById('fileList');
        
        const fileItem = this.securityUtils.createSafeElement('div', '', 'file-item');
        fileItem.id = `file-${fileId}`;
        
        // Create title
        const title = this.securityUtils.createSafeElement('h4', `${folderName} (${fileCount} files)`);
        
        // Create progress bar container
        const progressBar = this.securityUtils.createSafeElement('div', '', 'progress-bar');
        const progressFill = this.securityUtils.createSafeElement('div', '', 'progress-fill');
        progressFill.id = `progress-${fileId}`;
        progressBar.appendChild(progressFill);
        
        // Create status
        const status = this.securityUtils.createSafeElement('div', 'Preparing...', 'status processing');
        status.id = `status-${fileId}`;
        
        fileItem.appendChild(title);
        fileItem.appendChild(progressBar);
        fileItem.appendChild(status);
        fileList.appendChild(fileItem);
    }

    /**
     * Add file to processing list UI
     */
    addFileToProcessingList(file, fileId) {
        const fileList = document.getElementById('fileList');
        
        const fileItem = this.securityUtils.createSafeElement('div', '', 'file-item');
        fileItem.id = `file-${fileId}`;
        
        // Create title
        const title = this.securityUtils.createSafeElement('h4', file.name);
        
        // Create progress bar container
        const progressBar = this.securityUtils.createSafeElement('div', '', 'progress-bar');
        const progressFill = this.securityUtils.createSafeElement('div', '', 'progress-fill');
        progressFill.id = `progress-${fileId}`;
        progressBar.appendChild(progressFill);
        
        // Create status
        const status = this.securityUtils.createSafeElement('div', 'Preparing...', 'status processing');
        status.id = `status-${fileId}`;
        
        fileItem.appendChild(title);
        fileItem.appendChild(progressBar);
        fileItem.appendChild(status);
        fileList.appendChild(fileItem);
    }

    /**
     * Update file processing status
     */
    updateFileStatus(fileId, message, progress, statusClass = 'processing') {
        const progressElement = document.getElementById(`progress-${fileId}`);
        const statusElement = document.getElementById(`status-${fileId}`);
        
        if (progressElement) {
            progressElement.style.width = `${progress}%`;
        }
        
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = `status ${statusClass}`;
        }
    }

    /**
     * Show results section
     */
    showResults() {
        // Hide processing section
        document.getElementById('processingSection').style.display = 'none';
        
        // Show completed files
        if (this.completedFiles.size > 0) {
            this.showCompletedFiles();
        }
        
        // Show errors if any
        if (this.errors.length > 0) {
            this.showErrors();
        }
    }

    /**
     * Show completed files
     */
    showCompletedFiles() {
        const resultsSection = document.getElementById('resultsSection');
        const downloadList = document.getElementById('downloadList');
        
        downloadList.innerHTML = '';
        
        for (const [fileId, fileData] of this.completedFiles) {
            const downloadItem = document.createElement('div');
            downloadItem.className = 'download-item';
            
            const cbzFileName = fileData.originalName.replace(/\.azw3$/i, '.cbz');
            const fileSize = this.formatFileSize(fileData.cbzBlob.size);
            
            // Build metadata info
            let metadataInfo = `${fileData.imageCount} pages • ${fileSize}`;
            if (fileData.folderName) {
                metadataInfo = `📁 ${fileData.folderName} • ${metadataInfo}`;
            }
            if (fileData.hasCover) {
                metadataInfo += ' • 🖼️ Cover';
            }
            if (fileData.hasMetadata) {
                metadataInfo += ' • 📋 Metadata';
            }
            
            // Create download info section
            const downloadInfo = this.securityUtils.createSafeElement('div', '', 'download-info');
            
            // Add series info if available
            let titleDisplay = cbzFileName;
            if (fileData.metadata && fileData.metadata.series) {
                titleDisplay = `${fileData.metadata.series}${fileData.metadata.seriesIndex ? ` #${fileData.metadata.seriesIndex}` : ''} - ${titleDisplay}`;
            }
            
            const title = this.securityUtils.createSafeElement('h4', titleDisplay);
            const info = this.securityUtils.createSafeElement('p', metadataInfo);
            
            downloadInfo.appendChild(title);
            downloadInfo.appendChild(info);
            
            // Add description if available
            if (fileData.metadata && fileData.metadata.description) {
                const description = fileData.metadata.description.substring(0, 100);
                const descText = description + (fileData.metadata.description.length > 100 ? '...' : '');
                const descElement = this.securityUtils.createSafeElement('small', descText);
                downloadInfo.appendChild(descElement);
            }
            
            // Create download button
            const downloadBtn = this.securityUtils.createSafeElement('button', 'Download CBZ', 'download-btn');
            downloadBtn.addEventListener('click', () => this.downloadFile(fileId));
            
            downloadItem.appendChild(downloadInfo);
            downloadItem.appendChild(downloadBtn);
            
            downloadList.appendChild(downloadItem);
        }
        
        // Show/hide download all button based on number of files
        const downloadAllBtn = document.getElementById('downloadAllBtn');
        if (this.completedFiles.size > 1) {
            downloadAllBtn.style.display = 'flex';
        } else {
            downloadAllBtn.style.display = 'none';
        }
        
        resultsSection.style.display = 'block';
    }

    /**
     * Show errors
     */
    showErrors() {
        const errorSection = document.getElementById('errorSection');
        const errorList = document.getElementById('errorList');
        
        errorList.innerHTML = '';
        
        for (const error of this.errors) {
            const errorItem = this.securityUtils.createSafeElement('div', '', 'error-item');
            
            const fileName = this.securityUtils.createSafeElement('h4', error.fileName);
            const errorMsg = this.securityUtils.createSafeElement('p', error.error);
            
            errorItem.appendChild(fileName);
            errorItem.appendChild(errorMsg);
            errorList.appendChild(errorItem);
        }
        
        errorSection.style.display = 'block';
    }

    /**
     * Download converted file
     */
    downloadFile(fileId) {
        const fileData = this.completedFiles.get(fileId);
        if (!fileData) return;
        
        const cbzFileName = fileData.originalName.replace(/\.azw3$/i, '.cbz');
        const url = URL.createObjectURL(fileData.cbzBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = cbzFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up the URL object
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Download all converted files as a single ZIP
     */
    async downloadAllFiles() {
        if (this.completedFiles.size === 0) return;

        const downloadAllBtn = document.getElementById('downloadAllBtn');
        const originalText = downloadAllBtn.innerHTML;
        
        try {
            // Disable button and show progress
            downloadAllBtn.disabled = true;
            downloadAllBtn.innerHTML = '📦 Creating ZIP...';

            // Create a new ZIP file containing all CBZ files
            const zip = new JSZip();
            
            // Add each CBZ file to the ZIP
            for (const [fileId, fileData] of this.completedFiles) {
                const cbzFileName = fileData.originalName.replace(/\.azw3$/i, '.cbz');
                
                // Add the CBZ blob to the ZIP
                zip.file(cbzFileName, fileData.cbzBlob);
            }

            // Update button text
            downloadAllBtn.innerHTML = '📦 Generating ZIP...';

            // Generate the ZIP file
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: {
                    level: 6
                }
            });

            // Create download link
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
            const zipFileName = `comic_collection_${timestamp}.zip`;
            
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Clean up
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            // Show success message briefly
            downloadAllBtn.innerHTML = '✅ Downloaded!';
            setTimeout(() => {
                downloadAllBtn.innerHTML = originalText;
                downloadAllBtn.disabled = false;
            }, 2000);

        } catch (error) {
            console.error('Error creating ZIP file:', error);
            downloadAllBtn.innerHTML = '❌ Error';
            setTimeout(() => {
                downloadAllBtn.innerHTML = originalText;
                downloadAllBtn.disabled = false;
            }, 2000);
        }
    }

    /**
     * Clear all results and reset the interface
     */
    clearResults() {
        // Clear data
        this.processingFiles.clear();
        this.completedFiles.clear();
        this.errors = [];
        
        // Clear UI
        document.getElementById('fileList').innerHTML = '';
        document.getElementById('downloadList').innerHTML = '';
        document.getElementById('errorList').innerHTML = '';
        
        // Hide sections
        document.getElementById('processingSection').style.display = 'none';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('errorSection').style.display = 'none';
        
        // Hide download all button
        document.getElementById('downloadAllBtn').style.display = 'none';
        
        // Reset file input
        document.getElementById('fileInput').value = '';
    }

    /**
     * Show error message
     */
    showError(title, message) {
        this.errors.push({
            fileName: title,
            error: message
        });
        this.showErrors();
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        return this.securityUtils.formatFileSize(bytes);
    }


    /**
     * Initialize theme system
     */
    initializeTheme() {
        // Check for saved theme preference
        const savedTheme = this.securityUtils.safeLocalStorageGet('comic-converter-theme');
        
        if (savedTheme) {
            // Use saved preference
            this.setTheme(savedTheme);
        } else {
            // Default to OS preference - don't save it to localStorage yet
            // This allows the CSS media queries to handle the default styling
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const osTheme = prefersDark ? 'dark' : 'light';
            
            // Set the theme without saving to localStorage so it remains responsive to OS changes
            document.documentElement.setAttribute('data-theme', osTheme);
            
            // Update theme toggle icon
            const themeIcon = document.querySelector('.theme-icon');
            if (themeIcon) {
                themeIcon.textContent = osTheme === 'light' ? '🌙' : '☀️';
            }
            
            // Listen for OS theme changes when no manual preference is set
            if (window.matchMedia) {
                const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                mediaQuery.addEventListener('change', (e) => {
                    // Only update if user hasn't manually set a preference
                    if (!this.securityUtils.safeLocalStorageGet('comic-converter-theme')) {
                        const newOsTheme = e.matches ? 'dark' : 'light';
                        document.documentElement.setAttribute('data-theme', newOsTheme);
                        
                        // Update theme toggle icon
                        const themeIcon = document.querySelector('.theme-icon');
                        if (themeIcon) {
                            themeIcon.textContent = newOsTheme === 'light' ? '🌙' : '☀️';
                        }
                    }
                });
            }
        }
    }

    /**
     * Toggle between light and dark themes
     */
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
    }

    /**
     * Set the theme
     */
    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        this.securityUtils.safeLocalStorageSet('comic-converter-theme', theme);
        
        // Update theme toggle icon
        const themeIcon = document.querySelector('.theme-icon');
        if (themeIcon) {
            themeIcon.textContent = theme === 'light' ? '🌙' : '☀️';
        }
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ComicConverter();
});