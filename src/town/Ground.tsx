"use client";

import { useMemo } from "react";
import * as THREE from "three";
import {
  CARRIAGEWAY, CROSSINGS, GREEN, MAIN_SIDEWALK, PATCHES, PLAZA, YARDS, COAST_X, sampled, fromLocal, type Pt, type Surface,
} from "./layout";
import { mat } from "./materials";
import { asphaltTexture, cobbleTexture, grassTexture, sidewalkTexture } from "./textures";

// A flat strip following a polyline. UVs run along the strip in metres / scale.
export function ribbonGeometry(line: Pt[], width: number, scale = 3, closed = false) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let run = 0;
  const n = line.length;
  for (let i = 0; i < n; i++) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    if (closed && (i === 0 || i === n - 1)) {
      tx = line[1][0] - line[n - 2][0];
      tz = line[1][1] - line[n - 2][1];
    }
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl;
    const nz = tx / tl;
    if (i > 0) run += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    const hw = width / 2;
    pos.push(line[i][0] + nx * hw, 0, line[i][1] + nz * hw, line[i][0] - nx * hw, 0, line[i][1] - nz * hw);
    uv.push(0, run / scale, width / scale, run / scale);
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A flat polygon on the ground, with UVs in world metres / scale.
export function polygonGeometry(poly: Pt[], scale = 4) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / scale;
    uv[i * 2 + 1] = p.getZ(i) / scale;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

const SURFACE_SCALE: Record<Surface, number> = { asphalt: 6, cobble: 4, tile: 3, gravel: 3 };

function useSurfaces() {
  return useMemo(() => {
    const repeatOne = (t: THREE.Texture) => {
      t.repeat.set(1, 1);
      return t;
    };
    const gravel = new THREE.MeshStandardMaterial({ color: "#e5d2b0", roughness: 1, map: repeatOne(sidewalkTexture([1, 1])) });
    gravel.color.set("#f0dcc0");
    return {
      asphalt: new THREE.MeshStandardMaterial({ map: repeatOne(asphaltTexture([1, 1])), roughness: 0.95 }),
      cobble: new THREE.MeshStandardMaterial({ map: repeatOne(cobbleTexture([1, 1])), roughness: 0.88 }),
      tile: new THREE.MeshStandardMaterial({ map: repeatOne(sidewalkTexture([1, 1])), roughness: 0.9 }),
      gravel,
      grass: new THREE.MeshStandardMaterial({ map: grassTexture([60, 60]), roughness: 1 }),
      lawn: new THREE.MeshStandardMaterial({ map: repeatOne(grassTexture([1, 1])), color: "#d8f0c0", roughness: 1 }),
      yard: new THREE.MeshStandardMaterial({ map: repeatOne(grassTexture([1, 1])), color: "#e6f7cf", roughness: 1 }),
      paint: mat("#f4f1e8", 0.6),
      curb: mat("#d9d3cb", 0.8),
    } as Record<string, THREE.MeshStandardMaterial>;
  }, []);
}

export default function Ground() {
  const m = useSurfaces();
  const geo = useMemo(() => {
    const dashes: THREE.BufferGeometry[] = [];
    // centre-line dashes along the main road
    const line = sampled.main;
    let acc = 0;
    for (let i = 1; i < line.length; i++) {
      acc += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      if (acc > 5 && i + 3 < line.length) {
        acc = 0;
        dashes.push(ribbonGeometry(line.slice(i, i + 3), 0.16, 1));
      }
    }
    return {
      sidewalk: ribbonGeometry(sampled.main, MAIN_SIDEWALK, SURFACE_SCALE.tile),
      curb: ribbonGeometry(sampled.main, CARRIAGEWAY + 0.4, 1),
      carriageway: ribbonGeometry(sampled.main, CARRIAGEWAY, SURFACE_SCALE.asphalt),
      dashes,
      roads: sampled.roads.map((r) => ({ id: r.id, surface: r.surface, g: ribbonGeometry(r.line, r.width, SURFACE_SCALE[r.surface], r.closed) })),
      plaza: polygonGeometry(PLAZA, 4),
      green: polygonGeometry(GREEN, 6),
      patches: PATCHES.map((p) => polygonGeometry(p, 3)),
    };
  }, []);

  return (
    <group>
      {/* the land stops at the quay; the sea lies beyond */}
      <mesh position={[(-160 + COAST_X) / 2, -0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.grass}>
        <planeGeometry args={[COAST_X + 160, 300]} />
      </mesh>
      <mesh geometry={geo.green} position={[0, -0.03, 0]} receiveShadow material={m.lawn} />
      {YARDS.map((y, i) => (
        <mesh key={i} position={[y.x, -0.025, y.z]} rotation={[-Math.PI / 2, 0, y.rot]} receiveShadow material={m.yard}>
          <planeGeometry args={[y.w, y.d]} />
        </mesh>
      ))}
      {geo.roads.map((r, i) => (
        <mesh key={r.id} geometry={r.g} position={[0, 0.004 + i * 0.002, 0]} receiveShadow material={m[r.surface]} />
      ))}
      <mesh geometry={geo.plaza} position={[0, 0.03, 0]} receiveShadow material={m.cobble} />
      {geo.patches.map((g, i) => (
        <mesh key={i} geometry={g} position={[0, 0.032, 0]} receiveShadow material={m.tile} />
      ))}
      <mesh geometry={geo.sidewalk} position={[0, 0.036, 0]} receiveShadow material={m.tile} />
      <mesh geometry={geo.curb} position={[0, 0.06, 0]} receiveShadow material={m.curb} />
      <mesh geometry={geo.carriageway} position={[0, 0.07, 0]} receiveShadow material={m.asphalt} />
      {geo.dashes.map((g, i) => (
        <mesh key={i} geometry={g} position={[0, 0.075, 0]} material={m.paint} />
      ))}
      {CROSSINGS.map((c, i) => (
        <group key={i} position={[c.x, 0.078, c.z]} rotation={[0, c.rot, 0]}>
          {Array.from({ length: 7 }, (_, k) => (
            <mesh key={k} position={[0, 0, -CARRIAGEWAY / 2 + 0.4 + k * 0.8]} rotation={[-Math.PI / 2, 0, 0]} material={m.paint}>
              <planeGeometry args={[c.w, 0.42]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Where a point sits on the main road, used to place lamps and kerb props. */
export const roadSide = (i: number, side: 1 | -1, offset: number) => {
  const l = sampled.main;
  const a = l[Math.max(0, i - 1)];
  const b = l[Math.min(l.length - 1, i + 1)];
  const t = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return fromLocal({ x: l[i][0], z: l[i][1], rot: 0 }, (-(b[1] - a[1]) / t) * side * offset, ((b[0] - a[0]) / t) * side * offset);
};
