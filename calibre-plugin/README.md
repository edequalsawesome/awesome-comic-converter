# AZW3→CBZ (Comics) — Calibre Plugin

Bulk-convert selected AZW3 books to CBZ with ComicInfo.xml. Uses Calibre’s conversion pipeline and rebuilds CBZ with STORE compression.

## Features
- Toolbar action: “AZW3→CBZ (Comics)”
- Bulk conversion of selected books
- ComicInfo.xml generation from Calibre metadata
- STORE compression for CBZ (no recompression of images)
- Optional auto-convert on import (settings)

## Install
1. Zip the `azw3_to_cbz` folder (contents at top level of zip).
2. Calibre → Preferences → Plugins → Load plugin from file → select the zip → restart Calibre.
3. Customize toolbar to add “AZW3→CBZ (Comics)”.

## Settings
- Include ComicInfo.xml
- Insert Calibre cover as first page (if available) [placeholder]
- Use STORE compression
- Auto-convert on import

## Notes
- Requires Calibre 6+.
- Conversion runs via Calibre jobs; see the jobs panel for progress.


