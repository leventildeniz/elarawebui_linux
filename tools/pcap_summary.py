#!/usr/bin/env python3
# @tool: pcap_summary
# @description: PCAP/pcapng dosyasını özetler (akışlar, protokol dağılımı, en yoğun konuşan host'lar).
# @args: {"path":"string","max_packets":"number"}
# @category: NetSec
# @icon: Activity
# @color: #8b5cf6
"""pcap_summary — pcap → {packet_count, flows[…], protocols{…}, top_talkers[…]}.

stdin JSON: {path, max_packets?}
- path must be inside tools/_workdir/, /mnt/documents/, or ~/Downloads/.
- File size cap 200MB. max_packets default 5000, hard cap 100000.
- Requires scapy; falls back to missing_dependency.
"""
import json
import os
import sys

ALLOWED_ROOTS = []


def _init_roots():
    global ALLOWED_ROOTS
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    home = os.path.expanduser("~")
    ALLOWED_ROOTS = [
        os.path.realpath(os.path.join(repo, "tools", "_workdir")),
        os.path.realpath("/mnt/documents"),
        os.path.realpath(os.path.join(home, "Downloads")),
    ]


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def _allowed(path: str) -> bool:
    rp = os.path.realpath(path)
    for root in ALLOWED_ROOTS:
        if rp == root or rp.startswith(root + os.sep):
            return True
    return False


def main() -> None:
    _init_roots()
    p = _read()
    path = str(p.get("path") or "").strip()
    if not path:
        print(json.dumps({"ok": False, "reason": "missing_path"})); return
    if not _allowed(path):
        print(json.dumps({"ok": False, "reason": "path_not_allowed",
                          "allowed_roots": ALLOWED_ROOTS})); return
    if not os.path.isfile(path):
        print(json.dumps({"ok": False, "reason": "file_not_found"})); return

    size = os.path.getsize(path)
    if size > 200 * 1024 * 1024:
        print(json.dumps({"ok": False, "reason": "file_too_large",
                          "bytes": size, "max": 200 * 1024 * 1024})); return

    max_packets = max(1, min(100_000, int(p.get("max_packets") or 5000)))

    try:
        from scapy.all import PcapReader, IP, IPv6, TCP, UDP, ICMP
    except ImportError:
        print(json.dumps({"ok": False, "reason": "missing_dependency",
                          "detail": "pip install scapy"})); return

    flows: dict = {}
    protocols = {"tcp": 0, "udp": 0, "icmp": 0, "other": 0, "ipv6": 0}
    talkers: dict = {}
    n = 0

    try:
        with PcapReader(path) as reader:
            for pkt in reader:
                if n >= max_packets:
                    break
                n += 1
                src = dst = None
                proto = "other"
                sport = dport = 0

                if IP in pkt:
                    src = pkt[IP].src
                    dst = pkt[IP].dst
                elif IPv6 in pkt:
                    src = pkt[IPv6].src
                    dst = pkt[IPv6].dst
                    protocols["ipv6"] += 1

                if TCP in pkt:
                    proto = "tcp"
                    sport = int(pkt[TCP].sport)
                    dport = int(pkt[TCP].dport)
                    protocols["tcp"] += 1
                elif UDP in pkt:
                    proto = "udp"
                    sport = int(pkt[UDP].sport)
                    dport = int(pkt[UDP].dport)
                    protocols["udp"] += 1
                elif ICMP in pkt:
                    proto = "icmp"
                    protocols["icmp"] += 1
                else:
                    protocols["other"] += 1

                if src and dst:
                    key = (src, dst, proto, sport, dport)
                    f = flows.get(key)
                    if f is None:
                        f = {"src": src, "dst": dst, "proto": proto,
                             "sport": sport, "dport": dport, "pkts": 0, "bytes": 0}
                        flows[key] = f
                    f["pkts"] += 1
                    f["bytes"] += int(len(pkt))
                    talkers[src] = talkers.get(src, 0) + 1
    except Exception as e:
        print(json.dumps({"ok": False, "reason": "pcap_parse_failed",
                          "detail": str(e)[:200]})); return

    flow_list = sorted(flows.values(), key=lambda f: f["bytes"], reverse=True)[:200]
    top_talkers = sorted(
        [{"src": k, "pkts": v} for k, v in talkers.items()],
        key=lambda x: x["pkts"], reverse=True,
    )[:20]

    print(json.dumps({
        "ok": True,
        "packet_count": n,
        "flows": flow_list,
        "protocols": protocols,
        "top_talkers": top_talkers,
        "file_bytes": size,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
