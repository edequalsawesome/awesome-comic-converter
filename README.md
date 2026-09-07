# Awesome Comic Converter

An offline browser tool for extracting AZW3 comic image resources into CBZ files. It bundles JSZip 3.10.1 locally, so conversion does not need a network connection.

```sh
npm start
npm test
npm run lint
```

Open `http://127.0.0.1:8000`. Node 18+ is required for the test runner.

Drop AZW3 files or a folder. Each AZW3 becomes a separate job; a matching `book.opf` sidecar is used when unambiguous and a matching `book.jpg/png/gif` is offered as a selectable cover. For a one-book folder, `metadata.opf` and `cover.*` are also accepted. Results append to the current list. **Clear results** explicitly discards retained downloads; if the 512 MiB retained-output limit is reached, save completed files, then clear results before continuing. That cap covers completed CBZs only: parsing, cover previews, rebuilds, and Download All can temporarily use additional browser memory.

The parser copies JPEG, PNG, and GIF resource bytes without re-encoding. AZW3 resource order is not verified logical reading order. The default filter removes a designated thumbnail and tiny ancillary images when larger pages exist; each result can restore them or choose another cover. Embedded metadata and valid OPF fields populate `ComicInfo.xml`; malformed OPF leaves embedded metadata in place.

Text encryption, text/spine reconstruction, and joint MOBI6/KF8 containers are unsupported. The app may still extract readable image resources from files whose text-encryption field is set; it does not decrypt text. Verify a converted book before removing an original.

`vendor/jszip.min.js` is JSZip 3.10.1 (MIT). It was copied from the verified npm release; SHA-512: `5cc55ddbc175a07fceef57f3c019d5ec7b9c2f1570b717f6e9757c3f8c0f936e840f1b8667dd4df1bb0eb6d9a7a267020f7092e593112f9d07d0680e1ef7a0b6`. Its license is [vendor/jszip-LICENSE.markdown](vendor/jszip-LICENSE.markdown).
