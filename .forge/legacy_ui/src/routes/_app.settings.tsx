// src/routes/_app.settings.tsx
import React, { useState, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ShieldCheck, Cpu, Globe, Lock, User, Bell, Palette } from 'lucide-react';
import { PageShell, PageHeader } from '@/components/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// --- SecuritySettings Component ---
const SecuritySettings = () => {
  const [config, setConfig] = useState({
    httpsPort: '',
    httpPort: '',
    certFile: '',
    keyFile: '',
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  useEffect(() => {
    fetch('/api/system/proxy-config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(() => setStatus({ type: 'error', msg: 'Konfigürasyon yüklenemedi.' }));
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch('/api/system/proxy-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setStatus({ type: 'success', msg: 'Ayarlar uygulandı ve Proxy restart edildi!' });
      } else {
        throw new Error('Güncelleme başarısız oldu.');
      }
    } catch (e: any) {
      setStatus({ type: 'error', msg: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm space-y-4">
          <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
            <Globe className="w-4 h-4" /> Network Ports
          </h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40 block">HTTPS Port</label>
              <input 
                type="number" 
                value={config.httpsPort} 
                onChange={e => setConfig({...config, httpsPort: parseInt(e.target.value)})}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40 block">HTTP Port</label>
              <input 
                type="number" 
                value={config.httpPort} 
                onChange={e => setConfig({...config, httpPort: parseInt(e.target.value)})}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 outline-none transition-all"
              />
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm space-y-4">
          <h3 className="text-sm font-medium text-white/60 flex items-center gap-2">
            <Lock className="w-4 h-4" /> SSL Certificates
          </h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-white/40 block">Certificate Path (.pem)</label>
              <input 
                type="text" 
                value={config.certFile} 
                onChange={e => setConfig({...config, certFile: e.target.value})}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 outline-none transition-all text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-white/40 block">Private Key Path (.pem)</label>
              <input 
                type="text" 
                value={config.keyFile} 
                onChange={e => setConfig({...config, keyFile: e.target.value})}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white focus:border-blue-500 outline-none transition-all text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
        <div className="text-sm text-blue-200/70">
          Değişiklikleri uygulamak için servisi yeniden başlatmanız gerekir.
        </div>
        <button 
          onClick={handleSave}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all flex items-center gap-2"
        >
          {loading ? 'Uygulanıyor...' : 'Apply & Restart Proxy'}
        </button>
      </div>
      
      {status && (
        <div className={`p-3 rounded-lg text-sm text-center animate-in zoom-in duration-300 ${status.type === 'success' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
          {status.msg}
        </div>
      )}
    </div>
  );
};

// --- Main SettingsPage Component ---
function SettingsPage() {
  return (
    <PageShell>
      <PageHeader title="System Settings" />
      <div className="p-6 max-w-6xl mx-auto">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="grid grid-cols-4 w-full max-w-2xl">
            <TabsTrigger value="general" className="gap-2">
              <User className="w-4 h-4" /> General
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <ShieldCheck className="w-4 h-4" /> Security
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-2">
              <Palette className="w-4 h-4" /> Appearance
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="w-4 h-4" /> Notifications
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="animate-in fade-in duration-300">
            <div className="p-8 rounded-2xl bg-white/5 border border-white/10 text-center text-muted-foreground">
              General settings are coming soon.
            </div>
          </TabsContent>

          <TabsContent value="security">
            <SecuritySettings />
          </TabsContent>

          <TabsContent value="appearance" className="animate-in fade-in duration-300">
            <div className="p-8 rounded-2xl bg-white/5 border border-white/10 text-center text-muted-foreground">
              Appearance settings are coming soon.
            </div>
          </TabsContent>

          <TabsContent value="notifications" className="animate-in fade-in duration-300">
            <div className="p-8 rounded-2xl bg-white/5 border border-white/10 text-center text-muted-foreground">
              Notification settings are coming soon.
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});
