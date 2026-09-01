// Capability packs seed — extracted from server.mjs (Tur P-1, 2026-05-30)
// Seeds default sectoral packs (NetSec, Social, Cyber, Healthcare, DevOps, Research)
// into capability_packs table. Operators may delete a pack — the slug is added to
// pack_seed_skip and the seeder respects it on future boots.
import path from "node:path";

const DEFAULT_PACK_MODEL = process.env.ELARA_DEFAULT_MODEL || "elara-local";

function defaultInterpreter(projectRoot) {
  return process.env.ELARA_DEFAULT_INTERPRETER
    || path.join(projectRoot, ".venv", "bin", "python");
}

export function buildSystemPacks(projectRoot) {
  const DEFAULT_PACK_INTERPRETER = defaultInterpreter(projectRoot);
  return [
    {
      id: "pack.cyber-security", name: "Cyber Security", sector: "security",
      icon: "Shield", color: "#ef4444",
      description: "Firewall oracle, packet hunter, SIEM analizci — tam SOC kit.",
      action_ids: ["sys.mail.read", "sys.log.analyze", "sys.system.suspend"],
      default_model: DEFAULT_PACK_MODEL, default_interpreter_path: DEFAULT_PACK_INTERPRETER,
    },
    {
      id: "pack.healthcare", name: "Healthcare", sector: "medical",
      icon: "HeartPulse", color: "#10b981",
      description: "Tanı ajanı, laboratuvar araştırmacısı, hasta özeti araçları.",
      action_ids: ["sys.ai.summarize"],
      default_model: DEFAULT_PACK_MODEL, default_interpreter_path: DEFAULT_PACK_INTERPRETER,
    },
    {
      id: "pack.devops", name: "DevOps & SRE", sector: "engineering",
      icon: "Cog", color: "#06b6d4",
      description: "Pipeline tetikleyicileri, log triyajı, olay özetleyici.",
      action_ids: ["sys.log.analyze", "sys.ai.summarize"],
      default_model: DEFAULT_PACK_MODEL, default_interpreter_path: DEFAULT_PACK_INTERPRETER,
    },
    {
      id: "pack.research", name: "Research & Analysis", sector: "knowledge",
      icon: "Microscope", color: "#a855f7",
      description: "Özetleme, mail alımı, bilgi sentezi.",
      action_ids: ["sys.ai.summarize", "sys.mail.read"],
      default_model: DEFAULT_PACK_MODEL, default_interpreter_path: DEFAULT_PACK_INTERPRETER,
    },
    {
      id: "pack.netsec-operator", name: "NetSec Operator", sector: "security",
      icon: "Shield", color: "#dc2626",
      description: "Ağ güvenliği operasyonu: triyaj, paket analizi, zafiyet raporu, ADC / DB / DDoS / DNS / VPN sertleştirme, change request.",
      action_ids: [
        "tool.dns_lookup", "tool.http_probe", "tool.pcap_summary",
        "tool.cve_lookup", "tool.whois_geo", "tool.log_analyze",
        "tool.web_fetch", "tool.ai_summarize", "tool.file_write_safe",
        "tool.shell_exec",
        "tool.f5_nitro", "tool.citrix_adc_nitro", "tool.a10_axapi",
        "tool.paloalto_xmlapi", "tool.cisco_iosxe_restconf",
        "tool.fortimanager_jsonrpc", "tool.checkpoint_smc_login",
        "tool.infoblox_wapi", "tool.bluecat_rest",
        "tool.echo", "tool.timestamp_iso", "tool.file_read_safe", "tool.json_query",
      ],

      skill_ids: [
        "skill.incident-triage", "skill.firewall-rule-review", "skill.firewall-deploy",
        "skill.pcap-narrate", "skill.vuln-write-up", "skill.change-request",
        "skill.compliance-map", "skill.policy-export",
        "skill.adc-tuning", "skill.db-hardening", "skill.ddos-runbook",
        "skill.dns-hardening", "skill.vpn-access-review",
        "skill.markdown-report", "skill.structured-json", "skill.cite-sources",
        "skill.safe-refuse", "skill.tr-en-bridge",
      ],
      brand_keywords: ["checkpoint","fortigate","palo alto","cisco","netscaler","citrix","f5","a10","arbor","wireshark","bluecat","infoblox","cloudflare","ivanti"],
      default_model: DEFAULT_PACK_MODEL, default_interpreter_path: DEFAULT_PACK_INTERPRETER,
    },
    {
      id: "pack.social-producer", name: "Social Producer", sector: "marketing",
      icon: "Megaphone", color: "#8b5cf6",
      description: "Sosyal medya içerik üretimi: takvim, copy düzenleme, hashtag skorlama, zamanlama, görsel kompozisyon, analytics retro, uyumluluk ön-kontrolü.",
      action_ids: [
        "tool.image_compose", "tool.caption_polish",
        "tool.hashtag_score", "tool.engagement_window",
        "tool.web_fetch", "tool.ai_summarize", "tool.file_write_safe",
        "tool.echo", "tool.timestamp_iso", "tool.file_read_safe",
      ],
      skill_ids: [
        "skill.brand-voice", "skill.hook-formula", "skill.caption-localize",
        "skill.hashtag-strategy", "skill.crisis-response", "skill.cta-microcopy",
        "skill.analytics-report", "skill.community-reply", "skill.disclosure-check",
        "skill.content-calendar", "skill.trend-brief",
        "skill.markdown-report", "skill.tr-en-bridge", "skill.safe-refuse",
      ],
      brand_keywords: ["instagram","tiktok","x","twitter","linkedin","youtube","facebook","threads"],
      default_model: DEFAULT_PACK_MODEL, default_interpreter_path: DEFAULT_PACK_INTERPRETER,
    },
    {
      id: "pack.forensics", name: "Network Forensics", sector: "security",
      icon: "Microscope", color: "#14b8a6",
      description: "Olay adli incelemesi: pcap derin analiz, log korelasyonu, IOC çıkarımı, NetSec/SOC devri için anlatılı olay raporu.",
      action_ids: [
        "tool.pcap_summary", "tool.log_analyze", "tool.dns_lookup",
        "tool.whois_geo", "tool.cve_lookup", "tool.http_probe",
        "tool.ai_summarize", "tool.file_write_safe", "tool.web_fetch",
        "tool.echo", "tool.timestamp_iso", "tool.file_read_safe",
      ],
      skill_ids: [
        "skill.incident-triage", "skill.pcap-narrate", "skill.vuln-write-up",
        "skill.ddos-runbook", "skill.markdown-report", "skill.structured-json",
        "skill.cite-sources", "skill.safe-refuse", "skill.tr-en-bridge",
      ],
      brand_keywords: ["wireshark","zeek","suricata","tcpdump","mitre","attck","stix","misp"],
      default_model: DEFAULT_PACK_MODEL, default_interpreter_path: DEFAULT_PACK_INTERPRETER,
    },
  ];
}

