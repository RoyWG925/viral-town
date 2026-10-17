"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BUILDINGS, FLOOR_H, GROUND_H, doorX, frame, wallHeight, type BuildingDef, type ShopKind } from "./layout";
import { mat, shade } from "./materials";
import { chalkTexture, flagTexture, homeTexture, iconTexture, interiorTexture, signTexture, stripeTexture, vbannerTexture, wallTexture } from "./textures";
import { clock, glow, interiorMaterial } from "./clock";
import { Flag, Instances, Puffs, UNIT_BOX, type Inst } from "./SetPieces";

const ICONS: Record<ShopKind, string> = {
  police: "🚓", bakery: "🥐", flower: "🌷", townhall: "🏛️", cafe: "☕", news: "📰", books: "📚", ramen: "🍜", mart: "🏪", seafood: "🐟",
};
// Chalkboards may only show public facts (the festival, the doves, the fee, Molly's daughter performing):
// never a resident's secret such as police staffing or the blog's trouble. Short lines: long ones shrink to fit.
const CHALK: Record<ShopKind, string[]> = {
  bakery: ["Today's picks", "Pineapple buns", "Lantern rolls"],
  flower: ["Festival flowers", "Fresh bouquets", "10% off bouquets"],
  cafe: ["Tonight 8 PM", "My girl's on stage!", "Coffee of the day"],
  news: ["Special edition!", "Lantern Festival", "Tonight 8 PM"],
  books: ["New arrivals", "Mysteries", "Picture book sale"],
  police: ["Lost & found", "Ask at the desk", ""],
  townhall: ["Lantern Festival", "Tonight 8 PM", "On the plaza"],
  ramen: ["Today only", "Tonkotsu ramen", "Free upsize!"],
  mart: ["Open 24 hours", "Drinks on sale", "Hot bento"],
  seafood: ["Today's catch", "Grilled fish set", "Oysters"],
};
const BRICK = new Set(["bakery", "police", "books", "house2"]);

// --- roof geometry --------------------------------------------------------------

// Gable roof: a triangular prism with the ridge running along x. Groups: 0 = gable ends, 1 = slopes.
function gableGeometry(w: number, d: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2).rotateY(Math.PI / 2);
}
// Pediment: a triangle facing the front, extruded backwards along z.
function pedimentGeometry(w: number, h: number, depth: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth);
}
const HIP = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0); // unit square base
const BARREL = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, 0, Math.PI).rotateZ(Math.PI / 2); // axis along x, upper half
const BARREL_CAP = new THREE.CircleGeometry(1, 24, 0, Math.PI).rotateY(Math.PI / 2);

function Roof({ b, w, d, H, wallMat }: { b: BuildingDef; w: number; d: number; H: number; wallMat: THREE.Material }) {
  const roof = mat(b.roofColor, 0.7);
  const trim = mat(b.trim);
  const gable = useMemo(() => (b.roof === "pitched" ? gableGeometry(w + 0.5, d + 0.6, Math.min(2.6, d * 0.42)) : null), [b.roof, w, d]);
  switch (b.roof) {
    case "pitched":
      return (
        <group position={[0, H, 0]}>
          <mesh geometry={gable!} material={[wallMat, roof]} castShadow receiveShadow />
          <mesh position={[0, Math.min(2.6, d * 0.42) + 0.02, 0]} material={mat(shade(b.roofColor, -0.12))}>
            <boxGeometry args={[w + 0.6, 0.14, 0.24]} />
          </mesh>
          <Chimney x={w * 0.28} y={0.6} z={-d * 0.2} color={shade(b.wall, -0.2)} />
          {b.kind === "bakery" && <Puffs position={[w * 0.28, 2.35, -d * 0.2]} />}
        </group>
      );
    case "hip":
      return (
        <group position={[0, H, 0]}>
          <mesh geometry={HIP} scale={[w + 0.5, Math.min(2.2, d * 0.4), d + 0.5]} material={roof} castShadow receiveShadow />
        </group>
      );
    case "barrel": {
      const rz = d / 2 + 0.25;
      const ry = rz * 0.5;
      const m = new THREE.MeshStandardMaterial({ color: b.roofColor, roughness: 0.6, side: THREE.DoubleSide });
      return (
        <group position={[0, H, 0]}>
          <mesh geometry={BARREL} scale={[w + 0.3, ry, rz]} material={m} castShadow receiveShadow />
          {[-1, 1].map((s) => (
            <mesh key={s} geometry={BARREL_CAP} position={[s * (w + 0.3) / 2, 0, 0]} scale={[1, ry, rz]} material={trim} />
          ))}
          <Skylights w={w} d={d} y={ry * 0.9} />
        </group>
      );
    }
    case "stepped":
      return (
        <group position={[0, H, 0]}>
          <Slab w={w} d={d} roof={roof} trim={trim} />
          <RoundedBox args={[w * 0.45, 2.0, d * 0.5]} radius={0.12} position={[-w * 0.2, 1.3, -d * 0.18]} castShadow receiveShadow material={wallMat} />
          <mesh position={[-w * 0.2, 2.42, -d * 0.18]} castShadow material={roof}>
            <boxGeometry args={[w * 0.45 + 0.3, 0.22, d * 0.5 + 0.3]} />
          </mesh>
          <mesh position={[-w * 0.2, 1.5, -d * 0.18 + d * 0.25 + 0.01]} material={glow.window}>
            <boxGeometry args={[w * 0.25, 0.7, 0.04]} />
          </mesh>
          <SolarPanels x={w * 0.22} z={d * 0.12} n={2} />
          <AirCon x={w * 0.3} z={-d * 0.3} />
        </group>
      );
    default:
      return (
        <group position={[0, H, 0]}>
          <Slab w={w} d={d} roof={roof} trim={trim} />
          {b.kind === "news" ? <WaterTank x={w * 0.22} z={-d * 0.2} /> : <AirCon x={-w * 0.28} z={-d * 0.25} />}
          <Skylights w={w} d={d} y={0.32} />
          {b.kind === "news" && <Antenna x={-w * 0.3} z={-d * 0.3} />}
        </group>
      );
  }
}

