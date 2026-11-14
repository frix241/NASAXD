import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector3,
  type Material,
  Object3D,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { getBiomechanics } from "../engine";
import type { LayerId, OrganId, TwinSceneProps } from "../contracts";

const MODEL = "/models/astrotwin_human.glb";
const layerIds: LayerId[] = ["skeleton", "organs", "muscle", "skin", "suit"];
const labels: Record<OrganId, string> = {
  heart: "Corazón",
  lungs: "Pulmones",
  brain: "Cerebro",
  digestive: "Sistema digestivo",
  suit: "Traje biométrico",
};
const vertex = `uniform float breath; varying vec3 vNormal; varying vec3 vPosition; void main(){vec3 local=position;float chest=smoothstep(1.08,1.25,local.y)*(1.0-smoothstep(1.42,1.5,local.y));local.xz*=1.0+(breath-1.0)*chest;vec4 p=modelViewMatrix*vec4(local,1.0);vNormal=normalize(normalMatrix*normal);vPosition=p.xyz;gl_Position=projectionMatrix*p;}`;
const fragment = `uniform float opacity; varying vec3 vNormal; varying vec3 vPosition; void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(-vPosition))),2.0);float scan=0.94+0.06*sin(vPosition.y*560.0);gl_FragColor=vec4(mix(vec3(0.05,0.29,0.44),vec3(0.27,0.83,1.0),rim)*scan,opacity*(0.12+0.88*rim));}`;

function CameraRig({
  view,
  resetKey,
  reducedMotion,
}: Pick<TwinSceneProps, "view" | "resetKey" | "reducedMotion">) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const destination = useRef<Vector3 | null>(null);
  useEffect(() => {
    const target = new Vector3(0, 1.03, view === "front" ? 4.1 : -4.1);
    if (reducedMotion) {
      camera.position.copy(target);
      controls.current?.target.set(0, 0.94, 0);
      controls.current?.update();
      destination.current = null;
    } else destination.current = target;
  }, [view, resetKey, reducedMotion, camera]);
  useFrame((_, delta) => {
    if (!destination.current) return;
    camera.position.lerp(destination.current, 1 - Math.exp(-delta * 8));
    controls.current?.target.set(0, 0.94, 0);
    controls.current?.update();
    if (camera.position.distanceTo(destination.current) < 0.005)
      destination.current = null;
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0.94, 0]}
      enableDamping
      dampingFactor={0.07}
      minDistance={1.5}
      maxDistance={6}
      minPolarAngle={0.25}
      maxPolarAngle={Math.PI * 0.85}
      enablePan={false}
      onStart={() => {
        destination.current = null;
      }}
    />
  );
}

