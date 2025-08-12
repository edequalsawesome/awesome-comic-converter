from qt.core import QWidget, QGridLayout, QCheckBox, QLineEdit, QLabel


class PluginConfig(QWidget):
    def __init__(self, prefs, parent=None):
        super().__init__(parent)
        self.prefs = prefs
        self._build()

    def _build(self):
        l = QGridLayout(self)
        row = 0

        self.include_comicinfo = QCheckBox('Include ComicInfo.xml')
        self.include_comicinfo.setChecked(self.prefs.get('include_comicinfo', True))
        l.addWidget(self.include_comicinfo, row, 0, 1, 2)
        row += 1

        self.insert_cover = QCheckBox('Insert Calibre cover as first page (if available)')
        self.insert_cover.setChecked(self.prefs.get('insert_cover_as_page', True))
        l.addWidget(self.insert_cover, row, 0, 1, 2)
        row += 1

        self.outer_store = QCheckBox('Use STORE compression for CBZ')
        self.outer_store.setChecked(self.prefs.get('outer_zip_store', True))
        l.addWidget(self.outer_store, row, 0, 1, 2)
        row += 1

        l.addWidget(QLabel('Naming scheme for downloaded files (unused for attached format):'), row, 0, 1, 2)
        row += 1
        self.naming_scheme = QLineEdit(self.prefs.get('naming_scheme', '{series} #{series_index} - {title}'))
        l.addWidget(self.naming_scheme, row, 0, 1, 2)
        row += 1

        self.auto_on_import = QCheckBox('Automatically convert AZW3 to CBZ on import')
        self.auto_on_import.setChecked(self.prefs.get('auto_on_import', False))
        l.addWidget(self.auto_on_import, row, 0, 1, 2)

        l.setRowStretch(row + 1, 1)

    def save(self):
        self.prefs['include_comicinfo'] = bool(self.include_comicinfo.isChecked())
        self.prefs['insert_cover_as_page'] = bool(self.insert_cover.isChecked())
        self.prefs['outer_zip_store'] = bool(self.outer_store.isChecked())
        self.prefs['naming_scheme'] = str(self.naming_scheme.text())
        self.prefs['auto_on_import'] = bool(self.auto_on_import.isChecked())