function Slab({ w, d, roof, trim }: { w: number; d: number; roof: THREE.Material; trim: THREE.Material }) {
  return (
    <>
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow material={roof}>
        <boxGeometry args={[w + 0.45, 0.3, d + 0.45]} />
      </mesh>
      <mesh position={[0, 0.36, 0]} castShadow material={trim}>
        <boxGeometry args={[w + 0.58, 0.14, d + 0.58]} />
      </mesh>
    </>
  );
}

function Chimney({ x, y, z, color }: { x: number; y: number; z: number; color: string }) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.7, 0]} castShadow material={mat(color)}>
        <boxGeometry args={[0.55, 1.6, 0.55]} />
      </mesh>
      <mesh position={[0, 1.55, 0]} material={mat("#3a3a3a")}>
        <boxGeometry args={[0.68, 0.12, 0.68]} />
      </mesh>
    </group>
  );
}

function AirCon({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.3, z]}>
      <RoundedBox args={[1.1, 0.7, 0.8]} radius={0.06} position={[0, 0.35, 0]} castShadow material={mat("#d7dbe0", 0.5, 0.2)} />
      <mesh position={[0, 0.35, 0.41]} material={mat("#9aa1a9")}>
        <cylinderGeometry args={[0.25, 0.25, 0.02, 16]} />
      </mesh>
    </group>
  );
}

function Skylights({ w, d, y }: { w: number; d: number; y: number }) {
  return (
    <group position={[0, y, 0]}>
      {[-0.22, 0.12].map((f) => (
        <group key={f} position={[f * w, 0.1, d * 0.05]}>
          <mesh material={mat("#f0ece4")}>
            <boxGeometry args={[1.2, 0.18, 1.0]} />
          </mesh>
          <mesh position={[0, 0.1, 0]} material={mat("#9fc9e8", 0.1, 0.3)}>
            <boxGeometry args={[1.0, 0.04, 0.8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function SolarPanels({ x, z, n }: { x: number; z: number; n: number }) {
  return (
    <group position={[x, 0.55, z]}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[(i - (n - 1) / 2) * 1.3, 0, 0]} rotation={[-0.45, 0, 0]} castShadow material={mat("#2b3f73", 0.2, 0.5)}>
          <boxGeometry args={[1.2, 0.06, 0.9]} />
        </mesh>
      ))}
    </group>
  );
}

function WaterTank({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.3, z]}>
      {[-0.45, 0.45].map((o) => (
        <mesh key={o} position={[o, 0.5, 0]} material={mat("#6b4f3a")}>
          <boxGeometry args={[0.1, 1.0, 0.1]} />
        </mesh>
      ))}
      <mesh position={[0, 1.55, 0]} castShadow material={mat("#9c6b44", 0.8)}>
        <cylinderGeometry args={[0.7, 0.7, 1.1, 16]} />
      </mesh>
      <mesh position={[0, 2.25, 0]} material={mat("#6b4f3a")}>
        <coneGeometry args={[0.78, 0.4, 16]} />
      </mesh>
    </group>
  );
}

function Antenna({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.3, z]}>
      <mesh position={[0, 1.4, 0]} material={mat("#555", 0.4, 0.6)}>
        <cylinderGeometry args={[0.04, 0.04, 2.8, 6]} />
      </mesh>
      {[0.9, 1.5, 2.1].map((y, i) => (
        <mesh key={y} position={[0, y, 0]} material={mat("#555", 0.4, 0.6)}>
          <boxGeometry args={[1.0 - i * 0.25, 0.04, 0.04]} />
        </mesh>
      ))}
      <mesh position={[0, 2.85, 0]} material={glow.neonRed}>
        <sphereGeometry args={[0.08, 8, 6]} />
      </mesh>
    </group>
  );
}

// --- facades --------------------------------------------------------------------

function Window({ x, y, glass, trim, shutters, box }: { x: number; y: number; glass: THREE.Material; trim: THREE.Material; shutters?: string; box?: string }) {
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, 0, 0.03]} material={trim}>
        <boxGeometry args={[1.02, 1.22, 0.08]} />
      </mesh>
      <mesh position={[0, 0, 0.075]} material={glass}>
        <planeGeometry args={[0.82, 1.02]} />
      </mesh>
      <mesh position={[0, 0, 0.09]} material={trim}>
        <boxGeometry args={[0.05, 1.02, 0.03]} />
      </mesh>
      <mesh position={[0, -0.66, 0.12]} material={trim}>
        <boxGeometry args={[1.1, 0.08, 0.2]} />
      </mesh>
      {shutters &&
        [-0.68, 0.68].map((o) => (
          <mesh key={o} position={[o, 0, 0.06]} material={mat(shutters, 0.8)}>
            <boxGeometry args={[0.32, 1.18, 0.05]} />
          </mesh>
        ))}
      {box && (
        <group position={[0, -0.8, 0.2]}>
          <mesh material={mat("#a0714f")}>
            <boxGeometry args={[0.95, 0.18, 0.26]} />
          </mesh>
          {[-0.3, 0, 0.3].map((o, i) => (
            <mesh key={o} position={[o, 0.15, 0]} material={mat([box, "#ffd23f", "#ff8a65"][i], 0.7)}>
              <icosahedronGeometry args={[0.13, 0]} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function UpperFloors({ b, w, d, glass }: { b: BuildingDef; w: number; d: number; glass: THREE.Material }) {
  const trim = mat(b.trim);
  const house = b.kind === "house";
  const n = Math.max(2, Math.round(w / 2.3));
  const floors: ReactNode[] = [];
  for (let k = 1; k < b.floors; k++) {
    const base = GROUND_H + (k - 1) * FLOOR_H;
    const balcony = b.balcony && k === 1;
    floors.push(
      <group key={k} position={[0, base, d / 2]}>
        <mesh position={[0, 0.02, 0]} material={trim}>
          <boxGeometry args={[w + 0.08, 0.16, 0.14]} />
        </mesh>
        {Array.from({ length: n }, (_, i) => {
          const x = -w / 2 + (w * (i + 0.5)) / n;
          if (balcony && i === Math.floor(n / 2)) return null;
          return <Window key={i} x={x} y={1.35} glass={glass} trim={trim} shutters={house ? shade(b.roofColor, 0.1) : undefined} box={(i + k) % 2 ? "#ff6fa0" : undefined} />;
        })}
        {balcony && <Balcony x={-w / 2 + (w * (Math.floor(n / 2) + 0.5)) / n} glass={glass} trim={trim} rail={shade(b.roofColor, -0.05)} />}
      </group>,
    );
  }
  return <>{floors}</>;
}

function Balcony({ x, glass, trim, rail }: { x: number; glass: THREE.Material; trim: THREE.Material; rail: string }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 1.2, 0.04]} material={trim}>
        <boxGeometry args={[1.25, 2.1, 0.08]} />
      </mesh>
      <mesh position={[0, 1.2, 0.09]} material={glass}>
        <planeGeometry args={[1.05, 1.9]} />
      </mesh>
      <mesh position={[0, 0.15, 0.5]} castShadow material={trim}>
        <boxGeometry args={[1.9, 0.14, 1.0]} />
      </mesh>
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-0.9 + i * 0.3, 0.55, 0.98]} material={mat(rail, 0.5, 0.3)}>
          <boxGeometry args={[0.05, 0.75, 0.05]} />
        </mesh>
      ))}
      <mesh position={[0, 0.94, 0.98]} material={mat(rail, 0.5, 0.3)}>
        <boxGeometry args={[1.9, 0.07, 0.07]} />
      </mesh>
      <mesh position={[0.6, 0.45, 0.65]} castShadow material={mat("#5fb256", 0.8)}>
        <icosahedronGeometry args={[0.25, 1]} />
      </mesh>
    </group>
  );
}

