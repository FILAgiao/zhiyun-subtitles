"""Allowlisted public website and portal assets; private data stays behind authenticated APIs."""
from urllib.parse import parse_qs, urlsplit

PUBLIC_PAGE_FILES={
    '/':'download.html',
    '/index.html':'download.html',
    '/download':'download.html',
    '/download/':'download.html',
    '/download.html':'download.html',
    '/download.css':'download.css',
    '/site.js':'site.js',
    '/privacy':'privacy.html',
    '/privacy.html':'privacy.html',
    **{route:page+'.html' for page in ('study','account') for route in ('/'+page,'/'+page+'/','/'+page+'.html')},
    **{'/'+name:name for name in ('clips.css','clips.js','portal.css','portal.js','study.css','study.js','account.css','account.js')},
    '/landing/brand-logo.png':'landing/brand-logo.png',
    '/landing/plugin-qr.png':'landing/plugin-qr.png',
    **{'/landing/image-'+number+'.webp':'landing/image-'+number+'.webp' for number in ['02','01','03','04','05','06']},
}


ACCOUNT_REGISTRATION_MARKER = b'data-mail-registration="check"'


def account_page_for_request(content, request_path, capabilities):
    if parse_qs(urlsplit(request_path).query, keep_blank_values=True).get('tab', [''])[0] == 'recharge':
        return content
    available = capabilities.get('registration') is True and capabilities.get('mail_configured') is True
    state = b'data-mail-registration="available"' if available else b'data-mail-registration="unavailable"'
    return content.replace(ACCOUNT_REGISTRATION_MARKER, state, 1)


def public_page_file(request_path):
    # Query strings from QR scanners/referrers do not turn a public page into an API call.
    return PUBLIC_PAGE_FILES.get(urlsplit(request_path).path)