export async function seedCapabilityPacks({ pool, migrateReady, projectRoot }) {
  try {
    await migrateReady;
    const SYSTEM_PACKS = [];
    const DEFAULT_PACK_INTERPRETER = defaultInterpreter(projectRoot);
    await pool.query(`CREATE TABLE IF NOT EXISTS pack_seed_skip (id text PRIMARY KEY, deleted_at timestamptz NOT NULL DEFAULT now())`);
    const { rows: skipRows } = await pool.query(`SELECT id FROM pack_seed_skip`);
    const skip = new Set(skipRows.map(r => r.id));
    let inserted = 0;
    for (const p of SYSTEM_PACKS) {
      if (skip.has(p.id)) continue;
      await pool.query(
        `INSERT INTO capability_packs(id,name,sector,description,icon,color,action_ids,skill_ids,brand_keywords,is_system,default_model,default_interpreter_path,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,now())
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name,
           sector=EXCLUDED.sector,
           description=EXCLUDED.description,
           icon=EXCLUDED.icon,
           color=EXCLUDED.color,
           action_ids=EXCLUDED.action_ids,
           skill_ids=EXCLUDED.skill_ids,
           brand_keywords=EXCLUDED.brand_keywords,
           is_system=true,
           updated_at=now()
         WHERE capability_packs.is_system = true`,
        [p.id, p.name, p.sector, p.description, p.icon, p.color,
         JSON.stringify(p.action_ids || []), JSON.stringify(p.skill_ids || []), JSON.stringify(p.brand_keywords || []),
         p.default_model || null, p.default_interpreter_path || null]
      );
      inserted++;
    }
    // Backfill defaults on SYS packs that existed before this column landed.
    await pool.query(
      `UPDATE capability_packs SET default_model = $1
        WHERE is_system = true AND COALESCE(default_model,'') = ''`,
      [DEFAULT_PACK_MODEL]
    ).catch(() => {});
    await pool.query(
      `UPDATE capability_packs SET default_interpreter_path = $1
        WHERE is_system = true AND COALESCE(default_interpreter_path,'') = ''`,
      [DEFAULT_PACK_INTERPRETER]
    ).catch(() => {});
    console.log(`[packs] seeded ${inserted} capability packs (${skip.size} skipped)`);
  } catch (e) { console.error("[packs] seed failed:", e.message); }
}
