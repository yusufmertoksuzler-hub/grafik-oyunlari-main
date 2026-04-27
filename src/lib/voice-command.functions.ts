
export type VoiceCommandAction =
  | { type: "setTransform"; key: "a" | "b" | "h" | "k"; value: number; message: string }
  | { type: "selectFunction"; functionKey: "linear" | "quadratic" | "cubic" | "absolute" | "sqrt" | "reciprocal" | "sin" | "cos" | "custom"; message: string }
  | { type: "reset"; message: string }
  | { type: "zoom"; direction: "in" | "out"; message: string }
  | { type: "unknown"; message: string };

export const analyzeVoiceCommand = async (data: { command: string }): Promise<VoiceCommandAction> => {
    const command = typeof data?.command === "string" ? data.command.trim().slice(0, 240) : "";
    if (!command) throw new Error("Komut boş olamaz.");

    const apiKey = import.meta.env.VITE_LOVABLE_API_KEY;
    if (!apiKey) return { type: "unknown", message: "AI bağlantısı hazır değil; klasik komut algılama kullanılacak." };

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Türkçe lise matematik uygulaması için sesli komutu analiz et. Yalnız JSON döndür. Şema: {type:'setTransform'|'selectFunction'|'reset'|'zoom'|'unknown', key?:'a'|'b'|'h'|'k', value?:number, functionKey?:'linear'|'quadratic'|'cubic'|'absolute'|'sqrt'|'reciprocal'|'sin'|'cos'|'custom', direction?:'in'|'out', message:string}. Sağa kaydırma h pozitif, sola h negatif, yukarı k pozitif, aşağı k negatif. A/B değerlerini doğrudan sayıya çevir. Yakınlaştır zoom in, uzaklaştır zoom out.",
            },
            { role: "user", content: data.command },
          ],
        }),
      });

      if (!response.ok) return { type: "unknown", message: "AI komutu çözemedi; klasik komut algılama kullanılacak." };

      const result = await response.json();
      const raw = result?.choices?.[0]?.message?.content;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (parsed?.type === "setTransform" && ["a", "b", "h", "k"].includes(parsed.key) && Number.isFinite(Number(parsed.value))) {
        return { type: "setTransform", key: parsed.key, value: Number(parsed.value), message: parsed.message || "AI komutu dönüşüme çevirdi." };
      }
      if (parsed?.type === "selectFunction") {
        const allowed = ["linear", "quadratic", "cubic", "absolute", "sqrt", "reciprocal", "sin", "cos", "custom"];
        if (allowed.includes(parsed.functionKey)) return { type: "selectFunction", functionKey: parsed.functionKey, message: parsed.message || "AI fonksiyonu seçti." };
      }
      if (parsed?.type === "reset") return { type: "reset", message: parsed.message || "AI sıfırlama komutunu algıladı." };
      if (parsed?.type === "zoom" && ["in", "out"].includes(parsed.direction)) return { type: "zoom", direction: parsed.direction, message: parsed.message || "AI yakınlaştırma komutunu algıladı." };
      return { type: "unknown", message: parsed?.message || "Komut anlaşılamadı." };
    } catch (error) {
      console.error("Voice command AI analysis failed", error);
      return { type: "unknown", message: "AI analizi başarısız oldu; klasik komut algılama kullanılacak." };
    }
  });