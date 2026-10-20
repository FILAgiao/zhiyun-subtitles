"""Compatibility entry point: publish public page plus complete client artifacts."""
try:
    from .publish_public_page import patch_public_page_routes as patch_download_routes,publish
except ImportError:
    from publish_public_page import patch_public_page_routes as patch_download_routes,publish

if __name__=='__main__':publish(include_client=True)
