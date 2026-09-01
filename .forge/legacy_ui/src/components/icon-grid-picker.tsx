// Lucide icon grid picker — geniş ops/security/social paleti.
import {
  Bot, Cpu, Brain, Shield, Zap, Database, Globe, Terminal, Eye, Radar, Satellite,
  Lock, Key, Bug, Microscope, Network, Server, Code, Workflow, GitBranch, Activity,
  AlertTriangle, Search, Skull, Crosshair, Flame, Anchor, Compass, Crown, Gem,
  Hexagon, Atom, Beaker, Binary, BookLock, Boxes, Cloud, Container, Fingerprint,
  Flag, Ghost, Rocket, Telescope,
  // security & ops
  ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestion, KeyRound, Unlock, EyeOff,
  Scan, ScanFace, ScanLine, Radio, Wifi, WifiOff, Antenna, Webhook, Plug,
  HardDrive, Cog, Settings2, Wrench, Hammer, Pickaxe, Bomb, Swords,
  // data & flow
  Layers, LayoutGrid, Sigma, Variable, Hash, FileCode, FileSearch, FileLock,
  Folder, FolderTree, FolderGit2, FolderKey, FolderLock, FolderOpen,
  CircuitBoard, Cable, MemoryStick, SquareTerminal,
  // intel & ai
  Lightbulb, Sparkles, Wand2, Bookmark, BookOpen, BookMarked, ScrollText,
  Brackets, Braces, Pi, FunctionSquare,
  // social media & content
  MessageCircle, MessageSquare, Mail, Send, Megaphone, Mic, MicVocal,
  Video, Film, Camera, ImagePlus, Image as ImageIcon, Music, Headphones,
  ThumbsUp, Heart, Star, Bookmark as BookmarkIcon, Share2,
  Youtube, Twitch, Twitter, Linkedin, Github, Instagram, Facebook,
  Newspaper, Rss, AtSign, Hash as HashIcon,
  // analytics
  BarChart3, BarChart4, LineChart, PieChart, TrendingUp, TrendingDown, Gauge,
  Target, Award, Trophy,
  // misc fun
  Coffee, Banana, Carrot, Cherry, IceCream, Pizza, Croissant,
  Sun, Moon, Star as StarIcon, CloudLightning, Snowflake, Mountain,
  Bird, Cat, Dog, Fish, Rabbit, Squirrel, Turtle,
} from "lucide-react";

export const AGENT_ICON_LOOKUP: Record<string, typeof Bot> = {
  Bot, Cpu, Brain, Shield, Zap, Database, Globe, Terminal, Eye, Radar, Satellite,
  Lock, Key, Bug, Microscope, Network, Server, Code, Workflow, GitBranch, Activity,
  AlertTriangle, Search, Skull, Crosshair, Flame, Anchor, Compass, Crown, Gem,
  Hexagon, Atom, Beaker, Binary, BookLock, Boxes, Cloud, Container, Fingerprint,
  Flag, Ghost, Rocket, Telescope,
  ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestion, KeyRound, Unlock, EyeOff,
  Scan, ScanFace, ScanLine, Radio, Wifi, WifiOff, Antenna, Webhook, Plug,
  HardDrive, Cog, Settings2, Wrench, Hammer, Pickaxe, Bomb, Swords,
  Layers, LayoutGrid, Sigma, Variable, Hash, FileCode, FileSearch, FileLock,
  Folder, FolderTree, FolderGit2, FolderKey, FolderLock, FolderOpen,
  CircuitBoard, Cable, MemoryStick, SquareTerminal,
  Lightbulb, Sparkles, Wand2, Bookmark, BookOpen, BookMarked, ScrollText,
  Brackets, Braces, Pi, FunctionSquare,
  MessageCircle, MessageSquare, Mail, Send, Megaphone, Mic, MicVocal,
  Video, Film, Camera, ImagePlus, ImageIcon, Music, Headphones,
  ThumbsUp, Heart, Star, BookmarkIcon, Share2,
  Youtube, Twitch, Twitter, Linkedin, Github, Instagram, Facebook,
  Newspaper, Rss, AtSign, HashIcon,
  BarChart3, BarChart4, LineChart, PieChart, TrendingUp, TrendingDown, Gauge,
  Target, Award, Trophy,
  Coffee, Banana, Carrot, Cherry, IceCream, Pizza, Croissant,
  Sun, Moon, StarIcon, CloudLightning, Snowflake, Mountain,
  Bird, Cat, Dog, Fish, Rabbit, Squirrel, Turtle,
};

export const AGENT_ICON_NAMES = Object.keys(AGENT_ICON_LOOKUP);

interface Props {
  value: string;
  onChange: (name: string) => void;
  color?: string;
}

export function IconGridPicker({ value, onChange, color = "var(--primary)" }: Props) {
  return (
    <div className="grid grid-cols-12 gap-1 p-2 rounded-md border border-border bg-card/40 max-h-64 overflow-auto">
      {AGENT_ICON_NAMES.map((n) => {
        const Icon = AGENT_ICON_LOOKUP[n];
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            title={n}
            onClick={() => onChange(n)}
            className={`h-8 w-8 rounded flex items-center justify-center transition-all ${
              active ? "bg-primary/15 ring-1 ring-primary scale-110" : "hover:bg-muted/40"
            }`}
          >
            <Icon className="h-4 w-4" style={{ color: active ? color : "currentColor" }} />
          </button>
        );
      })}
    </div>
  );
}
