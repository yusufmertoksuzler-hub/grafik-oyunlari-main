import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeVoiceCommand, type VoiceCommandAction } from "@/lib/voice-command.functions";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Fonksiyon Dönüşümleri Öğrenme Aracı" },
      {
        name: "description",
        content: "Lise düzeyi fonksiyon dönüşümlerini grafik, sürgüler, görevler ve sesli komutlarla öğrenin.",
      },
    ],
  }),
});

type FunctionKey = "linear" | "quadratic" | "cubic" | "absolute" | "sqrt" | "reciprocal" | "sin" | "cos" | "custom";
type Transform = { a: number; b: number; h: number; k: number };
type ViewState = { scale: number; offsetX: number; offsetY: number };
type Task = { prompt: string; target: Partial<Transform>; hint: string; solution: Transform; functionKey?: FunctionKey };

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
};
type SpeechRecognitionEventLike = { results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }> };
type SpeechRecognitionErrorEventLike = { error?: string };

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const functionOptions: Array<{ key: FunctionKey; label: string; expression: string }> = [
  { key: "linear", label: "Doğrusal", expression: "f(x) = x" },
  { key: "quadratic", label: "Parabol", expression: "f(x) = x²" },
  { key: "cubic", label: "Kübik", expression: "f(x) = x³" },
  { key: "absolute", label: "Mutlak Değer", expression: "f(x) = |x|" },
  { key: "sqrt", label: "Karekök", expression: "f(x) = √x" },
  { key: "reciprocal", label: "Rasyonel", expression: "f(x) = 1/x" },
  { key: "sin", label: "Sinüs", expression: "f(x) = sin(x)" },
  { key: "cos", label: "Kosinüs", expression: "f(x) = cos(x)" },
  { key: "custom", label: "Kendi Fonksiyonum", expression: "f(x) = ..." },
];

const tasks: Task[] = [
  {
    prompt: "f(x)=x² grafiğini 3 birim sağa kaydır.",
    target: { h: 3 },
    hint: "h değeri sağa-sola ötelemeyi belirler. Sağa kaydırmak için h pozitif olmalı.",
    solution: { a: 1, b: 1, h: 3, k: 0 },
    functionKey: "quadratic",
  },
  {
    prompt: "Grafiği 2 birim yukarı taşı.",
    target: { k: 2 },
    hint: "k değeri yukarı-aşağı ötelemeyi belirler. Yukarı taşımak için k pozitif olmalı.",
    solution: { a: 1, b: 1, h: 0, k: 2 },
  },
  {
    prompt: "Grafiği x eksenine göre yansıt.",
    target: { a: -1 },
    hint: "x eksenine göre yansıma için a değerini negatif yapmalısın.",
    solution: { a: -1, b: 1, h: 0, k: 0 },
  },
  {
    prompt: "g(x)=2f(x) dönüşümünü oluştur.",
    target: { a: 2 },
    hint: "Dikey genişleme a katsayısı ile yapılır. a = 2 grafiği dikeyde büyütür.",
    solution: { a: 2, b: 1, h: 0, k: 0 },
  },
];

const initialTransform: Transform = { a: 1, b: 1, h: 0, k: 0 };
const initialView: ViewState = { scale: 45, offsetX: 0, offsetY: 0 };

function safeRound(value: number) {
  return Math.round(value * 10) / 10;
}

function numberFromTurkish(text: string) {
  const normalized = text.toLowerCase().replace(/,/g, ".");
  const words: Record<string, number> = {
    sıfır: 0,
    bir: 1,
    iki: 2,
    üç: 3,
    dort: 4,
    dört: 4,
    beş: 5,
    bes: 5,
    altı: 6,
    alti: 6,
    yedi: 7,
    sekiz: 8,
    dokuz: 9,
    on: 10,
  };
  const numeric = normalized.match(/-?\d+(\.\d+)?/);
  if (numeric) return Number(numeric[0]);
  const found = Object.entries(words).find(([word]) => normalized.includes(word));
  const value = found ? found[1] : 1;
  return normalized.includes("eksi") || normalized.includes("negatif") ? -value : value;
}

