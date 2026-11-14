import {
  Component,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  Bone,
  Brain,
  CircleDot,
  Eye,
  Heart,
  Layers,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Sparkles,
  Wind,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import TwinScene from "./scene/TwinScene";
import { getSimulationFrame } from "./engine";
import type { LayerId, OrganId, ScenarioId } from "./contracts";

const layerLabels: { id: LayerId; label: string; Icon: typeof Bone }[] = [
  { id: "suit", label: "Traje biométrico", Icon: Shield },
  { id: "skin", label: "Cuerpo holográfico", Icon: Eye },
  { id: "muscle", label: "Tejido muscular", Icon: Activity },
  { id: "organs", label: "Órganos internos", Icon: Heart },
  { id: "skeleton", label: "Sistema óseo", Icon: Bone },
];
const defaults: Record<LayerId, number> = {
  skeleton: 0.75,
  organs: 1,
  muscle: 0,
  skin: 0.16,
  suit: 0,
};
const organNames: Record<OrganId, string> = {
  heart: "Corazón",
  lungs: "Pulmones",
  brain: "Cerebro",
  digestive: "Sistema digestivo",
  suit: "Traje biométrico",
};

class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="loading" role="alert">
        No se pudo iniciar el visor 3D. Comprueba WebGL y recarga la página.
      </div>
    ) : (
      this.props.children
    );
  }
}

