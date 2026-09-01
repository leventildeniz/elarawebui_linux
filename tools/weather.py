#!/usr/bin/env python3
import sys
import json
import urllib.request
import urllib.error

def main():
    # LLM'den gelen parametreyi oku
    # Elara python adapter query'yi sys.argv[1] (veya bazen argüman olarak) verir
    query_str = "{}"
    if len(sys.argv) > 1:
        query_str = sys.argv[1]
    
    try:
        params = json.loads(query_str)
    except Exception:
        params = {}

    location = params.get("location")
    
    # Kullanıcı lokasyon vermediyse IP üzerinden (ip-api) otomatik lokasyon bul
    if not location:
        try:
            req = urllib.request.Request("http://ip-api.com/json/", headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                ip_data = json.loads(response.read().decode())
                location = ip_data.get("city") or ip_data.get("country")
        except Exception:
            pass
            
    # Hala bulamadıysa fallback
    if not location:
        location = "Istanbul"

    # Wttr.in üzerinden dinamik lokasyon havasını çek
    # (Boşlukları url encode etmeye dikkat edelim)
    safe_location = urllib.parse.quote(location)
    url = f"https://wttr.in/{safe_location}?format=j1"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            
            # Wttr sonucunu basitleştir (LLM token israfı yapmasın)
            current = data.get("current_condition", [{}])[0]
            if current:
                result = {
                    "location": location,
                    "condition": current.get("lang_tr", [{}])[0].get("value") or current.get("weatherDesc", [{}])[0].get("value"),
                    "temperature": f"{current.get('temp_C')}°C",
                    "feels_like": f"{current.get('FeelsLikeC')}°C",
                    "humidity": f"%{current.get('humidity')}",
                    "wind": f"{current.get('windspeedKmph')} km/h"
                }
                print(json.dumps(result))
            else:
                print(json.dumps({"error": f"Hava durumu verisi okunamadı ({location})"}))
    except Exception as e:
        print(json.dumps({"error": f"Hava durumu servisine erişilemedi: {str(e)}"}))

if __name__ == "__main__":
    main()
