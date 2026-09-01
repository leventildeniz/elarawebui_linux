"""
Credential lookup helper.

Öncelik sırası:
  1) explicit arg (call-site'tan açıkça verilen değer)
  2) os.environ["ELARA_SECRET_<NAME>"]   (vault'tan namespace'li enjeksiyon)
  3) os.environ["<NAME>"]                (raw isim — agent script'leri için kolaylık)
  4) default

Plaintext asla loglanmaz; missing key durumunda key adı log'a düşer ama değer asla.
"""

from __future__ import annotations
import os
from typing import Optional, Mapping


def get_secret(name: str, explicit: Optional[str] = None, default: Optional[str] = None) -> Optional[str]:
    """Tek bir credential'ı bul. Bulunamazsa default döner."""
    if explicit is not None and str(explicit) != "":
        return str(explicit)
    v = os.environ.get(f"ELARA_SECRET_{name}")
    if v:
        return v
    v = os.environ.get(name)
    if v:
        return v
    return default


def build_credentials(spec: Mapping[str, Optional[str]]) -> dict:
    """
    spec: {"USER": None, "PASS": None, "HOST": "10.0.0.1"}
    → her key için get_secret çalışır; explicit None ise env'den çekilir,
       string verilmişse aynen kalır.
    Dönüş: {key: resolved_value_or_None}
    """
    out = {}
    for k, v in spec.items():
        out[k] = get_secret(k, explicit=v)
    return out