function SideWindows({ b, w, glass }: { b: BuildingDef; w: number; glass: THREE.Material }) {
  const trim = mat(b.trim);
  const rows = Array.from({ length: b.floors }, (_, k) => (k === 0 ? 1.7 : GROUND_H + (k - 1) * FLOOR_H + 1.35));
  return (
    <>
      {[-1, 1].map((side) =>
        rows.map((y) => (
          <group key={`${side}${y}`} position={[side * (w / 2 + 0.01), 0, 0]} rotation={[0, (side * Math.PI) / 2, 0]}>
            <Window x={0} y={y} glass={glass} trim={trim} />
          </group>
        )),
      )}
    </>
  );
}

function Shopfront({ b, w, d, m }: { b: BuildingDef; w: number; d: number; m: ShopMats }) {
  const kind = b.kind as ShopKind;
  const front = d / 2;
  void front;
  const winW = w * 0.56;
  const winX = -w * 0.13;
  const dX = w * 0.31;
  return (
    <group>
      <mesh position={[winX, 1.4, front + 0.02]} material={mat(b.trim)}>
        <boxGeometry args={[winW + 0.28, 1.9, 0.1]} />
      </mesh>
      <mesh position={[winX, 1.4, front + 0.075]} material={m.interior}>
        <planeGeometry args={[winW, 1.64]} />
      </mesh>
      <mesh position={[winX, 1.4, front + 0.1]} material={mat(b.trim)}>
        <boxGeometry args={[0.07, 1.64, 0.05]} />
      </mesh>
      <mesh position={[winX, 0.5, front + 0.2]} castShadow material={mat(shade(b.trim, -0.1))}>
        <boxGeometry args={[winW + 0.4, 0.1, 0.32]} />
      </mesh>
      <mesh position={[dX, 1.1, front + 0.04]} material={mat(shade(b.wall, -0.32))}>
        <boxGeometry args={[1.05, 2.2, 0.1]} />
      </mesh>
      <mesh position={[dX, 1.45, front + 0.1]} material={m.interior}>
        <planeGeometry args={[0.62, 1.0]} />
      </mesh>
      <mesh position={[dX + 0.36, 1.05, front + 0.12]} material={mat("#d4af37", 0.3, 0.8)}>
        <sphereGeometry args={[0.05, 8, 6]} />
      </mesh>
      {[dX - 0.72, dX + 0.72].map((x) => (
        <group key={x} position={[x, 2.05, front + 0.12]}>
          <mesh material={mat("#2f2f35", 0.5, 0.5)}>
            <boxGeometry args={[0.12, 0.12, 0.2]} />
          </mesh>
          <mesh position={[0, -0.14, 0.08]} material={glow.lamp}>
            <sphereGeometry args={[0.1, 10, 8]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 2.62, front + 0.6]} rotation={[0.42, 0, 0]} castShadow material={m.awning}>
        <boxGeometry args={[w * 0.94, 0.07, 1.3]} />
      </mesh>
      <mesh position={[0, 2.3, front + 1.18]} castShadow material={m.awning}>
        <boxGeometry args={[w * 0.94, 0.24, 0.05]} />
      </mesh>
      <mesh position={[0, 3.15, front + 0.1]} castShadow material={m.sign}>
        <boxGeometry args={[Math.min(w * 0.84, 5.6), 0.8, 0.16]} />
      </mesh>
      <group position={[w / 2 - 0.25, 2.95, front + 0.1]}>
        <mesh position={[0, 0.42, 0.45]} material={mat("#2f2f35", 0.5, 0.5)}>
          <boxGeometry args={[0.05, 0.05, 0.95]} />
        </mesh>
        <mesh position={[0, 0, 0.7]} rotation={[0, Math.PI / 2, 0]} material={m.icon}>
          <circleGeometry args={[0.42, 24]} />
        </mesh>
      </group>
      {CHALK[kind][0] && (
        <group position={[dX + 1.0, 0, front + 0.95]} rotation={[0, -0.3, 0]}>
          <mesh position={[0, 0.5, 0.12]} rotation={[-0.18, 0, 0]} castShadow material={m.chalk}>
            <boxGeometry args={[0.62, 0.95, 0.04]} />
          </mesh>
          <mesh position={[0, 0.5, -0.12]} rotation={[0.18, 0, 0]} castShadow material={mat("#8a5a3a")}>
            <boxGeometry args={[0.62, 0.95, 0.04]} />
          </mesh>
        </group>
      )}
      <Display kind={kind} x={winX} z={front + 0.75} />
    </group>
  );
}

function HouseFront({ b, w, d, glass }: { b: BuildingDef; w: number; d: number; glass: THREE.Material }) {
  const front = d / 2;
  const dX = doorX(b);
  const trim = mat(b.trim);
  const door = shade(b.roofColor, 0.05);
  return (
    <group>
      <mesh position={[dX, 1.1, front + 0.04]} material={mat(door, 0.6)}>
        <boxGeometry args={[1.05, 2.2, 0.1]} />
      </mesh>
      <mesh position={[dX + 0.32, 1.05, front + 0.11]} material={mat("#d4af37", 0.3, 0.8)}>
        <sphereGeometry args={[0.05, 8, 6]} />
      </mesh>
      <mesh position={[dX, 2.45, front + 0.45]} castShadow material={mat(b.roofColor, 0.7)}>
        <boxGeometry args={[1.6, 0.12, 0.9]} />
      </mesh>
      <mesh position={[dX, 0.08, front + 0.35]} receiveShadow material={mat("#d6cfc4", 0.9)}>
        <boxGeometry args={[1.6, 0.16, 0.7]} />
      </mesh>
      {[w * 0.12, w * 0.36].filter((x) => x + 0.6 < w / 2).map((x) => (
        <Window key={x} x={x} y={1.55} glass={glass} trim={trim} shutters={shade(b.roofColor, 0.1)} box="#ff6fa0" />
      ))}
      {[dX - 0.95, dX + 0.95].map((x) => (
        <group key={x} position={[x, 0, front + 0.4]}>
          <mesh position={[0, 0.22, 0]} castShadow material={mat("#c4643e")}>
            <cylinderGeometry args={[0.22, 0.17, 0.44, 10]} />
          </mesh>
          <mesh position={[0, 0.6, 0]} castShadow material={mat("#5fb256", 0.85)}>
            <icosahedronGeometry args={[0.3, 1]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function WarehouseFront({ b, w, d }: { b: BuildingDef; w: number; d: number }) {
  const shutter = useMemo(() => new THREE.MeshStandardMaterial({ map: stripeTexture("#9aa1a9", "#b9c0c7", 16), roughness: 0.6, metalness: 0.2 }), []);
  const front = d / 2;
  return (
    <group>
      <mesh position={[0, 1.7, front + 0.05]} rotation={[0, 0, Math.PI / 2]} material={shutter}>
        <boxGeometry args={[3.4, Math.min(w * 0.45, 4.2), 0.08]} />
      </mesh>
      <mesh position={[0, 3.55, front + 0.1]} material={mat(b.trim)}>
        <boxGeometry args={[Math.min(w * 0.5, 4.6), 0.25, 0.2]} />
      </mesh>
      <mesh position={[w * 0.36, 1.1, front + 0.05]} material={mat(shade(b.wall, -0.3))}>
        <boxGeometry args={[1.0, 2.2, 0.08]} />
      </mesh>
      <group position={[0, 3.9, front + 0.2]}>
        <mesh material={mat("#2f2f35", 0.5, 0.5)}>
          <boxGeometry args={[0.5, 0.12, 0.3]} />
        </mesh>
        <mesh position={[0, -0.12, 0.08]} material={glow.lamp}>
          <boxGeometry args={[0.4, 0.06, 0.15]} />
        </mesh>
      </group>
    </group>
  );
}

// The back of a building: a back door, a drainpipe, a small window and the air-con box.
function BackDetails({ b, w, d, H, glass }: { b: BuildingDef; w: number; d: number; H: number; glass: THREE.Material }) {
  const back = -d / 2;
  return (
    <group rotation={[0, Math.PI, 0]}>
      <mesh position={[w * 0.25, 1.05, -back + 0.04]} material={mat(shade(b.wall, -0.3), 0.7)}>
        <boxGeometry args={[0.95, 2.1, 0.08]} />
      </mesh>
      <mesh position={[w * 0.25, 2.25, -back + 0.3]} material={mat(b.roofColor)}>
        <boxGeometry args={[1.3, 0.08, 0.6]} />
      </mesh>
      <group position={[-w * 0.2, 0, -back]}>
        <Window x={0} y={1.7} glass={glass} trim={mat(b.trim)} />
      </group>
      <mesh position={[-w / 2 + 0.25, H / 2, -back + 0.1]} material={mat("#8c8c8c", 0.5, 0.4)}>
        <cylinderGeometry args={[0.07, 0.07, H, 6]} />
      </mesh>
      <group position={[w * 0.05, 2.4, -back + 0.35]}>
        <RoundedBox args={[0.9, 0.6, 0.5]} radius={0.05} castShadow material={mat("#d7dbe0", 0.5, 0.2)} />
      </group>
    </group>
  );
}

// Goods set out in front of the shop window.
function Display({ kind, x, z }: { kind: ShopKind; x: number; z: number }) {
  const wood = mat("#b5835a");
  switch (kind) {
    case "bakery":
      return (
        <group position={[x - 0.4, 0, z]}>
          <mesh position={[0, 0.55, 0]} castShadow material={wood}>
            <boxGeometry args={[1.5, 0.08, 0.7]} />
          </mesh>
          {[-0.55, 0.55].map((o) => (
            <mesh key={o} position={[o, 0.27, 0]} material={wood}>
              <boxGeometry args={[0.08, 0.54, 0.6]} />
            </mesh>
          ))}
          {[-0.5, -0.15, 0.2, 0.5].map((o, i) => (
            <mesh key={o} position={[o, 0.68, (i % 2) * 0.15 - 0.07]} rotation={[0, 0, Math.PI / 2]} castShadow material={mat(i % 2 ? "#c0702a" : "#d9913f", 0.6)}>
              <capsuleGeometry args={[0.1, 0.2, 3, 8]} />
            </mesh>
          ))}
        </group>
      );
    case "books":
      return (
        <group position={[x - 0.4, 0, z]}>
          <mesh position={[0, 0.45, 0]} castShadow material={wood}>
            <boxGeometry args={[1.4, 0.5, 0.6]} />
          </mesh>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[-0.55 + i * 0.18, 0.85, 0]} rotation={[0, 0, (i % 3) * 0.08]} castShadow material={mat(["#e2574c", "#3a86ff", "#ffbe0b", "#8338ec", "#2ec4b6"][i % 5], 0.6)}>
              <boxGeometry args={[0.14, 0.32, 0.45]} />
            </mesh>
          ))}
        </group>
      );
    case "news":
      return (
        <group position={[x - 0.3, 0, z]}>
          <mesh position={[0, 0.5, 0]} castShadow material={mat("#3a3a3a", 0.5, 0.4)}>
            <boxGeometry args={[1.0, 1.0, 0.5]} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, 1.02 + i * 0.05, 0]} rotation={[0, i * 0.2, 0]} material={mat("#f5f2e8", 0.7)}>
              <boxGeometry args={[0.7, 0.04, 0.45]} />
            </mesh>
          ))}
        </group>
      );
    case "flower":
      return (
        <group position={[x + 0.1, 0, z]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[(i - 1) * 0.55, 0.3 + i * 0.22, -i * 0.15]} castShadow material={wood}>
              <boxGeometry args={[0.5, 0.06, 0.45]} />
            </mesh>
          ))}
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[(i - 1) * 0.55, 0.48 + i * 0.22, -i * 0.15]} castShadow material={mat(["#ff6fa0", "#b388ff", "#ffd23f"][i], 0.7)}>
              <icosahedronGeometry args={[0.22, 1]} />
            </mesh>
          ))}
        </group>
      );
    default:
      return null;
  }
}