function evaluateBaseFunction(key: FunctionKey, x: number, customExpression: string) {
  if (key === "custom") {
    const expression = customExpression
      .replace(/\^/g, "**")
      .replace(/sin/g, "Math.sin")
      .replace(/cos/g, "Math.cos")
      .replace(/sqrt/g, "Math.sqrt")
      .replace(/abs/g, "Math.abs");
    try {
      const result = Function("x", `"use strict"; return (${expression});`)(x);
      return Number.isFinite(result) ? result : NaN;
    } catch {
      return NaN;
    }
  }

  switch (key) {
    case "linear":
      return x;
    case "quadratic":
      return x * x;
    case "cubic":
      return x * x * x;
    case "absolute":
      return Math.abs(x);
    case "sqrt":
      return x >= 0 ? Math.sqrt(x) : NaN;
    case "reciprocal":
      return Math.abs(x) > 0.02 ? 1 / x : NaN;
    case "sin":
      return Math.sin(x);
    case "cos":
      return Math.cos(x);
  }
}

function buildFormula(transform: Transform, selectedFunction: FunctionKey, customExpression: string) {
  const base = selectedFunction === "custom" ? customExpression || "f(x)" : "f";
  const hPart = transform.h === 0 ? "x" : `x ${transform.h > 0 ? "−" : "+"} ${Math.abs(transform.h)}`;
  const inner = transform.b === 1 ? `(${hPart})` : `${transform.b}(${hPart})`;
  const vertical = transform.a === 1 ? `${base}(${inner})` : `${transform.a} · ${base}(${inner})`;
  return `g(x) = ${vertical}${transform.k === 0 ? "" : ` ${transform.k > 0 ? "+" : "−"} ${Math.abs(transform.k)}`}`;
}

function isTaskCorrect(task: Task, transform: Transform, selectedFunction: FunctionKey) {
  const transformCorrect = (Object.keys(task.solution) as Array<keyof Transform>).every(
    (key) => Math.abs(transform[key] - task.solution[key]) < 0.11,
  );
  const functionCorrect = !task.functionKey || selectedFunction === task.functionKey;
  return transformCorrect && functionCorrect;
}

function useCanvasGraph(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  selectedFunction: FunctionKey,
  customExpression: string,
  transform: Transform,
  view: ViewState,
  setView: React.Dispatch<React.SetStateAction<ViewState>>,
) {
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const originX = rect.width / 2 + view.offsetX;
    const originY = rect.height / 2 + view.offsetY;
    const worldX = (pixelX: number) => (pixelX - originX) / view.scale;
    const screenX = (x: number) => originX + x * view.scale;
    const screenY = (y: number) => originY - y * view.scale;

    ctx.fillStyle = "#f8fbff";
    ctx.fillRect(0, 0, rect.width, rect.height);

    const step = view.scale < 28 ? 2 : 1;
    const minX = Math.floor(worldX(0) / step) * step;
    const maxX = Math.ceil(worldX(rect.width) / step) * step;
    const minY = Math.floor((originY - rect.height) / view.scale / step) * step;
    const maxY = Math.ceil(originY / view.scale / step) * step;

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#dce7f5";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#66758d";

    for (let x = minX; x <= maxX; x += step) {
      const px = screenX(x);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, rect.height);
      ctx.stroke();
      if (x !== 0 && Math.abs(x % 2) < 0.01) ctx.fillText(String(x), px + 4, originY + 14);
    }

    for (let y = minY; y <= maxY; y += step) {
      const py = screenY(y);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(rect.width, py);
      ctx.stroke();
      if (y !== 0 && Math.abs(y % 2) < 0.01) ctx.fillText(String(y), originX + 6, py - 4);
    }

    ctx.strokeStyle = "#526173";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, originY);
    ctx.lineTo(rect.width, originY);
    ctx.moveTo(originX, 0);
    ctx.lineTo(originX, rect.height);
    ctx.stroke();
    ctx.fillStyle = "#273447";
    ctx.fillText("x", rect.width - 18, originY - 8);
    ctx.fillText("y", originX + 8, 16);
    ctx.fillText("0", originX + 6, originY + 14);

    const plot = (isTransformed: boolean) => {
      ctx.beginPath();
      let drawing = false;
      for (let px = 0; px <= rect.width; px += 2) {
        const x = worldX(px);
        const input = isTransformed ? transform.b * (x - transform.h) : x;
        const baseY = evaluateBaseFunction(selectedFunction, input, customExpression);
        const y = isTransformed ? transform.a * baseY + transform.k : baseY;
        const py = screenY(y);
        if (!Number.isFinite(y) || Math.abs(py) > rect.height * 3) {
          drawing = false;
          continue;
        }
        if (!drawing) {
          ctx.moveTo(px, py);
          drawing = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    };

    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#8b98a9";
    plot(false);

    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#2563eb";
    plot(true);
  }, [canvasRef, customExpression, selectedFunction, transform, view]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
      dragRef.current = { active: true, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragRef.current.active) return;
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current = { active: true, x: event.clientX, y: event.clientY };
      setView((current) => ({ ...current, offsetX: current.offsetX + dx, offsetY: current.offsetY + dy }));
    },
    onPointerUp: () => {
      dragRef.current.active = false;
    },
    onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setView((current) => ({ ...current, scale: Math.min(95, Math.max(22, current.scale * factor)) }));
    },
  };

  return handlers;
}

