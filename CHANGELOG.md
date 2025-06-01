# Changelog

## Version 2.0.0 - Enhanced Folder Support

### 🎉 New Features

#### Folder Upload Support
- **Folder Structure Processing**: Upload entire folders containing AZW3 + metadata files
- **Enhanced Metadata Extraction**: Parse metadata.opf files for rich comic book information
- **Cover Image Integration**: Automatically include cover.jpg/png/gif as first page in CBZ
- **Dual Input Methods**: Support both individual files and folder structures

#### Enhanced Metadata
- **OPF Parser**: Complete Open Packaging Format parser for metadata extraction
- **ComicInfo.xml Generation**: Create standard comic book metadata files
- **Series Information**: Extract and display series name and issue numbers
- **Rich Descriptions**: Include plot summaries and detailed metadata
- **Custom Metadata**: Support for publisher-specific metadata fields

#### Improved User Experience
- **Visual Indicators**: Show folder structure, cover availability, and metadata status
- **Enhanced Display**: Rich information display with series, descriptions, and file details
- **Better Organization**: Improved file naming and structure for comic readers
- **Progress Tracking**: Detailed progress for complex folder processing

### 🔧 Technical Improvements

#### New Components
- **OPF Parser** (`opf-parser.js`): Comprehensive metadata extraction
- **Enhanced CBZ Creation**: Improved archive structure with metadata
- **Folder Processing**: Smart file grouping and processing logic
- **Metadata Merging**: Combine AZW3 and OPF metadata intelligently

#### File Structure Support
```
Comic_Folder/
├── comic.azw3          # Main comic file (required)
├── metadata.opf        # Metadata file (optional)
└── cover.jpg          # Cover image (optional)
```

#### Output Enhancements
- **ComicInfo.xml**: Standard comic book metadata format
- **Enhanced JSON**: Comprehensive metadata export
- **Cover Integration**: Proper cover page ordering
- **Series Organization**: Better file naming for series

### 📋 Supported Metadata Fields

#### From OPF Files
- Title, Creator/Author, Publisher
- Series name and issue number
- Description/Summary
- Publication date
- Language and genre
- Custom publisher metadata

#### Generated Metadata
- ComicInfo.xml for comic readers
- Enhanced JSON metadata
- Page count and structure
- Conversion information

### 🚀 Usage

#### Individual Files (v1 compatibility)
```
Drag AZW3 files → Process → Download CBZ
```

#### Enhanced Folders (v2)
```
Drag folders with AZW3+OPF+Cover → Enhanced Processing → Download Rich CBZ
```

### 🔄 Backward Compatibility

- All v1 functionality preserved
- Individual AZW3 files work exactly as before
- Enhanced features only activate with folder uploads
- No breaking changes to existing workflows

### 📁 Example Folder Structure

```
Batman_Year_One/
├── batman_year_one.azw3
├── metadata.opf
└── cover.jpg

Superman_Red_Son/
├── superman_red_son.azw3
├── metadata.opf
└── cover.png
```

### 🎯 Benefits

1. **Richer Metadata**: Full comic book information preserved
2. **Better Organization**: Series and issue tracking
3. **Cover Integration**: Professional comic book appearance
4. **Reader Compatibility**: Standard ComicInfo.xml support
5. **Batch Processing**: Handle multiple enhanced folders
6. **Privacy Maintained**: All processing still client-side

---

## Version 1.0.0 - Initial Release

### Features
- AZW3 to CBZ conversion
- Client-side processing
- Drag and drop interface
- Batch file processing
- Image quality preservation
- Basic metadata extraction