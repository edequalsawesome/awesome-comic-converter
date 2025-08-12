from calibre.customize import FileTypePlugin
from calibre.utils.config import JSONConfig
from .convert import enqueue_convert_job


PREFS = JSONConfig('plugins/azw3_to_cbz')


class AutoAzw3Cbz(FileTypePlugin):
    name = 'Auto AZW3→CBZ'
    description = 'Automatically convert AZW3 to CBZ after import (if enabled in settings)'
    file_types = {'azw3'}
    on_postimport = True
    version = (1, 0, 0)

    # calibre will call this postimport hook after a format is added
    def postimport(self, book_id, book_format, db):
        if not PREFS.get('auto_on_import', False):
            return
        try:
            from calibre.gui2.ui import get_gui
            gui = get_gui()
            if gui is None:
                return
            enqueue_convert_job(gui, db, book_id, prefs=PREFS)
        except Exception:
            pass