function Index() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const handleTranscriptRef = useRef<(text: string) => void>(() => undefined);
  const [selectedFunction, setSelectedFunction] = useState<FunctionKey>("quadratic");
  const [customExpression, setCustomExpression] = useState("x*x");
  const [transform, setTransform] = useState<Transform>(initialTransform);
  const [view, setView] = useState<ViewState>(initialView);
  const [activeTask, setActiveTask] = useState<Task>(tasks[0]);
  const [taskFeedback, setTaskFeedback] = useState("Görevi tamamlamak için sürgüleri kullan.");
  const [heardCommand, setHeardCommand] = useState("Henüz komut algılanmadı.");
  const [typedCommand, setTypedCommand] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);

  const formula = useMemo(() => buildFormula(transform, selectedFunction, customExpression), [customExpression, selectedFunction, transform]);
  const selectedLabel = functionOptions.find((item) => item.key === selectedFunction)?.expression ?? "f(x)";

  const updateTransform = useCallback((key: keyof Transform, value: number) => {
    setTransform((current) => ({ ...current, [key]: safeRound(value) }));
  }, []);

  const resetAll = useCallback(() => {
    setTransform(initialTransform);
    setView(initialView);
    setTaskFeedback("Grafik sıfırlandı. Şimdi görevi tekrar deneyebilirsin.");
  }, []);

  const checkTask = useCallback(() => {
    const isCorrect = isTaskCorrect(activeTask, transform, selectedFunction);
    setTaskFeedback(isCorrect ? "Tebrikler, doğru dönüşüm!" : `Tekrar dene. İpucu: ${activeTask.hint}`);
  }, [activeTask, selectedFunction, transform]);

  useEffect(() => {
    checkTask();
  }, [checkTask]);

  const chooseRandomTask = () => {
    const next = tasks[Math.floor(Math.random() * tasks.length)];
    setActiveTask(next);
    setTaskFeedback("Yeni görev hazır. Dönüşümü oluşturmayı dene.");
  };

  const showSolution = () => {
    setTransform(activeTask.solution);
    if (activeTask.functionKey) setSelectedFunction(activeTask.functionKey);
    setTaskFeedback("Çözüm gösterildi. Değerleri inceleyerek dönüşümü yorumla.");
  };

  const applyCommand = useCallback(
    (command: string) => {
      const lower = command.toLowerCase();
      const amount = numberFromTurkish(lower);
      setHeardCommand(`Algılanan komut: ${command}`);

      if (lower.includes("sıfırla")) return resetAll();
      if (lower.includes("yakınlaştır")) return setView((current) => ({ ...current, scale: Math.min(95, current.scale * 1.2) }));
      if (lower.includes("uzaklaştır")) return setView((current) => ({ ...current, scale: Math.max(22, current.scale * 0.8) }));
      if (lower.includes("sağa")) return updateTransform("h", amount);
      if (lower.includes("sola")) return updateTransform("h", -Math.abs(amount));
      if (lower.includes("yukarı")) return updateTransform("k", amount);
      if (lower.includes("aşağı") || lower.includes("asagi")) return updateTransform("k", -Math.abs(amount));
      if (lower.includes("a değerini") || lower.includes("a degerini")) return updateTransform("a", amount);
      if (lower.includes("b değerini") || lower.includes("b degerini")) return updateTransform("b", amount || 1);
      if (lower.includes("parabol")) return setSelectedFunction("quadratic");
      if (lower.includes("mutlak")) return setSelectedFunction("absolute");
      if (lower.includes("sinüs") || lower.includes("sinus")) return setSelectedFunction("sin");
      if (lower.includes("kosinüs") || lower.includes("kosinus")) return setSelectedFunction("cos");
      if (lower.includes("karekök") || lower.includes("karekok")) return setSelectedFunction("sqrt");
      setTaskFeedback("Komut anlaşılamadı. Örneğin: ‘Grafiği sağa 3 birim kaydır’ diyebilirsin.");
    },
    [resetAll, updateTransform],
  );

  const applyAiAction = useCallback(
    (action: VoiceCommandAction, originalCommand: string) => {
      setHeardCommand(`Algılanan komut: ${originalCommand} • ${action.message}`);
      if (action.type === "setTransform") return updateTransform(action.key, action.value);
      if (action.type === "selectFunction") return setSelectedFunction(action.functionKey);
      if (action.type === "reset") return resetAll();
      if (action.type === "zoom") {
        return setView((current) => ({ ...current, scale: action.direction === "in" ? Math.min(95, current.scale * 1.2) : Math.max(22, current.scale * 0.8) }));
      }
      return applyCommand(originalCommand);
    },
    [applyCommand, resetAll, updateTransform],
  );

  const handleVoiceResult = useCallback(
    async (command: string) => {
      const action = await analyzeVoiceCommand({ command });
      applyAiAction(action, command);
    },
    [applyAiAction],
  );

  useEffect(() => {
    handleTranscriptRef.current = (text: string) => void handleVoiceResult(text);
  }, [handleVoiceResult]);

  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      recognitionRef.current?.abort?.();
      recognitionRef.current?.stop();
    };
  }, []);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
    setHeardCommand("Dinleme durduruldu.");
  }, []);

  const toggleListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      setHeardCommand("Bu tarayıcı Web Speech API desteklemiyor. Chrome/Edge ile deneyebilir veya komutu yazabilirsin.");
      return;
    }
    if (isListening) {
      stopListening();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "tr-TR";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onaudiostart = () => setHeardCommand("Mikrofon açıldı. Şimdi konuşabilirsin.");
    recognition.onsoundstart = () => setHeardCommand("Ses duyuldu, komut algılanıyor...");
    recognition.onspeechstart = () => setHeardCommand("Konuşma algılandı, komut çözümleniyor...");
    recognition.onspeechend = () => setHeardCommand("Konuşma bitti, komut işleniyor...");
    recognition.onresult = (event) => {
      const latest = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (latest) handleTranscriptRef.current(latest);
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech") return setHeardCommand("Konuşma algılanmadı. Butona tekrar basıp mikrofona daha yakın ve net konuşmayı dene.");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldKeepListeningRef.current = false;
        setIsListening(false);
        return setHeardCommand("Mikrofon izni engellendi. Tarayıcı izinlerinden mikrofonu açmalısın.");
      }
      if (event.error === "audio-capture") return setHeardCommand("Mikrofon bulunamadı veya başka bir uygulama kullanıyor.");
      if (event.error === "network") return setHeardCommand("Ses tanıma servisine bağlanılamadı. Chrome/Edge ile tekrar dene veya komutu yaz.");
      setHeardCommand(`Ses tanıma hatası: ${event.error || "bilinmeyen hata"}. Komutu yazı alanından da uygulayabilirsin.`);
    };
    recognition.onend = () => {
      shouldKeepListeningRef.current = false;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    shouldKeepListeningRef.current = true;
    setIsListening(true);
    setHeardCommand("Dinleme başlatılıyor... Tarayıcı mikrofon izni isterse izin ver.");
    try {
      recognition.start();
    } catch {
      shouldKeepListeningRef.current = false;
      setIsListening(false);
      setHeardCommand("Ses tanıma başlatılamadı. Sayfayı yenileyip Chrome/Edge üzerinde tekrar deneyebilir veya komutu yazabilirsin.");
    }
  };

  const canvasHandlers = useCanvasGraph(canvasRef, selectedFunction, customExpression, transform, view, setView);

  const explanations = [
    transform.h > 0 ? "h pozitif olduğu için grafik sağa kayar." : transform.h < 0 ? "h negatif olduğu için grafik sola kayar." : "h = 0 olduğu için yatay öteleme yok.",
    transform.k > 0 ? "k pozitif olduğu için grafik yukarı kayar." : transform.k < 0 ? "k negatif olduğu için grafik aşağı kayar." : "k = 0 olduğu için dikey öteleme yok.",
    transform.a < 0 ? "a negatif olduğu için grafik x eksenine göre yansır." : transform.a > 1 ? "a > 1 olduğu için grafik dikeyde genişler." : transform.a > 0 && transform.a < 1 ? "0 < a < 1 olduğu için grafik dikeyde daralır." : "a = 1 olduğu için dikey ölçek değişmez.",
    transform.b < 0 ? "b negatif olduğu için grafik y eksenine göre yansır." : transform.b > 1 ? "b > 1 olduğu için grafik yatayda sıkışır." : transform.b > 0 && transform.b < 1 ? "0 < b < 1 olduğu için grafik yatayda genişler." : "b = 1 olduğu için yatay ölçek değişmez.",
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/90 px-4 py-4 shadow-soft backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-accent-foreground">Lise Matematik • Etkileşimli Materyal</p>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Fonksiyon Dönüşümleri Etkileşimli Öğrenme Aracı</h1>
          </div>
          <div className="rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground">{formula}</div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside className="space-y-4 rounded-lg border bg-card p-4 shadow-panel">
          <div>
            <h2 className="text-lg font-bold">Fonksiyon Seçimi</h2>
            <p className="text-sm text-muted-foreground">Orijinal grafik gri kesikli, dönüşmüş grafik mavidir.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {functionOptions.map((option) => (
              <button
                key={option.key}
                onClick={() => setSelectedFunction(option.key)}
                className={`rounded-md border px-3 py-2 text-left text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-soft ${
                  selectedFunction === option.key ? "border-primary bg-primary text-primary-foreground" : "bg-background text-foreground"
                }`}
              >
                <span className="block">{option.label}</span>
                <span className="text-xs opacity-80">{option.expression}</span>
              </button>
            ))}
          </div>

          {selectedFunction === "custom" && (
            <label className="block text-sm font-semibold">
              Kendi fonksiyonun
              <input
                value={customExpression}
                onChange={(event) => setCustomExpression(event.target.value)}
                placeholder="Örn: x*x + 1"
                className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
              />
            </label>
          )}

          <div className="space-y-4">
            <h2 className="text-lg font-bold">Dönüşüm Sürgüleri</h2>
            {([
              ["a", "Dikey ölçek / x ekseni yansıması", -4, 4, 0.1],
              ["b", "Yatay ölçek / y ekseni yansıması", -4, 4, 0.1],
              ["h", "Sağa-sola öteleme", -6, 6, 0.5],
              ["k", "Yukarı-aşağı öteleme", -6, 6, 0.5],
            ] as const).map(([key, label, min, max, step]) => (
              <label key={key} className="block space-y-2 text-sm font-semibold">
                <span className="flex items-center justify-between">
                  <span>{key}: {label}</span>
                  <span className="rounded bg-secondary px-2 py-1 text-secondary-foreground">{transform[key]}</span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={transform[key]}
                  onChange={(event) => updateTransform(key, Number(event.target.value))}
                  className="w-full accent-primary"
                />
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={resetAll} className="rounded-md bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground transition hover:scale-[1.02]">Sıfırla</button>
            <button onClick={() => setView(initialView)} className="rounded-md bg-accent px-3 py-2 text-sm font-bold text-accent-foreground transition hover:scale-[1.02]">Görünümü Sıfırla</button>
          </div>
        </aside>

        <section className="overflow-hidden rounded-lg border bg-card shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="font-bold">Analitik Düzlem</h2>
              <p className="text-sm text-muted-foreground">Sürükleyerek gez, tekerlekle yakınlaştır.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setView((current) => ({ ...current, scale: Math.min(95, current.scale * 1.15) }))} className="rounded-md bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">Yakınlaştır</button>
              <button onClick={() => setView((current) => ({ ...current, scale: Math.max(22, current.scale * 0.85) }))} className="rounded-md bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground">Uzaklaştır</button>
            </div>
          </div>
          <canvas ref={canvasRef} className="h-[520px] w-full touch-none cursor-grab active:cursor-grabbing" {...canvasHandlers} />
          <div className="grid gap-2 border-t px-4 py-3 text-sm md:grid-cols-3">
            <div><strong>Seçilen:</strong> {selectedLabel}</div>
            <div><strong>Ölçek:</strong> {Math.round(view.scale)} px / birim</div>
            <div><strong>Canlı formül:</strong> {formula}</div>
          </div>
        </section>

        <aside className="space-y-4 rounded-lg border bg-card p-4 shadow-panel">
          <section>
            <h2 className="text-lg font-bold">Açıklama Paneli</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {explanations.map((item) => (
                <li key={item} className="rounded-md bg-secondary px-3 py-2 text-secondary-foreground">{item}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border bg-background p-4">
            <h2 className="text-lg font-bold">Sesli Kontrol</h2>
            <p className="mt-2 text-sm text-muted-foreground">AI destekli analizle örnek: “Grafiği sağa 3 birim kaydır”, “B değerini eksi 1 yap”.</p>
            <button onClick={toggleListening} className="mt-3 w-full rounded-md bg-voice px-4 py-2 font-bold text-voice-foreground transition hover:scale-[1.02]">
              {isListening ? "Dinleniyor..." : "Sesli Komutu Başlat"}
            </button>
            <p className="mt-3 rounded-md bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground">{speechSupported ? heardCommand : "Tarayıcı desteği bulunamadı."}</p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!typedCommand.trim()) return;
                void handleVoiceResult(typedCommand.trim());
                setTypedCommand("");
              }}
            >
              <input
                value={typedCommand}
                onChange={(event) => setTypedCommand(event.target.value)}
                placeholder="Komutu yaz: sağa 3 kaydır"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
              />
              <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-bold text-accent-foreground transition hover:scale-[1.02]">Uygula</button>
            </form>
          </section>

          <section className="rounded-lg border bg-learning p-4 text-learning-foreground">
            <h2 className="text-lg font-bold">Öğrenme Modu</h2>
            <p className="mt-2 text-sm font-semibold">Görev: {activeTask.prompt}</p>
            <p className="mt-2 text-xs font-semibold opacity-80">Kontrol tüm a, b, h, k değerlerini ve gerekiyorsa seçili fonksiyonu birlikte değerlendirir.</p>
            <p className="mt-3 rounded-md bg-card px-3 py-2 text-sm text-card-foreground">{taskFeedback}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={chooseRandomTask} className="rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition hover:scale-[1.02]">Rastgele Görev</button>
              <button onClick={showSolution} className="rounded-md bg-accent px-3 py-2 text-sm font-bold text-accent-foreground transition hover:scale-[1.02]">Çözümü Göster</button>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
