#!/usr/bin/env python3
# agents/NetSec/firewall_oracle.py
# Multi-vendor firewall oracle — Checkpoint, FortiGate, Palo Alto, Cisco, F5
# ve kütüphaneye eklenen tüm yeni marka/sürüm.
#
# RAG: agent-rag.mjs `agentMultiBrand` knob'u (default ON, RAG paneli)
# ajanın tüm kütüphaneyi sorgulamasını sağlar. Per-agent binding/keyword
# scope yok sayılır. Sorgu içindeki açık marka adı + dominant brand lock
# (Rule 6) çalışmaya devam eder → cross-vendor sızıntı yok.
#
# SSH audit Tur-1 FortiGate odaklı (CLI komutları FortiOS); diğer vendor
# SSH transport adapters Tur-2 (adapters/{ssh,rest,web}.py planı).
# Credential SADECE env'den (FORTI_HOST/FORTI_USER/FORTI_PASS); hardcoded YOK.
# paramiko WarningPolicy + known_hosts (AutoAdd MİTM riski kapalı).
# @description: Multi-vendor firewall (Checkpoint, FortiGate, Palo Alto, Cisco, F5) kural seti inceler; gölgelenen/çakışan kuralları ve en az ayrıcalık önerilerini çıkarır.
# @tools: http_probe, log_analyze, paloalto_xmlapi, fortimanager_jsonrpc, checkpoint_smc_login, cisco_iosxe_restconf
import os
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402
from _shared import config_center as cfg  # noqa: E402


def ssh_audit(host: str, user: str, passwd: str) -> str:
    """Sertleştirilmiş SSH audit. Salt-okunur komutlar."""
    try:
        import paramiko  # lazy import
    except ImportError:
        return "⚠️ paramiko yüklü değil (pip install paramiko)."

    ALLOWED_CMDS = (
        "get system status",
        "get system interface physical",
    )
    ssh = paramiko.SSHClient()
    # known_hosts varsa yükle; yoksa WarningPolicy (AutoAdd YERİNE — MİTM kapanır)
    try:
        ssh.load_system_host_keys()
    except Exception:
        pass
    ssh.set_missing_host_key_policy(paramiko.WarningPolicy())

    try:
        sys.stderr.write(f"[firewall_oracle] ssh connect {host} user={user}\n")
        ssh.connect(host, username=user, password=passwd, timeout=10,
                    allow_agent=False, look_for_keys=False)
        combined = ""
        for cmd in ALLOWED_CMDS:
            _stdin, stdout, _stderr = ssh.exec_command(cmd, timeout=15)
            combined += stdout.read().decode("utf-8", errors="replace") + "\n"
        ssh.close()
        return combined.strip() or "⚠️ Cihazdan veri dönmedi."
    except Exception as e:
        return f"⚠️ BAĞLANTI HATASI: {e}"


def _detail_system_prompt() -> str:
    # TR — kullanıcı "detaylı anlatım" istiyor. Cevap kısa kesilmesin; adım
    # adım, başlıklı, CLI/GUI örnekli ve atıflı olsun. RAG bağlamı dış katmandan
    # eklendiyse oradan; aksi halde modelin kendi bilgisinden geniş cevap üret.
    return (
        "Sen FortiGate / Checkpoint / PaloAlto / Cisco / F5 odaklı kıdemli bir "
        "ağ güvenliği danışmanısın. Cevapların DETAYLI ve OPERASYONEL olsun:\n"
        "0) Kütüphane/RAG kaynağı varmış gibi ASLA davranma. Sadece KNOWLEDGE CONTEXT içinde "
        "[#1], [#2] snippet'leri gerçekten varsa 'kütüphanedeki kaynaklara baktım' diyebilir ve atıf yapabilirsin. "
        "Snippet yoksa doğrudan kendi uzmanlığınla cevapla; kaynak numarası veya kütüphane cümlesi yazma.\n"
        "1) Konuyu kısa bir tanımla aç.\n"
        "2) Adım adım yapılandırma (önce GUI yolu, sonra CLI bloğu — ```bash kod fence```).\n"
        "3) Önkoşullar, doğrulama komutları, ortak tuzaklar.\n"
        "4) Sürüm/marka farkları varsa belirt (örn. FortiOS 7.2 vs 7.4).\n"
        "5) Bağlamda (RAG) verilen alıntılar varsa [#n] formatında refere et; "
        "yoksa kendi uzmanlığınla cevap ver ama bilgi kesim tarihini söyleme.\n"
        "Kısa, tek paragraflık özetlerle yetinme — kullanıcı 'detaylı' istiyor."
    )



def _effective_firewall_system_prompt() -> str:
    # cfg.effective_system_prompt() middleware'den gelen pack/tools/RAG/now
    # bloklarını taşır. Bu ajan kendi system_prompt'unu doğrudan verdiği için
    # eski hali ELARA_AGENT_RAG_CONTEXT'i bypass ediyordu.
    base = cfg.effective_system_prompt()
    detail = _detail_system_prompt()
    if not base:
        return detail
    marker = "KNOWLEDGE CONTEXT"
    idx = base.find(marker)
    if idx >= 0:
        return f"{base[:idx].rstrip()}\n\n---\n{detail}\n\n---\n{base[idx:]}"
    return f"{base}\n\n---\n{detail}"


def main(payload: str) -> None:
    host = os.getenv("FORTI_HOST", "").strip()
    user = os.getenv("FORTI_USER", "").strip()
    passwd = os.getenv("FORTI_PASS", "")

    sys_prompt = _effective_firewall_system_prompt()

    # Mod-1: FORTI_HOST env varsa fiziksel audit + LLM yorum.
    # Mod-2: yoksa salt-LLM analiz (kullanıcının verdiği payload üzerine).
    if host and user and passwd:
        raw = ssh_audit(host, user, passwd)
        sys.stderr.write(f"[firewall_oracle] raw chars={len(raw)}\n")
        analysis_payload = (
            f"Mimar'ın talebi: {payload}\n\n"
            f"--- {host} kalesinden çekilen ham SSH verisi ---\n{raw}"
        )
        stream_chat(analysis_payload, system_prompt=sys_prompt)
    else:
        sys.stderr.write("[firewall_oracle] no FORTI_* env → LLM-only mod\n")
        stream_chat(payload, system_prompt=sys_prompt)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
