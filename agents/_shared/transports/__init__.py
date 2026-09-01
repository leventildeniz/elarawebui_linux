"""
Elara transports — ortak bağlantı katmanı.

Her adapter:
  • credential'ı önce çağrı arg'ından, sonra os.environ['ELARA_SECRET_<NAME>']
    veya os.environ['<NAME>']'den okur (vault enjeksiyonu),
  • output'u redaction filter'dan geçirilebilsin diye plain dict döner,
  • destructive op için `requires_approval=True` flag'i set eder,
  • SSL doğrulamasını opt-in olarak gevşetir (default verify=True).

Modüller:
  ssh         — async SSH (asyncssh, TOFU host key cache)
  https       — REST/HTTPS (httpx, opt-in tls_insecure)
  checkpoint  — Checkpoint Smart Management (CPM web_api/, sid lifecycle)
"""

from .creds import get_secret, build_credentials

__all__ = ["get_secret", "build_credentials"]