// Big rooftop props, like the giant croissant on the bakery.
function Mascot({ kind, y, z }: { kind: ShopKind; y: number; z: number }) {
  switch (kind) {
    case "bakery":
      return (
        <group position={[0.4, y + 0.95, z]} rotation={[0.2, 0, 0]}>
          <mesh rotation={[0, 0, Math.PI]} castShadow material={mat("#e3a04f", 0.6)}>
            <torusGeometry args={[0.95, 0.42, 14, 28, Math.PI]} />
          </mesh>
          {[-0.5, 0, 0.5].map((o) => (
            <mesh key={o} position={[o * 1.2, -0.05 + Math.abs(o) * 0.5, 0.3]} rotation={[0, 0, o]} material={mat("#c97f35", 0.6)}>
              <torusGeometry args={[0.35, 0.06, 6, 12]} />
            </mesh>
          ))}
        </group>
      );
    case "flower":
      return (
        <group position={[0.2, y, z]}>
          <mesh position={[0, 0.7, 0]} material={mat("#4f9a4a")}>
            <cylinderGeometry args={[0.09, 0.12, 1.4, 8]} />
          </mesh>
          <group position={[0, 1.6, 0]} rotation={[0.35, 0, 0]}>
            {Array.from({ length: 7 }, (_, i) => {
              const a = (i / 7) * Math.PI * 2;
              return (
                <mesh key={i} position={[Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0]} scale={[1, 1, 0.45]} castShadow material={mat(i % 2 ? "#ff7eb6" : "#ff9cc8", 0.6)}>
                  <sphereGeometry args={[0.38, 14, 10]} />
                </mesh>
              );
            })}
            <mesh position={[0, 0, 0.1]} scale={[1, 1, 0.6]} material={mat("#ffd23f", 0.5)}>
              <sphereGeometry args={[0.36, 14, 10]} />
            </mesh>
          </group>
        </group>
      );
    case "cafe":
      return (
        <group position={[0.3, y + 0.15, z]}>
          <mesh position={[0, 0.05, 0]} material={mat("#f4f1ea", 0.4)}>
            <cylinderGeometry args={[1.05, 0.9, 0.12, 24]} />
          </mesh>
          <mesh position={[0, 0.65, 0]} castShadow material={mat("#ffffff", 0.35)}>
            <cylinderGeometry args={[0.75, 0.55, 1.1, 24]} />
          </mesh>
          <mesh position={[0, 1.17, 0]} material={mat("#6b3f24", 0.4)}>
            <cylinderGeometry args={[0.7, 0.7, 0.05, 24]} />
          </mesh>
          <mesh position={[0.78, 0.68, 0]} rotation={[0, 0, Math.PI / 2]} material={mat("#ffffff", 0.35)}>
            <torusGeometry args={[0.28, 0.08, 8, 16]} />
          </mesh>
        </group>
      );
    case "news":
      return (
        <group position={[0, y + 0.6, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow material={mat("#f5f2e8", 0.6)}>
            <cylinderGeometry args={[0.45, 0.45, 2.6, 18]} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} material={mat("#2b2b2b")}>
            <cylinderGeometry args={[0.47, 0.47, 0.5, 18]} />
          </mesh>
          <mesh position={[1.9, 0.3, 0]} rotation={[0, 0, -Math.PI / 2 - 0.3]} castShadow material={mat("#ffd23f", 0.5)}>
            <coneGeometry args={[0.55, 1.1, 16, 1, true]} />
          </mesh>
        </group>
      );
    case "books":
      return (
        <group position={[0, y, z]}>
          {["#e2574c", "#3a86ff", "#ffbe0b", "#8338ec"].map((c, i) => (
            <mesh key={c} position={[(i % 2) * 0.2 - 0.1, 0.2 + i * 0.36, 0]} rotation={[0, i * 0.35 - 0.4, 0]} castShadow material={mat(c, 0.6)}>
              <boxGeometry args={[2.0 - i * 0.2, 0.34, 1.4 - i * 0.1]} />
            </mesh>
          ))}
        </group>
      );
    case "ramen":
      return (
        <group position={[0, y + 0.55, z]}>
          <mesh rotation={[Math.PI, 0, 0]} castShadow material={mat("#f6f1e8", 0.4)}>
            <sphereGeometry args={[0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[0, -0.02, 0]} material={mat("#e9b65c", 0.5)}>
            <cylinderGeometry args={[0.9, 0.9, 0.06, 20]} />
          </mesh>
          <mesh position={[0, -0.6, 0]} material={mat("#b5462f", 0.5)}>
            <torusGeometry args={[0.55, 0.06, 6, 20]} />
          </mesh>
          {[-0.25, 0.25].map((o) => (
            <mesh key={o} position={[o, 0.55, -0.1]} rotation={[0.35, 0, o]} material={mat("#7a4f32")}>
              <cylinderGeometry args={[0.035, 0.035, 1.5, 6]} />
            </mesh>
          ))}
        </group>
      );
    case "seafood":
      return (
        <group position={[0, y + 0.8, z]} rotation={[0, 0, 0.15]}>
          <mesh scale={[1.4, 0.6, 0.35]} castShadow material={mat("#4d96ff", 0.4)}>
            <sphereGeometry args={[0.7, 16, 10]} />
          </mesh>
          <mesh position={[-1.25, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow material={mat("#3a6fd6", 0.4)}>
            <coneGeometry args={[0.45, 0.6, 4]} />
          </mesh>
          <mesh position={[0.6, 0.1, 0.25]} material={mat("#ffffff")}>
            <sphereGeometry args={[0.1, 8, 6]} />
          </mesh>
        </group>
      );
    case "mart":
      return (
        <group position={[-0.8, y + 0.9, z]}>
          <mesh position={[0, -0.45, 0]} material={mat("#555", 0.4, 0.6)}>
            <cylinderGeometry args={[0.06, 0.06, 0.9, 6]} />
          </mesh>
          <mesh castShadow material={glow.neonBlue}>
            <boxGeometry args={[1.6, 0.8, 0.2]} />
          </mesh>
        </group>
      );
    case "police":
      return (
        <group position={[0, y, z]}>
          <mesh position={[0, 0.15, 0]} material={mat("#2f2f35")}>
            <boxGeometry args={[2.2, 0.2, 0.5]} />
          </mesh>
          <mesh position={[-0.55, 0.38, 0]} material={glow.neonRed}>
            <boxGeometry args={[1.0, 0.28, 0.42]} />
          </mesh>
          <mesh position={[0.55, 0.38, 0]} material={glow.neonBlue}>
            <boxGeometry args={[1.0, 0.28, 0.42]} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

interface ShopMats {
  sign: THREE.Material[];
  awning: THREE.Material;
  interior: THREE.Material;
  icon: THREE.Material;
  chalk: THREE.Material[];
}

function useShopMats(b: BuildingDef, w: number): ShopMats | null {
  return useMemo(() => {
    if (b.kind === "house" || b.kind === "warehouse" || !b.sign) return null;
    const sign = new THREE.MeshStandardMaterial({ map: signTexture(b.sign.name, b.sign.sub, b.sign.bg, b.sign.fg), roughness: 0.5, emissive: "#ffffff", emissiveIntensity: 0.12 });
    sign.emissiveMap = sign.map;
    const side = mat(b.sign.bg);
    const icon = new THREE.MeshStandardMaterial({ map: iconTexture(ICONS[b.kind], b.sign.bg), transparent: true, side: THREE.DoubleSide, roughness: 0.5, emissive: "#ffffff", emissiveIntensity: 0.1 });
    icon.emissiveMap = icon.map;
    const chalk = new THREE.MeshStandardMaterial({ map: chalkTexture(CHALK[b.kind]), roughness: 0.9 });
    const wood = mat("#8a5a3a");
    const aw = b.awning ?? [b.roofColor, b.trim];
    return {
      sign: [side, side, side, side, sign, side],
      awning: new THREE.MeshStandardMaterial({ map: stripeTexture(aw[0], aw[1], Math.max(4, Math.round(w))), roughness: 0.8 }),
      interior: interiorMaterial(interiorTexture(b.kind, b.roofColor)),
      icon,
      chalk: [wood, wood, wood, wood, chalk, wood],
    };
  }, [b, w]);
}

function Building({ b }: { b: BuildingDef }) {
  const f = frame(b);
  const H = wallHeight(b.floors);
  const aw = b.annex ? f.w * 0.3 : 0;
  const bodyW = f.w - aw;
  const bodyCX = b.annex === "left" ? aw / 2 : b.annex === "right" ? -aw / 2 : 0;
  const wallMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: b.wall, roughness: 0.85, map: wallTexture(BRICK.has(b.kind) || BRICK.has(b.id) ? "brick" : "plaster", [bodyW / 2.2, H / 2.2]) }),
    [b, bodyW, H],
  );
  const glass = useMemo(() => interiorMaterial(homeTexture(shade(b.wall, -0.15))), [b.wall]);
  const shopMats = useShopMats(b, bodyW);
  const shop = b.kind !== "house" && b.kind !== "warehouse";
  return (
    <group position={[f.cx, 0, f.cz]} rotation={[0, f.rot, 0]}>
      <group position={[bodyCX, 0, 0]}>
        <RoundedBox args={[bodyW, H, f.d]} radius={0.2} smoothness={3} position={[0, H / 2, 0]} castShadow receiveShadow material={wallMat} />
        <mesh position={[0, 0.2, 0]} material={mat(shade(b.wall, -0.18))} receiveShadow>
          <boxGeometry args={[bodyW + 0.12, 0.4, f.d + 0.12]} />
        </mesh>
        <Roof b={b} w={bodyW} d={f.d} H={H} wallMat={wallMat} />
        {b.kind === "warehouse" ? (
          <WarehouseFront b={b} w={bodyW} d={f.d} />
        ) : shop && shopMats ? (
          <Shopfront b={b} w={bodyW} d={f.d} m={shopMats} />
        ) : (
          <HouseFront b={b} w={bodyW} d={f.d} glass={glass} />
        )}
        <BackDetails b={b} w={bodyW} d={f.d} H={H} glass={glass} />
        <UpperFloors b={b} w={bodyW} d={f.d} glass={glass} />
        <SideWindows b={b} w={bodyW} glass={glass} />
        {shop && (b.roof === "flat" || b.roof === "stepped" ? (
          <Mascot kind={b.kind as ShopKind} y={H + 0.3} z={f.d / 2 - 1.1} />
        ) : (
          <Mascot kind={b.kind as ShopKind} y={H + 0.05} z={f.d / 2 + 0.25} />
        ))}
      </group>
      {b.annex && <Annex b={b} x={b.annex === "left" ? -f.w / 2 + aw / 2 : f.w / 2 - aw / 2} w={aw} d={f.d} glass={glass} />}
    </group>
  );
}

// A lower side extension, set back from the street, so blocks are not plain boxes.
function Annex({ b, x, w, d, glass }: { b: BuildingDef; x: number; w: number; d: number; glass: THREE.Material }) {
  const h = 2.6;
  const ad = d * 0.78;
  return (
    <group position={[x, 0, -(d - ad) / 2]}>
      <RoundedBox args={[w, h, ad]} radius={0.15} position={[0, h / 2, 0]} castShadow receiveShadow material={mat(shade(b.wall, 0.06))} />
      <mesh position={[0, h + 0.12, 0]} castShadow material={mat(shade(b.roofColor, 0.1))}>
        <boxGeometry args={[w + 0.3, 0.24, ad + 0.3]} />
      </mesh>
      <group position={[0, 0, ad / 2]}>
        <Window x={0} y={1.5} glass={glass} trim={mat(b.trim)} box="#ffd23f" />
      </group>
      <AirCon x={0} z={-ad * 0.15} />
    </group>
  );
}

function TownHall({ b }: { b: BuildingDef }) {
  const f = frame(b);
  const H = f.height;
  const bodyD = f.d - 2.2;
  const sign = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: signTexture(b.sign!.name, b.sign!.sub, b.sign!.bg, b.sign!.fg), roughness: 0.5, emissive: "#ffffff", emissiveIntensity: 0.15 });
    m.emissiveMap = m.map;
    return m;
  }, [b]);
  const pediment = useMemo(() => pedimentGeometry(f.w * 0.8, 1.7, 2.4), [f.w]);
  const wall = useMemo(() => new THREE.MeshStandardMaterial({ color: b.wall, roughness: 0.85, map: wallTexture("plaster", [f.w / 2.2, H / 2.2]) }), [b, f.w, H]);
  const glass = useMemo(() => interiorMaterial(interiorTexture("townhall", b.roofColor)), [b]);
  const white = mat("#f6f3ea", 0.6);
  const front = f.d / 2;
  return (
    <group position={[f.cx, 0, f.cz]}>
      <RoundedBox args={[f.w, H, bodyD]} radius={0.2} position={[0, H / 2, -1.1]} castShadow receiveShadow material={wall} />
      <group position={[0, H, -1.1]}>
        <Slab w={f.w} d={bodyD} roof={mat(b.roofColor)} trim={mat(b.trim)} />
      </group>
      {/* tall windows behind the colonnade */}
      {[0, 1].map((r) =>
        [-4.6, -2.3, 2.3, 4.6].map((x) => (
          <group key={`${r}${x}`} position={[x, 0, -1.1 + bodyD / 2]}>
            <Window x={0} y={1.8 + r * 3} glass={glass} trim={white} />
          </group>
        )),
      )}
      <mesh position={[0, 1.4, -1.1 + bodyD / 2 + 0.05]} material={mat("#6b4f3a", 0.6)}>
        <boxGeometry args={[2.0, 2.8, 0.1]} />
      </mesh>
      {/* portico: floor, columns, entablature and pediment with the town clock */}
      <mesh position={[0, 0.2, front - 1.1]} receiveShadow material={white}>
        <boxGeometry args={[f.w * 0.8, 0.4, 2.4]} />
      </mesh>
      {[-3.9, -1.3, 1.3, 3.9].map((x) => (
        <group key={x} position={[x, 0, front - 0.5]}>
          <mesh position={[0, 0.55, 0]} material={white}>
            <boxGeometry args={[0.8, 0.3, 0.8]} />
          </mesh>
          <mesh position={[0, (H - 1.2) / 2 + 0.4, 0]} castShadow material={white}>
            <cylinderGeometry args={[0.3, 0.34, H - 1.6, 16]} />
          </mesh>
          <mesh position={[0, H - 1.0, 0]} material={white}>
            <boxGeometry args={[0.8, 0.25, 0.8]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, H - 0.6, front - 1.1]} castShadow material={white}>
        <boxGeometry args={[f.w * 0.82, 0.6, 2.5]} />
      </mesh>
      <mesh position={[0, H - 0.6, front + 0.16]} material={sign}>
        <planeGeometry args={[3.6, 0.55]} />
      </mesh>
      <mesh geometry={pediment} position={[0, H - 0.3, front + 0.1]} castShadow material={white} />
      <TownClock y={H + 0.45} z={front + 0.12} />
      {/* front steps */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.12 + i * 0.06, front + 0.9 - i * 0.3]} receiveShadow material={mat("#e9e4da", 0.8)}>
          <boxGeometry args={[5.2 - i * 0.5, 0.24 + i * 0.12, 0.6]} />
        </mesh>
      ))}
      <ClockTower y={H + 0.3} z={-2.6} wall={b.wall} roof={b.roofColor} />
      <SeatOfPower w={f.w} H={H} front={front} />
    </group>
  );
}