function useReducedMotion() {
  const [value, setValue] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setValue(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return value;
}

export default function App() {
  const [layers, setLayers] = useState<Record<LayerId, number>>(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("astrotwin:layers") || "null",
      );
      return stored &&
        Object.keys(defaults).every(
          (k) =>
            typeof stored[k] === "number" && stored[k] >= 0 && stored[k] <= 1,
        )
        ? stored
        : defaults;
    } catch {
      return defaults;
    }
  });
  const [scenario, setScenario] = useState<ScenarioId>("nominal");
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timeRef = useRef(0);
  const [view, setView] = useState<"front" | "back">("front");
  const [resetKey, setResetKey] = useState(0);
  const [selectedOrgan, setSelectedOrgan] = useState<OrganId | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [reportReady, setReportReady] = useState(false);
  const [preset, setPreset] = useState(() =>
    layers.suit === 1
      ? "suit"
      : layers.muscle === 1
        ? "muscle"
        : layers.organs > 0
          ? "organs"
          : layers.skeleton > 0
            ? "skeleton"
            : layers.skin > 0
              ? "skin"
              : "",
  );
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    localStorage.setItem("astrotwin:layers", JSON.stringify(layers));
  }, [layers]);
  useEffect(() => {
    if (paused) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      timeRef.current += (now - last) / 1000;
      last = now;
      setElapsed(timeRef.current);
    }, 250);
    return () => clearInterval(id);
  }, [paused]);
  const frame = getSimulationFrame(scenario, elapsed);
  const v = frame.vitals;
  const setDemo = (id: ScenarioId) => {
    setScenario(id);
    timeRef.current = 0;
    setElapsed(0);
    setReportReady(false);
  };
  const dissect = (id: string) => {
    if (!id) return;
    setPreset(id);
    setSelectedOrgan(null);
    setLayers(
      id === "organs"
        ? defaults
        : {
            skeleton: id === "skeleton" ? 1 : 0,
            organs: 0,
            muscle: id === "muscle" ? 1 : 0,
            skin: id === "skin" ? 0.8 : id === "skeleton" ? 0.08 : 0,
            suit: id === "suit" ? 1 : 0,
          },
    );
  };
  const exportReport = () => {
    const data = {
      mission: "ARES-01",
      subject: "AST-001 (ficticio)",
      createdAt: new Date().toISOString(),
      scenario,
      elapsedSeconds: elapsed,
      ...frame,
      note: "Prototipo experimental. Telemetría simulada; no diagnóstico.",
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "astrotwin-reporte-simulado.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setReportReady(true);
  };
  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <Orbit
            style={{
              display: "inline",
              width: 25,
              marginRight: 9,
              verticalAlign: "middle",
              color: "#67e8f9",
            }}
          />
          astro<span>twin</span>
          <small>SPACE HEALTH INTELLIGENCE</small>
        </div>
        <div className="mission mono">
          <strong>ARES-01 · Tránsito a Marte</strong>Día de misión 184 /
          Tripulante AST-001
        </div>
        <div className="connection mono">
          <span className="dot" />
          Sistema local<span className="badge-sim">DEMOSTRACIÓN</span>
        </div>
      </header>
      <div className="center-label">
        <p>GEMELO DIGITAL / AST-001</p>
        <h1>Tu cuerpo. Tu misión.</h1>
        <p>
          {frame.alert
            ? "Una señal requiere revisión"
            : "Explora tus sistemas en tiempo real"}
        </p>
      </div>
      <section
        className="scene"
        aria-label="Visor 3D interactivo del cuerpo humano"
      >
        <SceneErrorBoundary>
          <Suspense
            fallback={
              <div className="loading" role="status">
                Preparando gemelo digital…
              </div>
            }
          >
            <TwinScene
              layers={layers}
              vitals={v}
              alertOrgan={frame.alert?.organ ?? null}
              paused={paused}
              reducedMotion={reducedMotion}
              view={view}
              resetKey={resetKey}
              selectedOrgan={selectedOrgan}
              onSelectOrgan={setSelectedOrgan}
              onPerformance={setFps}
            />
          </Suspense>
        </SceneErrorBoundary>
      </section>
      <aside className="hud left" aria-label="Capas y simulación">
        <section className="glass">
          <div className="panel-heading">
            <h2>Explora el gemelo</h2>
            <Layers />
          </div>
          <p className="sub">De la superficie al interior.</p>
          {layerLabels.map(({ id, label, Icon }) => (
            <div className="layer-row" key={id}>
              <div className="layer-head">
                <label id={`layer-${id}`}>
                  <Icon />
                  {label}
                </label>
                <span>{Math.round(layers[id] * 100)}%</span>
              </div>
              <Slider
                aria-labelledby={`layer-${id}`}
                min={0}
                max={100}
                step={1}
                value={[Math.round(layers[id] * 100)]}
                onValueChange={([value]) => {
                  setPreset("");
                  setLayers((old) => ({ ...old, [id]: value / 100 }));
                }}
              />
            </div>
          ))}
          <div className="dissection">
            <p className="sub">Disección rápida</p>
            <ToggleGroup
              type="single"
              value={preset}
              onValueChange={dissect}
              aria-label="Disección rápida"
            >
              {layerLabels.map(({ id, label, Icon }) => (
                <ToggleGroupItem
                  key={id}
                  value={id}
                  aria-label={`Aislar ${label}`}
                  title={label}
                >
                  <Icon size={16} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <label className="sr-only" htmlFor="organ-select">
            Explorar órgano
          </label>
          <select
            id="organ-select"
            className="scenario-select"
            aria-label="Explorar órgano"
            value={selectedOrgan ?? ""}
            onChange={(e) => {
              const organ = e.target.value as OrganId;
              if (!organ) {
                setSelectedOrgan(null);
                return;
              }
              if (organ !== "suit") {
                setLayers({ ...defaults, skeleton: 0.3 });
                setPreset("organs");
              } else dissect("suit");
              setSelectedOrgan(organ);
            }}
          >
            <option value="">Selecciona un órgano</option>
            {Object.entries(organNames).map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </section>
        <section className="glass">
          <div className="panel-heading">
            <h2>Simulador de misión</h2>
            <Sparkles />
          </div>
          <p className="sub">Prueba cómo responde el gemelo.</p>
          <label className="sr-only" htmlFor="scenario">
            Escenario simulado
          </label>
          <select
            id="scenario"
            className="scenario-select"
            value={scenario}
            onChange={(e) => setDemo(e.target.value as ScenarioId)}
          >
            <option value="nominal">Monitoreo estable</option>
            <option value="cardiac">Cambio cardiovascular</option>
            <option value="respiratory">Cambio respiratorio</option>
            <option value="thermal">Cambio de temperatura</option>
            <option value="radiation">Evento de radiación ambiental</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPaused(false);
              setDemo("nominal");
            }}
          >
            <RotateCcw data-icon="inline-start" />
            Restaurar escenario
          </Button>
          <div className="quality">
            <CircleDot size={12} />
            {fps === null
              ? "WebGL · midiendo rendimiento"
              : `${Math.round(fps)} FPS · medición local`}
          </div>
        </section>
      </aside>
      <aside className="hud right" aria-label="Telemetría y asistencia">
        <section className="glass">
          <div className="panel-heading">
            <h2>Señales de vida</h2>
            <Activity />
          </div>
          <span className="badge-sim">TELEMETRÍA SIMULADA</span>
          <div className="vitals">
            {[
              ["Pulso", v.bpm.toFixed(0), "BPM"],
              ["Oxigenación", v.spo2.toFixed(0), "%"],
              [
                "Presión arterial",
                `${v.systolic.toFixed(0)}/${v.diastolic.toFixed(0)}`,
                "mmHg",
              ],
              ["Temperatura", v.temperature.toFixed(1), "°C"],
              ["Respiración", v.respiratoryRate.toFixed(0), "/min"],
              ["Ambiente radiativo", v.radiation.toFixed(1), "µSv/h"],
            ].map(([name, value, unit]) => (
              <div className="metric" key={name}>
                <strong
                  style={{ fontSize: name === "Presión arterial" ? 20 : 26 }}
                >
                  {value}
                </strong>
                <small>{unit}</small>
                <label>{name}</label>
              </div>
            ))}
          </div>
          <svg
            className="wave"
            viewBox="0 0 240 42"
            aria-label="Trazo de pulso ilustrativo"
          >
            <polyline points="0,28 14,28 20,26 27,29 40,28 48,26 54,30 60,6 65,38 71,19 78,27 94,28 108,28 119,24 124,29 139,28 147,27 155,30 161,9 166,37 173,20 180,28 199,28 209,25 216,29 240,28" />
          </svg>
          <p className="sub">Trazo ilustrativo · sin sensor conectado</p>
        </section>
        <section
          className={`glass ${frame.alert ? "alert-card" : ""}`}
          aria-live="polite"
        >
          <div className="panel-heading">
            <h2>{frame.alert ? "Señal para revisar" : "Monitoreo estable"}</h2>
            {frame.alert ? <CircleDot /> : <Shield />}
          </div>
          <p className="sub">
            {frame.alert?.message ??
              "No hay alertas prioritarias en este escenario de demostración."}
          </p>
          {selectedOrgan && (
            <div className="selected-organ">
              Seleccionado: {organNames[selectedOrgan]}
            </div>
          )}
          <div className="next-action">
            <strong>{frame.alert?.title ?? "Tu siguiente paso"}</strong>
            <br />
            {frame.alert?.recommendation ??
              "Selecciona un órgano para explorarlo o activa un escenario."}
          </div>
          <Button
            style={{ marginTop: 16, width: "100%" }}
            variant="outline"
            size="sm"
            onClick={exportReport}
          >
            <ArrowDownToLine data-icon="inline-start" />
            Preparar reporte
          </Button>
          {reportReady && (
            <p className="report" role="status">
              Reporte de demostración descargado.
            </p>
          )}
        </section>
        <section className="glass">
          <div className="panel-heading">
            <h2>Copiloto de salud</h2>
            <Brain />
          </div>
          <p className="sub">
            Motor local de demostración. Conexión clínica por IA pendiente de
            integración.
          </p>
        </section>
      </aside>
      <div className="scene-caption">
        Arrastra para rotar · Desplaza para acercar
        <br />
        Representación anatómica estilizada de demostración
      </div>
      <nav className="bottom-controls" aria-label="Controles de cámara">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => {
            if (value === "front" || value === "back") setView(value);
          }}
          aria-label="Orientación del gemelo"
        >
          <ToggleGroupItem value="front" aria-label="Vista frontal">
            Frontal
          </ToggleGroupItem>
          <ToggleGroupItem value="back" aria-label="Vista posterior">
            Posterior
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Restablecer cámara"
          onClick={() => {
            setView("front");
            setResetKey((k) => k + 1);
          }}
        >
          <RotateCcw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={paused ? "Reanudar simulación" : "Pausar simulación"}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
      </nav>
      <footer className="footer">
        <span>
          ASTROTWIN / Prototipo experimental · No es un dispositivo médico
        </span>
        <span>
          {paused ? "SIMULACIÓN PAUSADA" : "SIMULACIÓN ACTIVA"} ·{" "}
          {Math.floor(elapsed)} s · v0.1
        </span>
      </footer>
    </main>
  );
}
