import os
import io
from zipfile import ZipFile, ZIP_STORED
from calibre.gui2 import info_dialog
from calibre.ebooks.conversion.plumber import Plumber
from calibre.ebooks.metadata.book.base import Metadata


def _build_comicinfo_xml(mi: Metadata, page_count: int) -> str:
    def esc(s):
        if not s:
            return ''
        return (
            s.replace('&', '&amp;')
             .replace('<', '&lt;')
             .replace('>', '&gt;')
             .replace("'", '&apos;')
             .replace('"', '&quot;')
        )

    series_index = ''
    if mi.series_index is not None:
        try:
            series_index = str(int(mi.series_index))
        except Exception:
            series_index = str(mi.series_index)

    year = mi.pubdate.year if mi.pubdate else ''
    month = mi.pubdate.month if mi.pubdate else ''
    day = mi.pubdate.day if mi.pubdate else ''

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>{esc(mi.title)}</Title>
  <Writer>{esc(', '.join(mi.authors or []))}</Writer>
  <Publisher>{esc(mi.publisher or '')}</Publisher>
  <Summary>{esc(mi.comments or '')}</Summary>
  <LanguageISO>{esc(mi.language or '')}</LanguageISO>
  <Genre>{esc(', '.join(mi.tags or []))}</Genre>
  <Series>{esc(mi.series or '')}</Series>
  <Number>{esc(series_index)}</Number>
  <PageCount>{page_count}</PageCount>
  <Year>{year}</Year>
  <Month>{month}</Month>
  <Day>{day}</Day>
  <Web>{esc(mi.identifiers.get('url', '') if mi.identifiers else '')}</Web>
  <Format>Digital</Format>
  <Notes>Converted by AZW3→CBZ plugin</Notes>
</ComicInfo>'''


def enqueue_convert_job(gui, db, book_id, prefs):
    def worker_func(job):
        _convert_to_cbz(db, book_id, prefs, job)

    gui.job_manager.run_job(worker_func, 'AZW3→CBZ', args=(), kwargs={})


def _convert_to_cbz(db, book_id, prefs, job):
    # Resolve AZW3
    src = db.format_abspath(book_id, 'AZW3')
    if not src:
        return

    # Use Calibre’s converter to get CBZ content faithfully
    opts = job.gui.job_manager.conversion_defaults('cbz') if hasattr(job.gui, 'job_manager') else None
    plumber = Plumber(src, 'cbz', opts, log=job)
    plumber.run()
    out_path = plumber.dest_path

    # If we want to enforce STORE and inject ComicInfo.xml, rebuild the CBZ
    with open(out_path, 'rb') as f:
        data = f.read()

    # Load book metadata
    mi = db.get_metadata(book_id, index_is_id=True)

    rebuilt = io.BytesIO()
    with ZipFile(rebuilt, 'w', compression=ZIP_STORED) as z:
        # Copy entries from generated CBZ
        with ZipFile(io.BytesIO(data), 'r') as srczip:
            names = srczip.namelist()
            for name in names:
                z.writestr(name, srczip.read(name))

        # Optionally add ComicInfo.xml
        if prefs.get('include_comicinfo', True):
            # Guess page count by counting image files
            page_count = sum(1 for n in names if n.lower().split('.')[-1] in ('jpg', 'jpeg', 'png', 'gif', 'webp'))
            z.writestr('ComicInfo.xml', _build_comicinfo_xml(mi, page_count))

    rebuilt.seek(0)
    db.add_format(book_id, 'CBZ', rebuilt.getvalue(), index_is_id=True)

    # Optionally notify (non-blocking)
    try:
        info_dialog(None, 'AZW3→CBZ', f'Converted: {mi.title}', show=False)
    except Exception:
        pass