type ModelData = {
  root: Group;
  groups: Map<LayerId, Object3D>;
  materials: Map<LayerId, Material[]>;
  dispose: () => void;
  heart: Object3D | null;
  lungs: Object3D | null;
  anchors: Record<OrganId, Vector3>;
};
function Human(
  props: TwinSceneProps & {
    alertRef: RefObject<HTMLDivElement | null>;
    selectionRef: RefObject<HTMLDivElement | null>;
  },
) {
  const gltf = useGLTF(MODEL, "/models/draco/");
  const { camera, size } = useThree();
  const projected = useMemo(() => new Vector3(), []);
  const elapsed = useRef(0);
  const rootRef = useRef<Group>(null);
  const data = useMemo<ModelData>(() => {
    const root = gltf.scene.clone(true);
    const groups = new Map<LayerId, Object3D>();
    const materials = new Map<LayerId, Material[]>();
    const ownedGeometries: Mesh["geometry"][] = [];
    const ownedMaterials: Material[] = [];
    const anchors = {} as Record<OrganId, Vector3>;
    for (const id of layerIds) {
      const group = root.getObjectByName(`layer_${id}`);
      if (!group) throw new Error(`Falta capa ${id}`);
      groups.set(id, group);
      materials.set(id, []);
      group.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        const source = (
          Array.isArray(node.material) ? node.material[0] : node.material
        ) as MeshStandardMaterial;
        let material: Material;
        if (id === "skin")
          material = new ShaderMaterial({
            vertexShader: vertex,
            fragmentShader: fragment,
            uniforms: {
              opacity: { value: props.layers.skin },
              breath: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            side: FrontSide,
          });
        else {
          const m = source.clone();
          m.transparent = true;
          m.side = FrontSide;
          m.forceSinglePass = true;
          m.opacity = props.layers[id];
          m.depthWrite = props.layers[id] > 0.95;
          m.roughness = id === "suit" ? 0.42 : 0.48;
          m.metalness = id === "suit" ? 0.35 : 0.08;
          if (id === "skeleton") {
            m.color = new Color("#b1c8db");
            m.emissive = new Color("#1a4258");
            m.emissiveIntensity = 0.12;
          }
          if (id === "organs") m.emissiveIntensity = 0.1;
          material = m;
        }
        node.material = material;
        node.castShadow = false;
        node.receiveShadow = false;
        material.userData.organ = node.name;
        if (id !== "organs" && id !== "suit") node.raycast = () => {};
        node.renderOrder = id === "skin" ? 4 : id === "suit" ? 3 : 1;
        ownedMaterials.push(material);
        materials.get(id)!.push(material);
        if (node.name === "heart" || node.name === "lungs") {
          const geometry = node.geometry.clone();
          geometry.computeBoundingBox();
          const center = geometry.boundingBox!.getCenter(new Vector3());
          geometry.translate(-center.x, -center.y, -center.z);
          node.geometry = geometry;
          node.position.add(center);
          ownedGeometries.push(geometry);
        }
      });
    }
    for (const id of [
      "heart",
      "lungs",
      "brain",
      "digestive",
      "suit",
    ] as OrganId[]) {
      const marker = root.getObjectByName(`anchor_${id}`);
      root.updateMatrixWorld(true);
      anchors[id] = marker
        ? root.worldToLocal(marker.getWorldPosition(new Vector3()))
        : new Vector3(0, 1.3, 0.1);
    }
    return {
      root,
      groups,
      materials,
      heart: root.getObjectByName("heart") ?? null,
      lungs: root.getObjectByName("lungs") ?? null,
      anchors,
      dispose: () => {
        ownedMaterials.forEach((m) => m.dispose());
        ownedGeometries.forEach((g) => g.dispose());
      },
    };
    // GLTF cached asset is immutable. Opacity updates happen in useFrame below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene]);
  useEffect(() => () => data.dispose(), [data]);
  useFrame((_, delta) => {
    if (!props.paused && !props.reducedMotion)
      elapsed.current += Math.min(delta, 0.1);
    const b = getBiomechanics(props.vitals, elapsed.current);
    if (data.heart)
      data.heart.scale.setScalar(props.reducedMotion ? 1 : b.heartbeat);
    if (data.lungs)
      data.lungs.scale.set(
        1,
        props.reducedMotion ? 1 : b.breath,
        props.reducedMotion ? 1 : b.breath,
      );
    if (rootRef.current)
      rootRef.current.position.x = props.reducedMotion ? 0 : b.sway;
    for (const [organ, ref] of [
      [props.alertOrgan, props.alertRef],
      [props.selectedOrgan, props.selectionRef],
    ] as const) {
      if (!organ || !ref.current || !rootRef.current) continue;
      rootRef.current.updateWorldMatrix(true, false);
      projected
        .copy(data.anchors[organ])
        .applyMatrix4(rootRef.current.matrixWorld)
        .project(camera);
      ref.current.style.transform = `translate3d(${(projected.x * 0.5 + 0.5) * size.width + 16}px,${(-projected.y * 0.5 + 0.5) * size.height - 10}px,0)`;
    }
    for (const id of layerIds) {
      const group = data.groups.get(id)!;
      const target = props.layers[id];
      let maxAlpha = 0;
      for (const mat of data.materials.get(id)!) {
        const current =
          mat instanceof ShaderMaterial
            ? mat.uniforms.opacity.value
            : mat.opacity;
        const alpha = props.reducedMotion
          ? target
          : current + (target - current) * (1 - Math.exp(-delta * 16));
        maxAlpha = Math.max(maxAlpha, alpha);
        if (mat instanceof ShaderMaterial) {
          mat.uniforms.opacity.value = alpha;
          mat.uniforms.breath.value = props.reducedMotion ? 1 : b.breath;
        } else {
          mat.opacity = alpha;
          mat.depthWrite = alpha > 0.97;
          if (id === "organs" && mat instanceof MeshStandardMaterial) {
            mat.emissive.copy(mat.color);
            mat.emissiveIntensity =
              props.selectedOrgan === mat.userData.organ ? 0.35 : 0.05;
          }
        }
      }
      group.visible = maxAlpha > 0.003;
    }
  });
  return (
    <group ref={rootRef}>
      <primitive
        object={data.root}
        dispose={null}
        onClick={(event: { stopPropagation: () => void; object: Object3D }) => {
          event.stopPropagation();
          let node: Object3D | null = event.object;
          while (node) {
            if (node.name in labels) {
              props.onSelectOrgan(node.name as OrganId);
              return;
            }
            if (node.name.startsWith("suit_")) {
              props.onSelectOrgan("suit");
              return;
            }
            node = node.parent;
          }
        }}
      />
      <AlertMarker
        anchor={data.anchors[props.alertOrgan ?? "heart"]}
        organ={props.alertOrgan ?? "heart"}
        active={!!props.alertOrgan}
        paused={props.paused}
        reducedMotion={props.reducedMotion}
      />
      <group visible={props.layers.suit > 0.2}>
        {[0, 1, 2].map((i) => (
          <mesh key={`visor-${i}`} position={[0.038, 1.635 - i * 0.012, 0.162]}>
            <planeGeometry args={[0.028 - i * 0.005, 0.0015]} />
            <meshBasicMaterial
              color="#76eaff"
              transparent
              opacity={0.65}
              toneMapped={false}
            />
          </mesh>
        ))}
        {[0, 1, 2].map((i) => (
          <mesh key={`chest-${i}`} position={[0, 1.33 - i * 0.018, 0.207]}>
            <planeGeometry args={[0.073 - i * 0.015, 0.002]} />
            <meshBasicMaterial
              color="#76eaff"
              transparent
              opacity={0.8}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function AlertMarker({
  anchor,
  organ,
  active,
  paused,
  reducedMotion,
}: {
  anchor: Vector3;
  organ: OrganId;
  active: boolean;
  paused: boolean;
  reducedMotion: boolean;
}) {
  const group = useRef<Group>(null);
  const time = useRef(0);
  const { camera } = useThree();
  useFrame((_, delta) => {
    if (!group.current) return;
    if (!paused && !reducedMotion) time.current += delta;
    group.current.quaternion.copy(camera.quaternion);
    group.current.scale.setScalar(
      reducedMotion ? 1 : 1 + 0.08 * Math.sin(time.current * 3),
    );
  });
  return (
    <group
      position={[anchor.x, anchor.y, anchor.z + 0.08]}
      ref={group}
      visible={active}
    >
      <mesh renderOrder={20}>
        <ringGeometry args={[0.092, 0.098, 64]} />
        <meshBasicMaterial
          color="#ff526d"
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.95}
          side={DoubleSide}
        />
      </mesh>
      <mesh renderOrder={20}>
        <ringGeometry args={[0.065, 0.067, 64]} />
        <meshBasicMaterial
          color="#ff526d"
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.65}
          side={DoubleSide}
        />
      </mesh>
      <mesh renderOrder={19}>
        <circleGeometry args={[0.09, 48]} />
        <meshBasicMaterial
          color="#ff526d"
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.08}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function Platform() {
  const ticks = useMemo(
    () =>
      Array.from({ length: 72 }, (_, i) => {
        const a = (i / 72) * Math.PI * 2;
        return {
          position: [Math.sin(a) * 0.71, 0.005, Math.cos(a) * 0.71] as [
            number,
            number,
            number,
          ],
          rotation: a,
        };
      }),
    [],
  );
  const instances = useRef<InstancedMesh>(null);
  useEffect(() => {
    if (!instances.current) return;
    const dummy = new Object3D();
    ticks.forEach((tick, i) => {
      dummy.position.set(...tick.position);
      dummy.rotation.set(0, tick.rotation, 0);
      dummy.scale.set(1, 1, i % 6 === 0 ? 2.5 : 1);
      dummy.updateMatrix();
      instances.current!.setMatrixAt(i, dummy.matrix);
    });
    instances.current.instanceMatrix.needsUpdate = true;
  }, [ticks]);
  return (
    <group position={[0, -0.04, 0]}>
      <mesh position={[0, -0.015, 0]}>
        <cylinderGeometry args={[0.77, 0.79, 0.025, 96]} />
        <meshStandardMaterial color="#112535" roughness={0.5} metalness={0.5} />
      </mesh>
      {[0.53, 0.65, 0.78].map((r, i) => (
        <mesh
          key={r}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.001 + i * 0.001, 0]}
        >
          <ringGeometry args={[r, r + 0.0016, 128]} />
          <meshBasicMaterial
            color={i === 2 ? "#28546a" : "#54cde9"}
            transparent
            opacity={i === 2 ? 0.4 : 0.65}
          />
        </mesh>
      ))}
      <instancedMesh ref={instances} args={[undefined, undefined, 72]}>
        <boxGeometry args={[0.001, 0.001, 0.014]} />
        <meshBasicMaterial color="#4d879d" />
      </instancedMesh>
      <gridHelper
        args={[8, 40, "#143341", "#10212f"]}
        position={[0, -0.035, 0]}
      />
    </group>
  );
}

function PerformanceMeter({
  onPerformance,
}: Pick<TwinSceneProps, "onPerformance">) {
  const bucket = useRef({ time: 0, frames: 0, samples: 0 });
  const { gl, scene, camera, setDpr } = useThree();
  useFrame((_, delta) => {
    if (document.hidden || delta > 0.5) {
      bucket.current.time = 0;
      bucket.current.frames = 0;
      return;
    }
    bucket.current.time += delta;
    bucket.current.frames++;
    if (bucket.current.time < 2) return;
    const fps = bucket.current.frames / bucket.current.time;
    bucket.current.samples++;
    if (fps < 55 && bucket.current.samples > 1 && gl.getPixelRatio() > 0.66)
      setDpr(Math.max(0.65, Number((gl.getPixelRatio() * 0.85).toFixed(2))));
    onPerformance?.(fps);
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("qa")) {
      const context = gl.getContext();
      const ext = context.getExtension("WEBGL_debug_renderer_info");
      (window as unknown as { __ASTROTWIN_QA__: unknown }).__ASTROTWIN_QA__ = {
        fps,
        dpr: gl.getPixelRatio(),
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        memory: { ...gl.info.memory },
        renderer: ext
          ? context.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER),
        layers: Object.fromEntries(
          layerIds.map((id) => [
            id,
            scene.getObjectByName(`layer_${id}`)?.visible,
          ]),
        ),
        camera: camera.position.toArray(),
      };
    }
    bucket.current.time = 0;
    bucket.current.frames = 0;
  });
  return null;
}

export default function TwinScene(props: TwinSceneProps) {
  const alertRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas
        camera={{ position: [0, 1.03, 4.1], fov: 34, near: 0.05, far: 30 }}
        dpr={1}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        fallback={
          <div className="loading" role="alert">
            WebGL no está disponible. Activa aceleración gráfica para explorar
            el gemelo.
          </div>
        }
      >
        <fog attach="fog" args={["#070b14", 5, 13]} />
        <ambientLight intensity={0.8} />
        <directionalLight
          position={[2, 3, 4]}
          intensity={2.6}
          color="#c5e4ff"
        />
        <directionalLight
          position={[-2, 1, -2]}
          intensity={2}
          color="#38bdf8"
        />
        <pointLight position={[0, 1, -1]} intensity={2} color="#777cdd" />
        <Suspense fallback={null}>
          <Human {...props} alertRef={alertRef} selectionRef={selectionRef} />
        </Suspense>
        <Platform />
        <CameraRig
          view={props.view}
          resetKey={props.resetKey}
          reducedMotion={props.reducedMotion}
        />
        <PerformanceMeter onPerformance={props.onPerformance} />
      </Canvas>
      <div
        ref={alertRef}
        className="organ-label alert-label"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          pointerEvents: "none",
          visibility: props.alertOrgan ? "visible" : "hidden",
        }}
      >
        {labels[props.alertOrgan ?? "heart"]}
        <span>SEÑAL SIMULADA</span>
      </div>
      <div
        ref={selectionRef}
        className="organ-label"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          pointerEvents: "none",
          visibility:
            props.selectedOrgan && !props.alertOrgan ? "visible" : "hidden",
        }}
      >
        {labels[props.selectedOrgan ?? "heart"]}
      </div>
    </div>
  );
}