const FLAG_POLE = 9.4;
const TOWER_FLAG = new THREE.MeshStandardMaterial({ color: "#e2574c", side: THREE.DoubleSide, roughness: 0.8 });
const POLE = new THREE.CylinderGeometry(0.045, 0.07, FLAG_POLE, 8);
const FINIAL = new THREE.SphereGeometry(0.1, 10, 8);
const VBANNER = new THREE.PlaneGeometry(0.95, 2.8);
// A red runner in town hall space: a short apron on the plaza, up the three steps (tread, riser), across the portico.
const CARPET: Inst[] = [
  { p: [0, 0.045, 6.2], s: [1.5, 0.02, 1.0] },
  { p: [0, 0.12, 5.71], s: [1.5, 0.24, 0.02] },
  { p: [0, 0.25, 5.55], s: [1.5, 0.02, 0.3] },
  { p: [0, 0.3, 5.41], s: [1.5, 0.12, 0.02] },
  { p: [0, 0.37, 5.25], s: [1.5, 0.02, 0.3] },
  { p: [0, 0.42, 5.11], s: [1.5, 0.12, 0.02] },
  { p: [0, 0.49, 4.8], s: [1.5, 0.02, 0.6] },
  { p: [0, 0.41, 3.4], s: [1.5, 0.02, 2.25] },
];

