from calibre.gui2.actions import InterfaceAction
from calibre.gui2 import error_dialog
from calibre.utils.config import JSONConfig
from .convert import enqueue_convert_job
from .config import PluginConfig


PREFS = JSONConfig('plugins/azw3_to_cbz')
PREFS.defaults['include_comicinfo'] = True
PREFS.defaults['insert_cover_as_page'] = True
PREFS.defaults['outer_zip_store'] = True
PREFS.defaults['auto_on_import'] = False
PREFS.defaults['naming_scheme'] = '{series} #{series_index} - {title}'


class Azw3ToCbzAction(InterfaceAction):
    name = 'AZW3→CBZ'
    action_spec = ('AZW3→CBZ (Comics)', None, 'Convert selected AZW3 to CBZ', None)

    def genesis(self):
        self.qaction.triggered.connect(self.run_bulk)

    def run_bulk(self):
        db = self.gui.current_db
        ids = list(self.gui.library_view.get_selected_ids())
        if not ids:
            error_dialog(self.gui, 'No selection', 'Select at least one book.', show=True)
            return
        for book_id in ids:
            self._convert_one(db, book_id)

    def _convert_one(self, db, book_id):
        # Skip if no AZW3
        azw3_path = db.format_abspath(book_id, 'AZW3')
        if not azw3_path:
            return
        enqueue_convert_job(self.gui, db, book_id, prefs=PREFS)

    # Preferences UI
    def config_widget(self):
        return PluginConfig(PREFS)

    def save_settings(self, config_widget):
        config_widget.save()


