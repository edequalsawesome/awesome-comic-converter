# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Awesome Comic Converter is a client-side web application that converts DRM-free Amazon AZW3 comic book files to CBZ format. The application runs entirely in the browser using vanilla JavaScript with no build system required.

## Development Commands

### Local Development Server
```bash
# Serves only on localhost
npm run start
```

Then open `http://127.0.0.1:8000` in a current Chromium browser. The app uses modern JavaScript syntax and has not been tested against legacy browser versions.

### Testing
```bash
npm test
npm run lint
```

Tests use Node's built-in runner (Node 18+). Browser QA remains useful for picker, cover, and download flows.

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
  - File and batch validation helpers
  - Input sanitization and XSS prevention

### File Processing Flow

1. User drops files/folders or uses file browser
2. SecurityUtils validates file types and sizes
3. Each AZW3 is processed sequentially
4. AZW3Parser extracts images from AZW3 files
5. OPFParser extracts metadata from optional OPF files
6. Images and metadata are packaged into CBZ using JSZip
7. Files are offered for download with progress tracking

### Security Features

- Content Security Policy (CSP) headers in HTML
- File type validation using magic bytes
- Per-file and batch-size validation plus a 512 MiB retained-output budget
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

- **JSZip**: bundled at `vendor/jszip.min.js` for local archive creation
  - Used with STORE compression to preserve image quality

## Browser Compatibility

- Tested in current Chromium.
- Requires File API, Blob/ArrayBuffer, Web Workers, and modern JavaScript syntax.

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

- Large files and archive creation require transient browser memory beyond the retained-output cap.
- Processing is sequential, and completed downloads are capped at 512 MiB until saved or cleared.

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