/** What makes the town hall read as the seat of power: tall flags above the roofline, festival banners
 *  between the columns, a red carpet up the steps and a press podium on the portico (all inside its footprint). */
function SeatOfPower({ w, H, front }: { w: number; H: number; front: number }) {
  const m = useMemo(() => {
    const flag = (bg: string, glyph: string, ink?: string) => new THREE.MeshStandardMaterial({ map: flagTexture(bg, glyph, ink), side: THREE.DoubleSide, roughness: 0.8 });
    // the two colonnade banners read across the door, LANTERN | FESTIVAL, letters the same size on both
    // (gold stars, not a lantern emoji: a red lantern vanishes on the red cloth)
    const banner = (word: string) => {
      const cloth = new THREE.MeshStandardMaterial({ map: vbannerTexture(["★", ...word], 9), roughness: 0.7, emissive: "#ffffff", emissiveIntensity: 0.1 });
      cloth.emissiveMap = cloth.map;
      return cloth;
    };
    // the town flag is cream with a green seal (M for Mistport): a dark green one vanished against the trees behind it
    return { town: flag("#f6f1d5", "M", "#2f5a37"), festival: flag("#c2332f", "★"), banners: [banner("LANTERN"), banner("FESTIVAL")] };
  }, []);
  const at = useMemo(() => {
    const sides = [-1, 1].map((side) => side * w * 0.42);
    return {
      poles: sides.map((x): Inst => ({ p: [x, FLAG_POLE / 2, front + 0.6] })),
      finials: sides.map((x): Inst => ({ p: [x, FLAG_POLE + 0.08, front + 0.6] })),
      banners: [-2.6, 2.6].map((x): Inst => ({ p: [x, H - 2.45, front - 0.42] })),
    };
  }, [w, H, front]);
  const gold = mat("#d4af37", 0.35, 0.4);
  return (
    <group name="set:townhall">
      <Instances geo={POLE} material={mat("#d9d9d9", 0.4, 0.6)} items={at.poles} castShadow />
      <Instances geo={FINIAL} material={gold} items={at.finials} />
      {/* the town's colours and the festival's, flying outward so they frame the facade */}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * w * 0.42, FLAG_POLE - 0.12, front + 0.6]}>
          <Flag w={1.8} h={1.1} dir={side} material={side < 0 ? m.town : m.festival} phase={side} />
        </group>
      ))}
      {at.banners.map((b, i) => (
        <mesh key={i} geometry={VBANNER} material={m.banners[i]} position={b.p} receiveShadow />
      ))}
      <Instances geo={UNIT_BOX} material={mat("#b5262b", 0.9)} items={CARPET} />
      <Podium z={front - 0.8} gold={gold} />
    </group>
  );
}

