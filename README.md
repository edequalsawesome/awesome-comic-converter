# Comic Converter - AZW3 to CBZ

A web-based application for converting DRM-free Amazon comic book files (AZW3) to CBZ format with optimized image quality.

## Features

- **Client-side Processing**: All conversion happens in your browser for maximum privacy
- **Dual Input Support**: Handle individual AZW3 files or complete folder structures
- **Enhanced Metadata**: Extract rich metadata from OPF files when available
- **Cover Image Support**: Automatically include cover.jpg files in CBZ output
- **Drag & Drop Interface**: Simple, intuitive file and folder upload
- **Batch Processing**: Convert multiple files/folders simultaneously
- **Image Optimization**: Extracts highest resolution images without re-compression
- **Progress Tracking**: Real-time progress indicators for large files
- **Error Handling**: Comprehensive error reporting for problematic files
- **CBZ Output**: Standard comic book archive format with ComicInfo.xml metadata

## Technical Specifications

### Supported Input Formats
- **Individual Files**: AZW3 (Amazon Kindle Comic Book format)
- **Folder Structure**: Directories containing:
  - AZW3 file (required)
  - metadata.opf file (optional - provides enhanced metadata)
  - cover.jpg/png/gif (optional - included as first page)
- DRM-free files only

### Output Format
- CBZ (Comic Book ZIP archive)
- Preserves original image quality
- Maintains proper reading order
- Includes metadata file

### Browser Requirements
- Modern web browser with JavaScript enabled
- File API support
- Blob/ArrayBuffer support
- Minimum 1GB RAM recommended for large files

## Installation

1. Clone or download this repository
2. Open `index.html` in a web browser
3. No additional installation required

### Local Development Server (Optional)

For better performance and to avoid CORS issues:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js (if you have http-server installed)
npx http-server

# Using PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

## Usage

### Basic Usage

#### Individual Files
1. Open the application in your web browser
2. Drag and drop AZW3 files onto the upload area, or click "browse files"
3. Wait for processing to complete
4. Download the converted CBZ files

#### Folder Upload (Enhanced)
1. Prepare folders with the structure:
   ```
   Comic_Name/
   ├── comic.azw3 (required)
   ├── metadata.opf (optional)
   └── cover.jpg (optional)
   ```
2. Drag and drop the folder(s) onto the upload area, or click "browse folders"
3. The application will extract enhanced metadata from OPF files
4. Cover images will be included as the first page in the CBZ
5. Download the enriched CBZ files with full metadata

### Batch Processing

- Select multiple AZW3 files or folders at once
- Each item is processed independently
- Progress is shown for each file/folder individually
- Failed conversions don't affect other items
- Mixed file and folder uploads are supported

### File Requirements

- Files must be DRM-free AZW3 format
- Comic book files (not text-based ebooks)
- Maximum recommended file size: 500MB per file
- OPF files should be valid XML format
- Cover images: JPEG, PNG, or GIF format

## Technical Details

### AZW3 Format Support

The application parses AZW3 files by:
- Reading the Palm Database Header
- Parsing the MOBI header structure
- Extracting embedded image records
- Identifying image formats (JPEG, PNG, GIF)
- Preserving original image quality

### Image Processing

- **No Re-compression**: Images are extracted as-is to preserve quality
- **Format Detection**: Automatic identification of JPEG, PNG, and GIF images
- **Dimension Reading**: Extracts width/height information when available
- **Proper Naming**: Sequential naming for correct reading order

### CBZ Generation

- Uses JSZip library for archive creation
- STORE compression (no compression) to preserve image quality
- Includes metadata.json with conversion information
- Maintains proper file structure for comic readers

## File Structure

```
comic-converter/
├── index.html          # Main application interface
├── styles.css          # Application styling
├── app.js             # Main application logic
├── azw3-parser.js     # AZW3 file format parser
└── README.md          # This documentation
```

## Dependencies

- **JSZip**: For creating CBZ (ZIP) archives
  - Loaded from CDN: `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`
  - Used under MIT license

## Browser Compatibility

### Fully Supported
- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

### Limited Support
- Internet Explorer: Not supported
- Older mobile browsers: May have performance issues

## Performance Considerations

### Memory Usage
- Large AZW3 files (>100MB) require significant RAM
- Processing happens entirely in browser memory
- Recommend closing other tabs for large files

### Processing Time
- Typical comic: 10-30 seconds
- Large files (>50MB): 1-5 minutes
- Multiple files: Processed sequentially

## Troubleshooting

### Common Issues

**"Invalid AZW3 file format" Error**
- File may be DRM-protected
- File may be corrupted
- File may not be a comic book format

**"No images found in the file" Error**
- File may be text-based ebook, not comic
- Images may be in unsupported format
- File structure may be non-standard

**Browser Crashes or Freezes**
- File too large for available memory
- Try processing smaller files
- Close other browser tabs
- Restart browser and try again

**Slow Processing**
- Normal for large files
- Ensure stable internet connection (for CDN resources)
- Close unnecessary applications

### Performance Tips

1. **Process files individually** if experiencing memory issues
2. **Use a local server** for better performance
3. **Close other browser tabs** to free memory
4. **Use latest browser version** for best performance

## Security & Privacy

- **No data transmission**: All processing happens locally
- **No server uploads**: Files never leave your device
- **No tracking**: No analytics or user tracking
- **Open source**: All code is visible and auditable

## Limitations

- **DRM-free files only**: Cannot process DRM-protected content
- **Comic books only**: Not suitable for text-based ebooks
- **Browser memory limits**: Very large files may cause issues
- **Format support**: Limited to standard image formats (JPEG, PNG, GIF)

## Legal Notice

This tool is designed for converting your legally owned, DRM-free comic book files. Users are responsible for ensuring they have the right to convert and use the files they process. The developers are not responsible for any copyright violations or misuse of this tool.

## Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

### Development Setup

1. Clone the repository
2. Make your changes
3. Test with various AZW3 files
4. Submit a pull request

## License

This project is licensed under the GPL v3 License - see the LICENSE.md file for details. Please check individual dependencies for their respective licenses.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review browser console for error messages
3. Ensure files are DRM-free and in comic book format
4. Try with a different/smaller file to isolate the issue