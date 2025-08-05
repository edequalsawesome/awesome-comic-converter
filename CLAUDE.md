# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Awesome Comic Converter is a client-side web application that converts DRM-free Amazon AZW3 comic book files to CBZ format. The application runs entirely in the browser using vanilla JavaScript with no build system required.

## Development Commands

### Local Development Server
```bash
# Using Python 3 (recommended)
npm run start
# or
python -m http.server 8000

# Using Node.js http-server
npm run serve
# or
npx http-server -p 8000

# Using PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

### Testing
```bash
npm run test
# Opens test.html in the default browser
```

Note: There is no formal test framework - testing is done manually by opening test.html.

## Architecture

### Core Components

The application follows a modular class-based architecture:

- **ComicConverter** (`app.js`): Main application controller
  - Handles UI interactions, file processing coordination
  - Manages theme switching and global state
  - Coordinates between parsers and security utilities

- **AZW3Parser** (`azw3-parser.js`): AZW3 format parser
  - Parses Palm Database headers and MOBI structures
  - Extracts embedded images while preserving quality
  - Handles various AZW3 file variations

- **OPFParser** (`opf-parser.js`): Metadata parser
  - Parses XML-based OPF metadata files
  - Extracts comic metadata (title, author, series, etc.)
  - Validates XML content for security

- **SecurityUtils** (`security-utils.js`): Security and validation
  - File type validation using magic bytes
  - Memory usage tracking and limits
  - Rate limiting and batch processing controls
  - Input sanitization and XSS prevention

### File Processing Flow

1. User drops files/folders or uses file browser
2. SecurityUtils validates file types and sizes
3. Files are queued and processed with rate limiting
4. AZW3Parser extracts images from AZW3 files
5. OPFParser extracts metadata from optional OPF files
6. Images and metadata are packaged into CBZ using JSZip
7. Files are offered for download with progress tracking

### Security Features

- Content Security Policy (CSP) headers in HTML
- File type validation using magic bytes
- Memory usage limits (1GB max, 500MB per file)
- Input sanitization for all user data
- No server communication - entirely client-side

## Key Files

- `index.html`: Main application interface with security headers
- `app.js`: Primary application logic and UI handling
- `azw3-parser.js`: Core AZW3 file format parsing
- `opf-parser.js`: Metadata extraction from OPF files
- `security-utils.js`: Security utilities and validation
- `styles.css`: Application styling with theme support

## External Dependencies

- **JSZip**: Loaded from CDN for creating CBZ archives
  - CDN: `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`
  - Used with STORE compression to preserve image quality

## Browser Compatibility

- Chrome 60+, Firefox 55+, Safari 11+, Edge 79+
- Requires File API, Blob/ArrayBuffer, and modern JavaScript features
- No Internet Explorer support

## Development Guidelines

### Adding New Features

1. Follow the existing class-based modular pattern
2. Use SecurityUtils for all file validation and processing
3. Implement proper error handling with user-friendly messages
4. Track memory usage for large file operations
5. Maintain client-side only operation (no server dependencies)

### Security Considerations

- Always validate file types using magic bytes, not extensions
- Use SecurityUtils.validateXmlContent() for any XML parsing
- Implement memory limits for large file processing
- Sanitize all user inputs and file contents
- Never expose sensitive data in error messages

### Performance Notes

- Large files (>100MB) require significant browser memory
- Processing is done sequentially to prevent memory exhaustion
- Use rate limiting (max 3 concurrent files) for batch operations
- Consider memory cleanup after processing large files

## File Structure Conventions

```
/
├── index.html          # Main app entry point
├── app.js             # Main application controller
├── azw3-parser.js     # AZW3 format parser
├── opf-parser.js      # OPF metadata parser
├── security-utils.js  # Security and validation utilities
├── styles.css         # Application styles
└── package.json       # Project metadata and scripts
```