// The press podium: where the mayor would face the plaza to make a statement. The microphone leans back
// toward whoever stands behind it.
const PODIUM_WOOD = mergeGeometries([
  new THREE.BoxGeometry(0.75, 1.1, 0.5).translate(0, 0.55, 0),
  new THREE.BoxGeometry(0.86, 0.06, 0.56).rotateX(-0.35).translate(0, 1.14, -0.03),
]);
const PODIUM_MIC = mergeGeometries([
  new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6).rotateX(-0.55).translate(0.14, 1.33, 0.1),
  new THREE.SphereGeometry(0.04, 10, 8).translate(0.14, 1.52, -0.02),
]);
function Podium({ z, gold }: { z: number; gold: THREE.Material }) {
  return (
    <group position={[0, 0.42, z]}>
      <mesh geometry={PODIUM_WOOD} castShadow material={mat("#6b4f3a", 0.6)} />
      <mesh position={[0, 0.72, 0.26]} rotation={[Math.PI / 2, 0, 0]} material={gold}>
        <cylinderGeometry args={[0.16, 0.16, 0.03, 20]} />
      </mesh>
      <mesh geometry={PODIUM_MIC} material={mat("#2b2b2b", 0.4, 0.6)} />
    </group>
  );
}

function useClockHands() {
  const hour = useRef<THREE.Mesh>(null);
  const minute = useRef<THREE.Mesh>(null);
  // Hands pivot at one end, so shift each box up by half its length.
  const geo = useMemo(
    () => ({ hour: new THREE.BoxGeometry(0.1, 0.5, 0.04).translate(0, 0.25, 0), minute: new THREE.BoxGeometry(0.07, 0.75, 0.04).translate(0, 0.375, 0) }),
    [],
  );
  useFrame(() => {
    const h = clock.hour;
    if (hour.current) hour.current.rotation.z = -((h % 12) / 12) * Math.PI * 2;
    if (minute.current) minute.current.rotation.z = -(h % 1) * Math.PI * 2;
  });
  return { hour, minute, geo };
}

