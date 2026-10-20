"""Allowlisted public introduction page. No account or model calls are involved."""
from urllib.parse import urlsplit

PUBLIC_PAGE_FILES={
    '/':'download.html',
    '/index.html':'download.html',
    '/download':'download.html',
    '/download/':'download.html',
    '/download.html':'download.html',
    '/download.css':'download.css',
    '/landing/brand-logo.png':'landing/brand-logo.png',
    **{'/landing/image-'+number+'.webp':'landing/image-'+number+'.webp' for number in ['02','01','03','04','05','06']},
}


def public_page_file(request_path):
    # Query strings from QR scanners/referrers do not turn a public page into an API call.
    return PUBLIC_PAGE_FILES.get(urlsplit(request_path).path)