function ClockFace({ r }: { r: number }) {
  const { hour, minute, geo } = useClockHands();
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={mat("#fbf6e4", 0.4)}>
        <cylinderGeometry args={[r, r, 0.08, 32]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.02]} material={mat("#2f5a37")}>
        <cylinderGeometry args={[r + 0.12, r + 0.12, 0.06, 32]} />
      </mesh>
      <mesh ref={hour} position={[0, 0, 0.06]} geometry={geo.hour} material={mat("#2b2b2b")} />
      <mesh ref={minute} position={[0, 0, 0.08]} geometry={geo.minute} material={mat("#2b2b2b")} />
    </group>
  );
}

function TownClock({ y, z }: { y: number; z: number }) {
  return (
    <group position={[0, y, z]}>
      <ClockFace r={0.62} />
    </group>
  );
}

function ClockTower({ y, z, wall, roof }: { y: number; z: number; wall: string; roof: string }) {
  return (
    <group position={[0, y, z]}>
      <RoundedBox args={[3, 2.8, 3]} radius={0.2} position={[0, 1.4, 0]} castShadow material={mat(wall)} />
      <mesh position={[0, 3.25, 0]} castShadow material={mat(roof)}>
        <coneGeometry args={[2.3, 1.6, 4]} />
      </mesh>
      <group position={[0, 1.5, 1.52]}>
        <ClockFace r={0.95} />
      </group>
      <mesh position={[0, 4.8, 0]} material={mat("#7a5a3a")}>
        <cylinderGeometry args={[0.04, 0.04, 1.6, 6]} />
      </mesh>
      <group position={[0, 5.55, 0]}>
        <Flag w={0.9} h={0.55} material={TOWER_FLAG} phase={2} />
      </group>
    </group>
  );
}

export default function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b) => (b.kind === "townhall" ? <TownHall key={b.id} b={b} /> : <Building key={b.id} b={b} />))}
    </group>
  );
}
